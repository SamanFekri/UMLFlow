import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}

export async function readTextOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Write atomically (temp file + rename) so a crash never leaves a half-written file. */
export async function writeText(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, p);
}

export async function writeJson(p: string, value: unknown): Promise<void> {
  await writeText(p, JSON.stringify(value, null, 0) + '\n');
}

export async function readJson<T>(p: string): Promise<T | null> {
  const text = await readTextOrNull(p);
  if (text === null) return null;
  return JSON.parse(text) as T;
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function removeFile(p: string): Promise<void> {
  await fs.rm(p, { force: true });
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Normalise a repo-relative path to forward slashes, no leading "./". */
export function normalizeRel(p: string): string {
  let out = toPosix(p);
  while (out.startsWith('./')) out = out.slice(2);
  return out;
}

export interface WalkOptions {
  /** Directory names to skip anywhere in the tree. */
  ignoreDirs: Set<string>;
  /** Glob-like path patterns (repo-relative) to skip. Supports `*`, `**`, `?`. */
  ignorePatterns: string[];
  /** Maximum file size in bytes; larger files are skipped. */
  maxFileSize: number;
}

export const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
]);

/**
 * Recursively list files under `root`, returning repo-relative POSIX paths in
 * deterministic (sorted) order.
 */
export async function walkFiles(root: string, options: WalkOptions): Promise<string[]> {
  const results: string[] = [];
  const matchers = options.ignorePatterns.map(globToRegExp);
  async function visit(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (options.ignoreDirs.has(entry.name)) continue;
        if (matchers.some((m) => m.test(relPath) || m.test(relPath + '/'))) continue;
        await visit(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        if (matchers.some((m) => m.test(relPath))) continue;
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          if (stat.size > options.maxFileSize) continue;
        } catch {
          continue;
        }
        results.push(relPath);
      }
    }
  }
  await visit(root, '');
  return results;
}

/** Convert a simple glob (supports `**`, `*`, `?`) into an anchored RegExp on POSIX paths. */
export function globToRegExp(glob: string): RegExp {
  let g = normalizeRel(glob);
  // A bare directory name or trailing slash means "that directory and everything under it".
  if (g.endsWith('/')) g = g + '**';
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  // "src/auth" should match "src/auth" and everything under it.
  return new RegExp(`^${re}(?:/.*)?$`);
}

export function matchesAny(rel: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((p) => globToRegExp(p).test(rel));
}
