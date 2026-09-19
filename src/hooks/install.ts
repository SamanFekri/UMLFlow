import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Git } from '../change/git.js';
import { UmlflowError } from '../core/errors.js';
import { exists, readTextOrNull } from '../core/fs.js';
import { SUPPORTED_HOOKS } from '../config/schema.js';

export const HOOK_BEGIN = '# UMLFLOW BEGIN';
export const HOOK_END = '# UMLFLOW END';

/**
 * The managed section delegates to `umlflow hook <name>`, which reads the
 * configured mode (update / check / off) at run time. Installing therefore
 * never needs to be repeated when the mode changes.
 */
export function managedSection(hook: string, recordedBin?: string): string {
  const recorded = recordedBin ? [`elif [ -x "${recordedBin}" ]; then umlflow_bin="${recordedBin}"`] : [];
  return [
    `${HOOK_BEGIN} (managed by UMLFlow — do not edit; \`umlflow uninstall-hooks\` removes this block)`,
    'umlflow_bin=""',
    'if command -v umlflow >/dev/null 2>&1; then umlflow_bin="umlflow"',
    'elif [ -x "./node_modules/.bin/umlflow" ]; then umlflow_bin="./node_modules/.bin/umlflow"',
    ...recorded,
    'elif command -v npx >/dev/null 2>&1; then umlflow_bin="npx --no umlflow"',
    'fi',
    'if [ -n "$umlflow_bin" ]; then',
    `  $umlflow_bin hook ${hook} || exit $?`,
    'else',
    `  echo "umlflow: CLI not found; skipping UMLFlow ${hook} hook" >&2`,
    'fi',
    HOOK_END,
  ].join('\n');
}

function findSection(text: string): { start: number; end: number } | null {
  const start = text.indexOf(HOOK_BEGIN);
  if (start < 0) return null;
  const endIdx = text.indexOf(HOOK_END, start);
  if (endIdx < 0) return null;
  let end = endIdx + HOOK_END.length;
  if (text[end] === '\n') end++;
  return { start, end };
}

export type HookInstallStatus = 'created' | 'appended' | 'replaced' | 'unchanged';

export interface HookInstallResult {
  hook: string;
  file: string;
  status: HookInstallStatus;
}

export async function resolveHooksDir(root: string): Promise<string> {
  const git = new Git(root);
  if (!(await git.isRepo())) throw new UmlflowError(`${root} is not a git repository`, { hint: 'Run `git init` first.' });
  const dir = await git.hooksDir();
  if (!dir) throw new UmlflowError('Could not determine the git hooks directory');
  return dir;
}

/** Install (idempotently) the managed section into a hook, preserving unrelated content. */
export async function installHook(root: string, hook: string, options: { recordedBin?: string } = {}): Promise<HookInstallResult> {
  if (!SUPPORTED_HOOKS.includes(hook)) throw new UmlflowError(`Unsupported hook "${hook}"`, { hint: `Supported: ${SUPPORTED_HOOKS.join(', ')}` });
  const dir = await resolveHooksDir(root);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, hook);
  const section = managedSection(hook, options.recordedBin);
  const existing = await readTextOrNull(file);
  let status: HookInstallStatus;
  let next: string;
  if (existing === null) {
    next = `#!/bin/sh\n${section}\n`;
    status = 'created';
  } else {
    const found = findSection(existing);
    if (found) {
      const current = existing.slice(found.start, found.end).replace(/\n$/, '');
      if (current === section) {
        status = 'unchanged';
        next = existing;
      } else {
        next = existing.slice(0, found.start) + section + '\n' + existing.slice(found.end);
        status = 'replaced';
      }
    } else {
      const base = existing.length === 0 ? '#!/bin/sh\n' : existing.endsWith('\n') ? existing : existing + '\n';
      next = `${base}${section}\n`;
      status = 'appended';
    }
  }
  if (status !== 'unchanged') await fs.writeFile(file, next, 'utf8');
  await fs.chmod(file, 0o755).catch(() => undefined);
  return { hook, file, status };
}

export interface HookUninstallResult {
  hook: string;
  file: string;
  status: 'removed' | 'deleted' | 'absent';
}

/** Remove the managed section; delete the file only if nothing but a shebang remains. */
export async function uninstallHook(root: string, hook: string): Promise<HookUninstallResult> {
  const dir = await resolveHooksDir(root);
  const file = path.join(dir, hook);
  const existing = await readTextOrNull(file);
  if (existing === null) return { hook, file, status: 'absent' };
  const found = findSection(existing);
  if (!found) return { hook, file, status: 'absent' };
  const remaining = existing.slice(0, found.start) + existing.slice(found.end);
  if (/^(#![^\n]*\n?)?\s*$/.test(remaining)) {
    await fs.rm(file, { force: true });
    return { hook, file, status: 'deleted' };
  }
  await fs.writeFile(file, remaining, 'utf8');
  return { hook, file, status: 'removed' };
}

export async function hookStatus(root: string, hook: string): Promise<'installed' | 'foreign' | 'absent'> {
  const dir = await resolveHooksDir(root).catch(() => null);
  if (!dir) return 'absent';
  const file = path.join(dir, hook);
  if (!(await exists(file))) return 'absent';
  const text = await readTextOrNull(file);
  if (text === null) return 'absent';
  return findSection(text) ? 'installed' : 'foreign';
}
