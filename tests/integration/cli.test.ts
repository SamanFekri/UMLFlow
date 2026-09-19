import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cleanup, git, read, tempRepo, write } from '../helpers.js';

const BIN = path.resolve(__dirname, '../../bin/umlflow.js');

function run(cwd: string, ...args: string[]): { code: number; stdout: string; stderr: string; json: () => unknown } {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

let root: string;

beforeEach(async () => {
  root = await tempRepo('ts-shop', { git: true });
});

afterEach(async () => {
  await cleanup(root);
});

describe('CLI', () => {
  it('init → generate → update → check → diff → status work end to end', async () => {
    const init = run(root, 'init', '-y', '--types', 'usecase,erd');
    expect(init.code).toBe(0);
    expect(init.stdout).toContain('Initialized UMLFlow');
    expect(init.stdout).toContain('+ system-usecases');
    expect(init.stdout).not.toContain('main-flows');
    expect(await read(root, '.umlflow/.gitignore')).toContain('cache/');

    const gen = run(root, 'generate', '--type', 'sequence', '--name', 'login-flow', '--about', 'login', '--json');
    expect(gen.code).toBe(0);
    const genJson = gen.json() as { inference: { entryPoints: string[] } };
    expect(genJson.inference.entryPoints).toEqual(['AuthController.login']);
    expect(await read(root, '.umlflow/diagrams/login-flow.md')).toContain('POST /auth/login');

    const check = run(root, 'check');
    expect(check.code).toBe(0);
    expect(check.stdout).toContain('All diagrams are up to date');

    await write(root, 'src/auth/session.manager.ts', `import { Injectable } from '@nestjs/common';\nimport { AuditService } from './audit.service';\n@Injectable()\nexport class SessionManager {\n  constructor(private readonly audit: AuditService) {}\n  async create(userId: string): Promise<string> {\n    await this.audit.record(userId);\n    return \`session-\${userId}\`;\n  }\n}\n`);
    await write(root, 'src/auth/audit.service.ts', `import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class AuditService {\n  async record(userId: string): Promise<void> {}\n}\n`);

    const diff = run(root, 'diff', '--json');
    expect(diff.code).toBe(0);
    const diffJson = diff.json() as { diff: { added: string[] }; affected: Record<string, string>; index: { parsed: number; total: number } };
    expect(diffJson.index.parsed).toBe(2); // only the changed file and the added file were parsed
    expect(diffJson.index.total).toBe(18);
    expect(diffJson.diff.added).toContain('SessionManager now depends on AuditService');
    expect(Object.keys(diffJson.affected)).toEqual(['login-flow']);

    const stale = run(root, 'check');
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain('! login-flow');

    const update = run(root, 'update', '--json');
    expect(update.code).toBe(0);
    const upd = update.json() as { diagrams: { name: string; status: string }[]; index: { parsed: number } };
    expect(upd.index.parsed).toBe(0); // parse cache already up to date from `diff`; nothing re-read
    expect(Object.fromEntries(upd.diagrams.map((d) => [d.name, d.status]))).toEqual({ 'system-usecases': 'skipped', 'database-erd': 'skipped', 'login-flow': 'updated' });
    expect(await read(root, '.umlflow/diagrams/login-flow.md')).toContain('session_manager->>audit_service: record');

    const status = run(root, 'status');
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('login-flow [sequence]');
    expect(status.stdout).toContain('up to date');
  });

  it('semantic questions/answers and declarations round-trip through the CLI', async () => {
    run(root, 'init', '-y');
    const q = run(root, 'semantic', 'questions', '--json');
    const questions = q.json() as { id: string; options: string[] }[];
    expect(questions.map((x) => x.id)).toEqual(['actor:AuthController', 'actor:OrderController']);
    const a = run(root, 'semantic', 'answer', '--set', 'actor:AuthController=Visitor', '--set', 'usecase-name:OrderController.get=Look up an order');
    expect(a.code).toBe(0);
    expect(a.stdout).toContain('recorded');
    const d = run(root, 'declare', 'actor', 'Customer', '--for', 'OrderController');
    expect(d.code).toBe(0);
    const sem = await read(root, '.umlflow/semantics.yaml');
    expect(sem).toContain('source: semantic-inference');
    expect(sem).toContain('source: user');
    // inference cannot override the user's declaration
    const blocked = run(root, 'semantic', 'answer', '--set', 'actor:OrderController=Bot');
    expect(blocked.stdout).toContain('kept existing user declaration');
    run(root, 'update');
    const uc = await read(root, '.umlflow/diagrams/system-usecases.md');
    expect(uc).toContain('Customer');
    expect(uc).toContain('Look up an order');
    expect(run(root, 'semantic', 'questions').stdout).toContain('No open semantic questions');
    const ignore = run(root, 'declare', 'ignore', 'Logger');
    expect(ignore.code).toBe(0);
    run(root, 'update');
    expect(await read(root, '.umlflow/diagrams/main-flows.md')).not.toContain('Logger');
  });

  it('rebuild-index and cache-less check behave; hooks install via CLI', async () => {
    run(root, 'init', '-y');
    await fs.rm(path.join(root, '.umlflow/cache'), { recursive: true });
    const rebuilt = run(root, 'rebuild-index', '--json');
    expect(rebuilt.code).toBe(0);
    expect((rebuilt.json() as { total: number }).total).toBe(17);
    expect(run(root, 'check').code).toBe(0);
    const hooks = run(root, 'install-hooks', '--mode', 'update', '--json');
    expect(hooks.code).toBe(0);
    expect((hooks.json() as { status: string; mode: string }[])[0]).toMatchObject({ hook: 'pre-commit', status: 'created', mode: 'update' });
    expect(await read(root, '.umlflow/config.yaml')).toContain('pre-commit: update');
    // off mode: hook is a no-op even with stale diagrams
    run(root, 'install-hooks', '--mode', 'off');
    await write(root, 'src/payments/payment.gateway.ts', 'export class PaymentGateway { async authorize(a: number) { return true; } async capture(a: number) {} async refund(a: number) {} }\n');
    git(root, 'add', '-A');
    expect(run(root, 'hook', 'pre-commit').code).toBe(0);
    expect(run(root, 'check').code).toBe(0); // refund is not called by anyone: no diagram is affected
    const un = run(root, 'uninstall-hooks');
    expect(un.stdout).toContain('pre-commit: deleted');
  });

  it('fails clearly when not initialised or with bad input', async () => {
    const r = run(root, 'update');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not initialized');
    expect(r.stderr).toContain('umlflow init');
    run(root, 'init', '-y');
    const bad = run(root, 'generate', '--type', 'class', '--name', 'x');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('Unknown diagram type');
    const missing = run(root, 'update', 'nope');
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('not defined');
  });
});
