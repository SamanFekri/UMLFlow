import path from 'node:path';
import { promises as fs } from 'node:fs';
import { sha256, shortHash } from '../core/hash.js';
import { DEFAULT_IGNORE_DIRS, matchesAny, walkFiles } from '../core/fs.js';
import type { AnalysisConfig } from '../config/schema.js';
import { Git, type GitFileChange } from './git.js';

export interface FileEntry {
  path: string;
  hash: string;
  size: number;
}

export interface ChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: { from: string; to: string }[];
  /** Files considered for analysis after this change set (the new universe). */
  current: FileEntry[];
  /** Whether git contributed information to this change set. */
  gitUsed: boolean;
}

export function isEmptyChangeSet(c: ChangeSet): boolean {
  return c.added.length === 0 && c.modified.length === 0 && c.deleted.length === 0 && c.renamed.length === 0;
}

export function changedPaths(c: ChangeSet): string[] {
  return [...c.added, ...c.modified, ...c.renamed.map((r) => r.to)];
}

/**
 * Decides which files belong to the analysis universe. Respects config includes/excludes
 * and built-in ignores. Language support is decided later by the parser registry.
 */
export function makeFileFilter(analysis: AnalysisConfig, extraExcludes: string[] = []): (rel: string) => boolean {
  const excludes = [...analysis.exclude, ...extraExcludes, '.umlflow/**'];
  return (rel: string) => {
    if (analysis.include.length > 0 && !matchesAny(rel, analysis.include)) return false;
    if (matchesAny(rel, excludes)) return false;
    return true;
  };
}

export async function hashFile(abs: string): Promise<{ hash: string; size: number } | null> {
  try {
    const buf = await fs.readFile(abs);
    return { hash: shortHash(buf), size: buf.length };
  } catch {
    return null;
  }
}

export interface DetectOptions {
  root: string;
  analysis: AnalysisConfig;
  /** Previously indexed files and hashes. Empty on first run. */
  previous: Map<string, string>;
  /** Only consider files that pass this predicate (in addition to config). */
  isSupported: (rel: string) => boolean;
}

/**
 * Change detection = git (fast candidate discovery, renames) + content hashes
 * (ground truth). The hash comparison is authoritative: a file is only
 * "modified" if its content hash differs from the index, regardless of what
 * git thinks. Git is used to attribute renames and to cheaply discover
 * candidates; when the index is empty every file is a candidate.
 */
export async function detectChanges(options: DetectOptions): Promise<ChangeSet> {
  const { root, analysis, previous, isSupported } = options;
  const filter = makeFileFilter(analysis);
  const all = await walkFiles(root, {
    ignoreDirs: DEFAULT_IGNORE_DIRS,
    ignorePatterns: [],
    maxFileSize: analysis.maxFileSize,
  });
  const universe = all.filter((p) => filter(p) && isSupported(p));

  const git = new Git(root);
  let gitChanges: GitFileChange[] = [];
  let gitUsed = false;
  if (await git.isRepo()) {
    try {
      gitChanges = await git.workingTreeChanges();
      gitUsed = true;
    } catch {
      gitUsed = false;
    }
  }
  const renameByNew = new Map<string, string>();
  for (const c of gitChanges) if (c.status === 'renamed' && c.oldPath) renameByNew.set(c.path, c.oldPath);

  const current: FileEntry[] = [];
  const added: string[] = [];
  const modified: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const seen = new Set<string>();

  for (const rel of universe) {
    const hashed = await hashFile(path.join(root, rel));
    if (!hashed) continue;
    seen.add(rel);
    current.push({ path: rel, hash: hashed.hash, size: hashed.size });
    const prev = previous.get(rel);
    if (prev === undefined) {
      const from = renameByNew.get(rel);
      if (from && previous.has(from) && !seen.has(from)) {
        renamed.push({ from, to: rel });
      } else {
        added.push(rel);
      }
    } else if (prev !== hashed.hash) {
      modified.push(rel);
    }
  }
  const renamedFrom = new Set(renamed.map((r) => r.from));
  const deleted: string[] = [];
  for (const prevPath of previous.keys()) {
    if (!seen.has(prevPath) && !renamedFrom.has(prevPath)) deleted.push(prevPath);
  }
  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    renamed: renamed.sort((a, b) => (a.to < b.to ? -1 : 1)),
    current,
    gitUsed,
  };
}

/**
 * Change set between two hash snapshots (no file system or git access).
 * A deleted path and an added path with identical content are reported as a rename.
 */
export function diffHashSnapshots(previous: Record<string, string>, current: Record<string, string>): ChangeSet {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [p, h] of Object.entries(current)) {
    const prev = previous[p];
    if (prev === undefined) added.push(p);
    else if (prev !== h) modified.push(p);
  }
  for (const p of Object.keys(previous)) if (!(p in current)) deleted.push(p);
  const renamed: { from: string; to: string }[] = [];
  for (const d of [...deleted]) {
    const hash = previous[d]!;
    const match = added.find((a) => current[a] === hash);
    if (match) {
      renamed.push({ from: d, to: match });
      deleted.splice(deleted.indexOf(d), 1);
      added.splice(added.indexOf(match), 1);
    }
  }
  return {
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
    renamed: renamed.sort((a, b) => (a.to < b.to ? -1 : 1)),
    current: Object.entries(current).map(([path, hash]) => ({ path, hash, size: 0 })),
    gitUsed: false,
  };
}

export { sha256 };
