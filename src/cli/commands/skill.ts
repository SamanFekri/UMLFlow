import type { Command } from 'commander';
import pc from 'picocolors';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { globalOptions, makeOut } from '../index.js';
import { ConfigStore } from '../../config/store.js';
import { UmlflowError, errorMessage } from '../../core/errors.js';

const require = createRequire(import.meta.url);

/** File name of the skill inside the package and inside the Claude Code skills directory. */
export const SKILL_FILE = 'SKILL.md';
/** Directory name of the skill inside `<claude config>/skills/`; doubles as the `/umlflow` slash command. */
export const SKILL_NAME = 'umlflow';

/** Absolute path of the bundled Claude Code skill file (`<package root>/skill/SKILL.md`). */
export function bundledSkillPath(): string {
  return path.join(path.dirname(require.resolve('../../../package.json')), 'skill', SKILL_FILE);
}

/**
 * Claude Code's user-level configuration directory: `$CLAUDE_CONFIG_DIR` when set (Claude Code honours it),
 * otherwise `~/.claude` — `%USERPROFILE%\.claude` on Windows. Built with `path.join`, so separators are native.
 */
export function claudeConfigDir(): string {
  const override = process.env['CLAUDE_CONFIG_DIR']?.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), '.claude');
}

/** Where the skill is installed for a given mode: project-local `.claude/skills` or the user-level directory. */
export function skillTargetPath(mode: 'global' | 'project', projectRoot: string): string {
  const base = mode === 'project' ? path.join(projectRoot, '.claude', 'skills') : path.join(claudeConfigDir(), 'skills');
  return path.join(base, SKILL_NAME, SKILL_FILE);
}

export type SkillInstallStatus = 'installed' | 'updated' | 'unchanged';

/** Copy the bundled skill to `target`, creating directories as needed. Idempotent: identical content is left untouched. */
export async function installSkill(target: string): Promise<SkillInstallStatus> {
  const source = bundledSkillPath();
  let content: string;
  try {
    content = await fs.readFile(source, 'utf8');
  } catch (err) {
    throw new UmlflowError(`the bundled skill file is missing: ${source}`, {
      code: 'SKILL_SOURCE_MISSING',
      hint: 'The umlflow package looks incomplete. Reinstall it with `npm install -g umlflow`.',
      cause: err,
    });
  }

  let existing: string | null = null;
  try {
    existing = await fs.readFile(target, 'utf8');
  } catch {
    /* not installed yet */
  }
  if (existing === content) return 'unchanged';

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  } catch (err) {
    throw new UmlflowError(`could not write the skill to ${target}: ${errorMessage(err)}`, {
      code: 'SKILL_WRITE_FAILED',
      hint: 'Check that the directory is writable, or install into the project instead with `umlflow install-skill --project`.',
      cause: err,
    });
  }
  return existing === null ? 'installed' : 'updated';
}

export function registerSkill(program: Command): void {
  program
    .command('install-skill')
    .description('Install the /umlflow Claude Code skill (default: ~/.claude/skills/umlflow, available in every project)')
    .option('--project', "install into this project's .claude/skills instead of globally")
    .action(async (opts: { project?: boolean }, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      const root = (await ConfigStore.find(g.cwd)) ?? g.cwd;
      const target = skillTargetPath(opts.project ? 'project' : 'global', root);
      const status = await installSkill(target);
      out.line(`${pc.green('✓')} skill ${status}: ${target}`);
      out.line(pc.dim('Type /umlflow in Claude Code (any project). Try: /umlflow sequence "checkout"  or  /umlflow --help'));
      out.emitJson({ target, status });
    });
}
