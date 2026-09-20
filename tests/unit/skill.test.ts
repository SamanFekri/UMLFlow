import { describe, expect, it, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cleanup, tempRepo } from '../helpers.js';
import { initProject } from '../../src/config/init.js';
import { Umlflow } from '../../src/sync/pipeline.js';
import { buildContext, formatContext } from '../../src/cli/context.js';
import { claudeConfigDir, skillTargetPath } from '../../src/cli/commands/skill.js';

const SKILL = path.resolve(__dirname, '../../skill/SKILL.md');
const BIN = path.resolve(__dirname, '../../bin/umlflow.js');
let root: string | null = null;
let extra: string | null = null;

afterEach(async () => {
  if (root) await cleanup(root);
  if (extra) await cleanup(extra);
  root = extra = null;
  delete process.env['CLAUDE_CONFIG_DIR'];
});

const NO_STACK = /^\s+at /m;

describe('Claude Code skill', () => {
  it('has valid frontmatter and stays compact', async () => {
    const text = await fs.readFile(SKILL, 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    expect(fm).not.toBeNull();
    expect(fm![1]).toMatch(/^name: umlflow$/m);
    expect(fm![1]).toMatch(/^description: .+/m);
    expect(text.split(/\s+/).length).toBeLessThan(1500);
  });

  it('teaches state-first, targeted context, correct commands and honesty rules', async () => {
    const text = await fs.readFile(SKILL, 'utf8');
    expect(text).toContain('# /umlflow');
    expect(text).toContain('## Usage');
    expect(text).toMatch(/\/umlflow --help/);
    expect(text).toContain('umlflow context');
    expect(text).toMatch(/never re-reads the whole repository|never the repository/i);
    for (const cmd of ['umlflow generate', 'umlflow update', 'umlflow check', 'umlflow diff', 'umlflow semantic questions', 'umlflow semantic answer', 'umlflow declare', 'umlflow install-hooks']) {
      expect(text).toContain(cmd);
    }
    expect(text).toMatch(/never invent/i);
    expect(text).toMatch(/source of truth/i);
    expect(text).toMatch(/Never edit the generated block/);
    expect(text).toMatch(/inferred/);
    expect(text).toMatch(/Do not regenerate after every edit/);
  });

  it('installs into the project and is idempotent', async () => {
    root = await tempRepo('ts-shop', { git: true });
    const r1 = spawnSync(process.execPath, [BIN, 'install-skill', '--project', '--json'], { cwd: root, encoding: 'utf8' });
    expect(r1.status).toBe(0);
    const target = path.join(root, '.claude/skills/umlflow/SKILL.md');
    expect(await fs.readFile(target, 'utf8')).toBe(await fs.readFile(SKILL, 'utf8'));
    const r2 = spawnSync(process.execPath, [BIN, 'install-skill', '--project', '--json'], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(r2.stdout).status).toBe('unchanged');
  });

  it('resolves the user-level target from ~/.claude or CLAUDE_CONFIG_DIR, with native separators', () => {
    delete process.env['CLAUDE_CONFIG_DIR'];
    expect(claudeConfigDir()).toBe(path.join(os.homedir(), '.claude'));
    expect(skillTargetPath('global', '/ignored')).toBe(path.join(os.homedir(), '.claude', 'skills', 'umlflow', 'SKILL.md'));
    process.env['CLAUDE_CONFIG_DIR'] = ' relocated/claude ';
    expect(claudeConfigDir()).toBe(path.resolve('relocated/claude'));
    expect(skillTargetPath('project', path.join('some', 'repo'))).toBe(path.join('some', 'repo', '.claude', 'skills', 'umlflow', 'SKILL.md'));
    expect(skillTargetPath('global', '/ignored')).not.toContain(path.sep === '\\' ? '/' : '\\');
  });

  it('installs globally into CLAUDE_CONFIG_DIR when set, without touching the real home directory', async () => {
    root = await tempRepo('ts-shop', { git: true });
    extra = await fs.mkdtemp(path.join(os.tmpdir(), 'umlflow-claude-'));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: extra };
    const r = spawnSync(process.execPath, [BIN, 'install-skill', '--json'], { cwd: root, encoding: 'utf8', env });
    expect(r.status).toBe(0);
    const { target, status } = JSON.parse(r.stdout);
    expect(status).toBe('installed');
    expect(target).toBe(path.join(extra, 'skills', 'umlflow', 'SKILL.md'));
    expect(await fs.readFile(target, 'utf8')).toBe(await fs.readFile(SKILL, 'utf8'));
  });

  it('reports an unwritable target as a clean error with a hint (exit 2, no stack trace)', async () => {
    root = await tempRepo('ts-shop', { git: true });
    const blocker = path.join(root, 'not-a-dir');
    await fs.writeFile(blocker, 'file, not a directory');
    const env = { ...process.env, CLAUDE_CONFIG_DIR: blocker };
    const r = spawnSync(process.execPath, [BIN, 'install-skill'], { cwd: root, encoding: 'utf8', env });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/error: could not write the skill to /);
    expect(r.stderr).toMatch(/hint: .*--project/);
    expect(r.stderr).not.toMatch(NO_STACK);
  });

  it('bin never crashes when the build is missing: one-line message, hint, exit 1', async () => {
    extra = await fs.mkdtemp(path.join(os.tmpdir(), 'umlflow-bin-'));
    const orphanBin = path.join(extra, 'bin', 'umlflow.js');
    await fs.mkdir(path.dirname(orphanBin), { recursive: true });
    await fs.copyFile(BIN, orphanBin);
    await fs.writeFile(path.join(extra, 'package.json'), '{"type":"module"}');
    const r = spawnSync(process.execPath, [orphanBin, '--version'], { cwd: extra, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^umlflow: the CLI build could not be loaded/);
    expect(r.stderr).toMatch(/hint: reinstall with `npm install -g umlflow`/);
    expect(r.stderr).not.toMatch(NO_STACK);
    expect(r.stdout).toBe('');
  });

  it('`umlflow context` gives Claude a compact, complete picture without source text', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['usecase', 'sequence', 'erd'] });
    const engine = await Umlflow.open(root);
    await engine.update();
    const ctx = await buildContext(engine);
    const text = formatContext(ctx);
    expect(text.length).toBeLessThan(3000);
    expect(text).toContain('Diagrams:');
    expect(text).toContain('up to date');
    expect(text).toContain('Open semantic questions (2)');
    expect(text).toContain('actor:OrderController');
    expect(text).toContain('refs: src/orders/order.controller.ts:6');
    expect(text).not.toContain('import ');
    expect(ctx.entryPoints).toContain('OrderController.create [http POST /orders]');
    expect(ctx.nextSteps.join(' ')).toContain('semantic answer');
  });
});
