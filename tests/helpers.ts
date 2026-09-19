import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createDefaultRegistry } from '../src/parsers/registry.js';
import { parseFiles } from '../src/index/parse.js';
import { buildSystemModel } from '../src/model/build.js';
import { emptySemantics, type SemanticsData } from '../src/model/semantics.js';
import { walkFiles, DEFAULT_IGNORE_DIRS } from '../src/core/fs.js';
import type { SystemModel } from '../src/model/types.js';

export const FIXTURES = path.resolve(__dirname, 'fixtures/repos');

export async function analyzeFixture(repo: string, semantics: SemanticsData = emptySemantics()): Promise<SystemModel> {
  const root = path.join(FIXTURES, repo);
  const registry = createDefaultRegistry();
  const files = await walkFiles(root, { ignoreDirs: DEFAULT_IGNORE_DIRS, ignorePatterns: [], maxFileSize: 1e6 });
  const parsed = await parseFiles(root, files.map((p) => ({ path: p, hash: 'h' })), files, registry);
  return buildSystemModel({ files: parsed, semantics, maxCallDepth: 6 });
}

/** Copy a fixture repo into a fresh temp dir (optionally git-initialised with an initial commit). */
export async function tempRepo(fixture: string, options: { git?: boolean } = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'umlflow-'));
  await fs.cp(path.join(FIXTURES, fixture), dir, { recursive: true });
  if (options.git) {
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export async function write(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

export async function read(root: string, rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), 'utf8');
}

export async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
