import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { cleanup, git, tempRepo, write } from '../helpers.js';
import { detectChanges, diffHashSnapshots, makeFileFilter, type ChangeSet } from '../../src/change/detector.js';
import { Git, parseNameStatus } from '../../src/change/git.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import { globToRegExp } from '../../src/core/fs.js';

let root: string;
const analysis = DEFAULT_CONFIG.analysis;
const isSupported = (p: string) => /\.(ts|sql)$/.test(p);

async function snapshot(): Promise<Map<string, string>> {
  const c = await detectChanges({ root, analysis, previous: new Map(), isSupported });
  return new Map(c.current.map((f) => [f.path, f.hash]));
}

function summary(c: ChangeSet) {
  return { added: c.added, modified: c.modified, deleted: c.deleted, renamed: c.renamed };
}

beforeEach(async () => {
  root = await tempRepo('ts-shop', { git: true });
});

afterEach(async () => {
  await cleanup(root);
});

describe('change detection', () => {
  it('first run sees every supported file as added; second run sees nothing', async () => {
    const first = await detectChanges({ root, analysis, previous: new Map(), isSupported });
    expect(first.added.length).toBe(17);
    expect(first.added).toContain('db/001_init.sql');
    expect(first.added).not.toContain('package.json');
    expect(first.gitUsed).toBe(true);
    const prev = await snapshot();
    const second = await detectChanges({ root, analysis, previous: prev, isSupported });
    expect(summary(second)).toEqual({ added: [], modified: [], deleted: [], renamed: [] });
  });

  it('detects uncommitted edits, additions and deletions via content hashes', async () => {
    const prev = await snapshot();
    await write(root, 'src/orders/order.service.ts', '// changed\n' + (await fs.readFile(path.join(root, 'src/orders/order.service.ts'), 'utf8')));
    await write(root, 'src/new.ts', 'export const x = 1;\n');
    await fs.rm(path.join(root, 'src/shared/logger.ts'));
    const c = await detectChanges({ root, analysis, previous: prev, isSupported });
    expect(summary(c)).toEqual({ added: ['src/new.ts'], modified: ['src/orders/order.service.ts'], deleted: ['src/shared/logger.ts'], renamed: [] });
  });

  it('touching a file without changing content is not a change', async () => {
    const prev = await snapshot();
    const file = path.join(root, 'src/orders/order.service.ts');
    const text = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, text);
    const c = await detectChanges({ root, analysis, previous: prev, isSupported });
    expect(summary(c)).toEqual({ added: [], modified: [], deleted: [], renamed: [] });
  });

  it('attributes git renames (staged) and committed changes, and rename+edit as modification', async () => {
    const prev = await snapshot();
    git(root, 'mv', 'src/shared/logger.ts', 'src/shared/log.ts');
    const c = await detectChanges({ root, analysis, previous: prev, isSupported });
    expect(c.renamed).toEqual([{ from: 'src/shared/logger.ts', to: 'src/shared/log.ts' }]);
    expect(c.added).toEqual([]);
    expect(c.deleted).toEqual([]);
    git(root, 'commit', '-qm', 'rename');
    // committed change: still visible against the previous index snapshot
    await write(root, 'src/shared/log.ts', 'export class Logger { info(m: string) {} warn(m: string) {} }\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'edit');
    const c2 = await detectChanges({ root, analysis, previous: prev, isSupported });
    // rename followed by content change: detected as a rename target with new content
    expect(c2.renamed.length + c2.added.length).toBe(1);
    expect(c2.deleted.concat(c2.renamed.map((r) => r.from))).toContain('src/shared/logger.ts');
  });

  it('branch switches are just content changes relative to the index', async () => {
    const prev = await snapshot();
    git(root, 'checkout', '-qb', 'feature');
    await write(root, 'src/feature.ts', 'export const f = 1;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'feature');
    const onFeature = await detectChanges({ root, analysis, previous: prev, isSupported });
    expect(onFeature.added).toEqual(['src/feature.ts']);
    const prevFeature = new Map(onFeature.current.map((f) => [f.path, f.hash]));
    git(root, 'checkout', '-q', 'main');
    const backOnMain = await detectChanges({ root, analysis, previous: prevFeature, isSupported });
    expect(backOnMain.deleted).toEqual(['src/feature.ts']);
  });

  it('works without git (hash-only) and respects include/exclude', async () => {
    const plain = await tempRepo('ts-shop');
    const c = await detectChanges({ root: plain, analysis, previous: new Map(), isSupported });
    expect(c.gitUsed).toBe(false);
    expect(c.added.length).toBe(17);
    const scoped = await detectChanges({ root: plain, analysis: { ...analysis, include: ['src/auth/**'] }, previous: new Map(), isSupported });
    expect(scoped.added).toEqual(['src/auth/auth.controller.ts', 'src/auth/auth.service.ts', 'src/auth/session.manager.ts']);
    await cleanup(plain);
  });

  it('git wrapper parses name-status output and exposes branch info', async () => {
    expect(parseNameStatus('M\0a.ts\0A\0b.ts\0D\0c.ts\0R100\0old.ts\0new.ts\0')).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'b.ts', status: 'added' },
      { path: 'c.ts', status: 'deleted' },
      { path: 'new.ts', oldPath: 'old.ts', status: 'renamed' },
    ]);
    const g = new Git(root);
    expect(await g.isRepo()).toBe(true);
    expect(await g.currentBranch()).toBe('main');
    expect((await g.lsFiles()).length).toBeGreaterThan(10);
    await write(root, 'src/x.ts', '');
    expect(await g.untrackedFiles()).toEqual(['src/x.ts']);
    git(root, 'add', 'src/x.ts');
    expect(await g.stagedChanges()).toEqual([{ path: 'src/x.ts', status: 'added' }]);
    git(root, 'commit', '-qm', 'x');
    expect(await g.changesBetween('HEAD~1')).toEqual([{ path: 'src/x.ts', status: 'added' }]);
  });

  it('diffs hash snapshots and detects moves by identical content', () => {
    const c = diffHashSnapshots({ 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' }, { 'a.ts': '1', 'b2.ts': '2', 'c.ts': '4', 'd.ts': '5' });
    expect(summary(c)).toEqual({ added: ['d.ts'], modified: ['c.ts'], deleted: [], renamed: [{ from: 'b.ts', to: 'b2.ts' }] });
  });

  it('file filter and globs', () => {
    const filter = makeFileFilter({ ...analysis, include: [], exclude: ['**/*.test.*', 'legacy/**'] });
    expect(filter('src/a.ts')).toBe(true);
    expect(filter('src/a.test.ts')).toBe(false);
    expect(filter('legacy/x.ts')).toBe(false);
    expect(filter('.umlflow/diagrams/x.md')).toBe(false);
    expect(globToRegExp('src/auth').test('src/auth/x.ts')).toBe(true);
    expect(globToRegExp('src/auth').test('src/authz/x.ts')).toBe(false);
    expect(globToRegExp('**/*.ts').test('a/b/c.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('a/b.ts')).toBe(false);
  });
});
