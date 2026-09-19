import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { normalizeRel } from '../core/fs.js';

const execFileAsync = promisify(execFile);

export interface GitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

/** Thin wrapper over the git CLI. Every method degrades gracefully when git is unavailable. */
export class Git {
  constructor(readonly root: string) {}

  async run(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.root, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  }

  async isRepo(): Promise<boolean> {
    try {
      const out = await this.run(['rev-parse', '--is-inside-work-tree']);
      return out.trim() === 'true';
    } catch {
      return false;
    }
  }

  async topLevel(): Promise<string | null> {
    try {
      return path.resolve((await this.run(['rev-parse', '--show-toplevel'])).trim());
    } catch {
      return null;
    }
  }

  async head(): Promise<string | null> {
    try {
      return (await this.run(['rev-parse', 'HEAD'])).trim();
    } catch {
      return null;
    }
  }

  async currentBranch(): Promise<string | null> {
    try {
      const b = (await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      return b === 'HEAD' ? null : b;
    } catch {
      return null;
    }
  }

  async gitDir(): Promise<string | null> {
    try {
      const dir = (await this.run(['rev-parse', '--git-dir'])).trim();
      return path.resolve(this.root, dir);
    } catch {
      return null;
    }
  }

  async hooksDir(): Promise<string | null> {
    try {
      const configured = (await this.run(['config', '--get', 'core.hooksPath'])).trim();
      if (configured) return path.resolve(this.root, configured);
    } catch {
      /* not configured */
    }
    const gitDir = await this.gitDir();
    return gitDir ? path.join(gitDir, 'hooks') : null;
  }

  /** Tracked files, repo-relative. */
  async lsFiles(): Promise<string[]> {
    const out = await this.run(['ls-files', '-z']);
    return out.split('\0').filter(Boolean).map(normalizeRel);
  }

  /** Files changed between `base` and the working tree (or `head` if given), including renames. */
  async diffNames(base: string, head?: string, staged = false): Promise<GitFileChange[]> {
    const args = ['diff', '--name-status', '-z', '-M'];
    if (staged) args.push('--cached');
    args.push(base);
    if (head) args.push(head);
    let out: string;
    try {
      out = await this.run(args);
    } catch {
      return [];
    }
    return parseNameStatus(out);
  }

  /** Staged changes relative to HEAD. */
  async stagedChanges(): Promise<GitFileChange[]> {
    return this.diffNames('HEAD', undefined, true);
  }

  /** All changes (staged + unstaged) relative to HEAD. */
  async workingTreeChanges(): Promise<GitFileChange[]> {
    const tracked = await this.diffNames('HEAD');
    const untracked = await this.untrackedFiles();
    return [...tracked, ...untracked.map((p) => ({ path: p, status: 'added' as const }))];
  }

  async untrackedFiles(): Promise<string[]> {
    try {
      const out = await this.run(['ls-files', '--others', '--exclude-standard', '-z']);
      return out.split('\0').filter(Boolean).map(normalizeRel);
    } catch {
      return [];
    }
  }

  /** Changes between two commits/branches. */
  async changesBetween(base: string, head = 'HEAD'): Promise<GitFileChange[]> {
    return this.diffNames(base, head);
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    try {
      return (await this.run(['merge-base', a, b])).trim();
    } catch {
      return null;
    }
  }

  async add(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.run(['add', '--', ...files]);
  }
}

export function parseNameStatus(out: string): GitFileChange[] {
  const parts = out.split('\0').filter((p) => p.length > 0);
  const changes: GitFileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i]!;
    const code = status[0]!;
    if (code === 'R' || code === 'C') {
      const oldPath = parts[++i];
      const newPath = parts[++i];
      if (oldPath && newPath) {
        changes.push({ path: normalizeRel(newPath), oldPath: normalizeRel(oldPath), status: 'renamed' });
      }
      continue;
    }
    const file = parts[++i];
    if (!file) continue;
    const p = normalizeRel(file);
    if (code === 'A') changes.push({ path: p, status: 'added' });
    else if (code === 'D') changes.push({ path: p, status: 'deleted' });
    else changes.push({ path: p, status: 'modified' });
  }
  return changes;
}
