import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { cleanup, read, tempRepo } from '../helpers.js';
import { IndexStore } from '../../src/index/store.js';
import { projectPaths } from '../../src/config/paths.js';
import { ConfigStore } from '../../src/config/store.js';
import { normalizeConfig, DEFAULT_CONFIG } from '../../src/config/schema.js';
import { initProject } from '../../src/config/init.js';
import { SemanticsStore, normalizeSemantics } from '../../src/model/semantics.js';
import { emptyCodeFile } from '../../src/codemodel/types.js';
import { fingerprint, stableStringify } from '../../src/core/hash.js';

let root: string;

beforeEach(async () => {
  root = await tempRepo('ts-shop');
});

afterEach(async () => {
  await cleanup(root);
});

describe('index store', () => {
  it('round-trips, detects corruption and version/parser mismatches', async () => {
    const store = new IndexStore(projectPaths(root), 'ts@1');
    expect((await store.loadIndex()).reason).toBe('missing');
    await store.saveIndex({ 'a.ts': emptyCodeFile('a.ts', 'typescript', 'h1', 'ok') });
    expect(Object.keys((await store.loadIndex()).index!.files)).toEqual(['a.ts']);
    expect((await store.health()).corrupt).toBe(false);
    const other = new IndexStore(projectPaths(root), 'ts@2');
    expect((await other.loadIndex()).reason).toBe('parser version changed');
    await fs.writeFile(store.paths.indexFile, '{"version": 999, "files": {}}');
    expect((await store.loadIndex()).reason).toContain('version');
    await fs.writeFile(store.paths.indexFile, 'garbage');
    const h = await store.health();
    expect(h.corrupt).toBe(true);
    expect((await store.loadIndex()).index).toBeNull();
    expect(await store.loadDiagramState()).toEqual({});
    expect(await store.loadModel()).toBeNull();
    await store.clear();
    expect((await store.health()).present).toBe(false);
  });
});

describe('config', () => {
  it('normalises defaults and validates diagram definitions', () => {
    const cfg = normalizeConfig({ diagrams: { 'login-flow': { type: 'sequence', scope: { include: ['src/auth'] }, overrides: { labels: { AuthService: 'Auth' }, exclude: ['Logger'] } } } });
    expect(cfg.output.format).toBe('md');
    expect(cfg.git.hooks['pre-commit']).toBe('check');
    expect(cfg.analysis.exclude).toEqual(DEFAULT_CONFIG.analysis.exclude);
    expect(cfg.diagrams['login-flow']).toMatchObject({ type: 'sequence', scope: { include: ['src/auth'] }, overrides: { labels: { AuthService: 'Auth' }, exclude: ['Logger'] } });
    expect(() => normalizeConfig({ diagrams: { bad: {} } })).toThrow(/type is required/);
    expect(() => normalizeConfig({ diagrams: { 'bad name': { type: 'erd' } } })).toThrow(/diagram name/);
    expect(() => normalizeConfig({ git: { hooks: { 'pre-commit': 'maybe' } } })).toThrow(/must be one of/);
    expect(() => normalizeConfig({ output: { format: 'svg' } })).toThrow(/output.format/);
  });

  it('init creates files and refuses to overwrite without --force; store preserves comments', async () => {
    const r = await initProject({ root, diagramTypes: ['erd'], hookMode: 'update' });
    expect(r.diagrams).toEqual(['database-erd']);
    expect(r.created).toEqual(['.umlflow/config.yaml', '.umlflow/semantics.yaml', '.umlflow/.gitignore']);
    await expect(initProject({ root, diagramTypes: ['erd'] })).rejects.toThrow(/already initialized/);
    const file = path.join(root, '.umlflow/config.yaml');
    let text = await fs.readFile(file, 'utf8');
    expect(text).toContain('pre-commit: update');
    text = text.replace('diagrams:', '# my diagrams\ndiagrams:');
    await fs.writeFile(file, text);
    const store = new ConfigStore(root);
    await store.load();
    await store.setDiagram('x', { type: 'usecase', description: 'x' });
    await store.setInferredScope('x', { query: 'q', entryPoints: ['A.b'] });
    const after = await read(root, '.umlflow/config.yaml');
    expect(after).toContain('# my diagrams');
    expect(after).toContain('# UMLFlow project configuration');
    expect(after).toMatch(/entryPoints:\n\s+- A\.b/);
    expect(store.get().diagrams.x?.inferredScope?.query).toBe('q');
    expect(await store.removeDiagram('x')).toBe(true);
    expect(store.get().diagrams.x).toBeUndefined();
    expect(await ConfigStore.find(path.join(root, 'src/orders'))).toBe(root);
  });

  it('semantics store validates sources and protects user facts', async () => {
    const file = path.join(root, 'sem.yaml');
    const store = new SemanticsStore(file);
    await store.load();
    expect(await store.set('components', 'A', { role: 'service' }, 'semantic-inference')).toBe(true);
    expect(await store.set('components', 'A', { role: 'gateway' }, 'user')).toBe(true);
    expect(await store.set('components', 'A', { role: 'service' }, 'semantic-inference')).toBe(false);
    expect(store.get().components.A).toEqual({ role: 'gateway', source: 'user' });
    const reloaded = new SemanticsStore(file);
    expect((await reloaded.load()).components.A?.source).toBe('user');
    expect(() => normalizeSemantics({ components: { A: { source: 'llm' } } })).toThrow(/source must be/);
    expect(await store.remove('components', 'A')).toBe(true);
    expect(await store.remove('components', 'A')).toBe(false);
  });

  it('fingerprints are order-independent', () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(fingerprint({ b: 1, a: 2 })).toBe(fingerprint({ a: 2, b: 1 }));
  });
});

describe('semantics.yaml header', () => {
  it('is written once and never stacked on repeated saves', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'umlflow-sem-'));
    try {
      const file = path.join(dir, 'semantics.yaml');
      const store = new SemanticsStore(file);
      await store.load();
      for (let i = 0; i < 5; i++) await store.set('actors', `Actor${i}`, {}, 'user');
      const once = (await fs.readFile(file, 'utf8')).split('# UMLFlow semantic facts').length - 1;
      expect(once).toBe(1);

      // A store re-opened on the existing file must not add a second copy: the
      // YAML parser hangs the leading comment on the first key, not on the document.
      const reopened = new SemanticsStore(file);
      await reopened.load();
      await reopened.set('actors', 'Later', {}, 'user');
      const after = (await fs.readFile(file, 'utf8')).split('# UMLFlow semantic facts').length - 1;
      expect(after).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
