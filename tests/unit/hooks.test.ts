import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { cleanup, git, tempRepo } from '../helpers.js';
import { HOOK_BEGIN, HOOK_END, hookStatus, installHook, managedSection, uninstallHook } from '../../src/hooks/install.js';

let root: string;
let hooksDir: string;

beforeEach(async () => {
  root = await tempRepo('ts-shop', { git: true });
  hooksDir = path.join(root, '.git', 'hooks');
});

afterEach(async () => {
  await cleanup(root);
});

describe('git hooks', () => {
  it('creates a hook when none exists', async () => {
    const r = await installHook(root, 'pre-commit');
    expect(r.status).toBe('created');
    const text = await fs.readFile(r.file, 'utf8');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain(HOOK_BEGIN);
    expect(text).toContain('hook pre-commit');
    const stat = await fs.stat(r.file);
    expect(stat.mode & 0o111).not.toBe(0);
    expect(await hookStatus(root, 'pre-commit')).toBe('installed');
  });

  it('appends to an existing hook without touching its logic', async () => {
    const file = path.join(hooksDir, 'pre-commit');
    await fs.writeFile(file, '#!/bin/bash\nnpm test\n');
    const r = await installHook(root, 'pre-commit');
    expect(r.status).toBe('appended');
    const text = await fs.readFile(file, 'utf8');
    expect(text.startsWith('#!/bin/bash\nnpm test\n')).toBe(true);
    expect(text.trimEnd().endsWith(HOOK_END)).toBe(true);
  });

  it('is idempotent and replaces an outdated managed section', async () => {
    const file = path.join(hooksDir, 'pre-commit');
    await fs.writeFile(file, `#!/bin/sh\necho before\n${HOOK_BEGIN} old\nold stuff\n${HOOK_END}\necho after\n`);
    const r1 = await installHook(root, 'pre-commit');
    expect(r1.status).toBe('replaced');
    const text = await fs.readFile(file, 'utf8');
    expect(text).toContain('echo before\n');
    expect(text).toContain('\necho after\n');
    expect(text).not.toContain('old stuff');
    expect(text.split(HOOK_BEGIN).length).toBe(2);
    const r2 = await installHook(root, 'pre-commit');
    expect(r2.status).toBe('unchanged');
    expect(await fs.readFile(file, 'utf8')).toBe(text);
    expect(await hookStatus(root, 'pre-commit')).toBe('installed');
  });

  it('uninstall removes only the managed section, deleting the file when nothing else remains', async () => {
    const file = path.join(hooksDir, 'pre-commit');
    await fs.writeFile(file, '#!/bin/sh\nnpm test\n');
    await installHook(root, 'pre-commit');
    const r = await uninstallHook(root, 'pre-commit');
    expect(r.status).toBe('removed');
    expect(await fs.readFile(file, 'utf8')).toBe('#!/bin/sh\nnpm test\n');
    await fs.rm(file);
    await installHook(root, 'pre-commit');
    const r2 = await uninstallHook(root, 'pre-commit');
    expect(r2.status).toBe('deleted');
    await expect(fs.access(file)).rejects.toThrow();
    expect((await uninstallHook(root, 'pre-commit')).status).toBe('absent');
    expect(await hookStatus(root, 'pre-commit')).toBe('absent');
  });

  it('honours core.hooksPath and records a fallback binary', async () => {
    git(root, 'config', 'core.hooksPath', '.githooks');
    const r = await installHook(root, 'pre-push', { recordedBin: '/opt/umlflow/bin/umlflow.js' });
    expect(r.file).toBe(path.join(root, '.githooks', 'pre-push'));
    expect(await fs.readFile(r.file, 'utf8')).toContain('/opt/umlflow/bin/umlflow.js');
    expect(managedSection('pre-push')).not.toContain('/opt/');
  });

  it('rejects unsupported hooks and non-git directories', async () => {
    await expect(installHook(root, 'post-rewrite')).rejects.toThrow(/Unsupported hook/);
    const plain = await tempRepo('ts-shop');
    await expect(installHook(plain, 'pre-commit')).rejects.toThrow(/not a git repository/);
    await cleanup(plain);
  });
});
