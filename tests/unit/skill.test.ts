import { describe, expect, it, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cleanup, tempRepo } from '../helpers.js';
import { initProject } from '../../src/config/init.js';
import { Umlflow } from '../../src/sync/pipeline.js';
import { buildContext, formatContext } from '../../src/cli/context.js';

const SKILL = path.resolve(__dirname, '../../skill/SKILL.md');
const BIN = path.resolve(__dirname, '../../bin/umlflow.js');
let root: string | null = null;

afterEach(async () => {
  if (root) await cleanup(root);
  root = null;
});

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
