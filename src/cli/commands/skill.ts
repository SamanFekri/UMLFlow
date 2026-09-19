import type { Command } from 'commander';
import pc from 'picocolors';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { globalOptions, makeOut } from '../index.js';
import { ConfigStore } from '../../config/store.js';

const require = createRequire(import.meta.url);

/** Absolute path of the bundled Claude Code skill file. */
export function bundledSkillPath(): string {
  return path.join(path.dirname(require.resolve('../../../package.json')), 'skill', 'SKILL.md');
}

export function registerSkill(program: Command): void {
  program
    .command('install-skill')
    .description('Install the UMLFlow Claude Code skill (.claude/skills/umlflow/SKILL.md)')
    .option('--global', 'install into ~/.claude/skills instead of the project')
    .action(async (opts: { global?: boolean }, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      const root = (await ConfigStore.find(g.cwd)) ?? g.cwd;
      const base = opts.global ? path.join(os.homedir(), '.claude', 'skills') : path.join(root, '.claude', 'skills');
      const target = path.join(base, 'umlflow', 'SKILL.md');
      const content = await fs.readFile(bundledSkillPath(), 'utf8');
      await fs.mkdir(path.dirname(target), { recursive: true });
      let status = 'installed';
      try {
        const existing = await fs.readFile(target, 'utf8');
        status = existing === content ? 'unchanged' : 'updated';
      } catch {
        /* new */
      }
      if (status !== 'unchanged') await fs.writeFile(target, content, 'utf8');
      out.line(`${pc.green('✓')} skill ${status}: ${target}`);
      out.line(pc.dim('Claude Code will load it when UML, diagrams or architecture come up. Try: "Create a sequence diagram for the checkout flow."'));
      out.emitJson({ target, status });
    });
}
