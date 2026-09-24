import path from 'node:path';
import { ConfigStore } from '../config/store.js';
import type { DiagramDefinition, UmlflowConfig } from '../config/schema.js';
import { IndexStore, type DiagramState } from '../index/store.js';
import { parseFiles } from '../index/parse.js';
import { createDefaultRegistry, type ParserRegistry } from '../parsers/registry.js';
import { detectChanges, changedPaths, diffHashSnapshots, isEmptyChangeSet, type ChangeSet } from '../change/detector.js';
import { buildSystemModel } from '../model/build.js';
import { SemanticsStore } from '../model/semantics.js';
import { ModelIndex, type SystemModel } from '../model/types.js';
import type { CodeFile } from '../codemodel/types.js';
import { createDefaultGenerators, createDefaultRenderers } from '../diagrams/index.js';
import { inferScope, resolveScope, type ScopeInferenceResult } from '../diagrams/scope.js';
import type { GeneratorRegistry } from '../diagrams/generator.js';
import type { RendererRegistry } from '../render/renderer.js';
import { fingerprint } from '../core/hash.js';
import { exists, matchesAny, readTextOrNull, removeFile, writeText } from '../core/fs.js';
import { UmlflowError } from '../core/errors.js';
import { UNKNOWN_ACTOR_ID } from '../diagrams/ir.js';
import { composeGeneratedBlock, composeMermaidMirror, extractGeneratedBlock, extractManualDiagramLines, generatedFingerprint, mergeOutput, mermaidMirrorFileName, outputFileName } from './output.js';
import { diffModels, type ModelDiff } from './diff.js';

export interface IndexRefreshResult {
  /** Changes relative to the parse cache (what had to be re-parsed). */
  changes: ChangeSet;
  /** Changes relative to the last synchronisation (what diagrams may be affected by). */
  sinceSync: ChangeSet;
  /** True when no sync baseline existed (first run or cache cleared). */
  noBaseline: boolean;
  /** Number of files parsed in this refresh (only changed ones plus their importers). */
  parsed: number;
  /** Total files in the index afterwards. */
  total: number;
  /** True when no usable cache existed and everything was parsed. */
  rebuilt: boolean;
  reason?: string;
}

export type OutcomeStatus = 'updated' | 'created' | 'unchanged' | 'skipped' | 'stale' | 'fresh' | 'missing' | 'error';

export interface DiagramOutcome {
  name: string;
  type: string;
  file: string;
  status: OutcomeStatus;
  reason?: string;
  notes?: { level: string; text: string }[];
}

export interface UpdateResult {
  index: IndexRefreshResult;
  diagrams: DiagramOutcome[];
  questions: number;
  modelDiff: ModelDiff | null;
}

export interface CheckResult {
  index: IndexRefreshResult;
  diagrams: DiagramOutcome[];
  stale: boolean;
  questions: number;
}

export interface GeneratedDiagram {
  name: string;
  definition: DiagramDefinition;
  block: string;
  fullText: string;
  file: string;
  /** Plain-Mermaid mirror: absolute path + text, or null when output.mermaidDir is disabled. */
  mirror: { file: string; text: string } | null;
  state: DiagramState;
  notes: { level: string; text: string }[];
  changed: boolean;
  existed: boolean;
}

/**
 * The UMLFlow engine: one instance per project. Shared by every entry point
 * (CLI, git hooks, Claude skill) so behaviour is identical everywhere.
 */
export class Umlflow {
  readonly configStore: ConfigStore;
  readonly semanticsStore: SemanticsStore;
  readonly indexStore: IndexStore;
  readonly parsers: ParserRegistry;
  readonly generators: GeneratorRegistry;
  readonly renderers: RendererRegistry;
  private config!: UmlflowConfig;
  private files: Record<string, CodeFile> = {};
  private model: SystemModel | null = null;
  private indexLoaded = false;

  private constructor(readonly root: string) {
    this.configStore = new ConfigStore(root);
    this.semanticsStore = new SemanticsStore(this.configStore.paths.semanticsFile);
    this.parsers = createDefaultRegistry();
    this.generators = createDefaultGenerators();
    this.renderers = createDefaultRenderers();
    this.indexStore = new IndexStore(this.configStore.paths, this.parsers.version());
  }

  static async open(startDir: string): Promise<Umlflow> {
    const root = (await ConfigStore.find(startDir)) ?? path.resolve(startDir);
    const engine = new Umlflow(root);
    engine.config = await engine.configStore.load();
    await engine.semanticsStore.load();
    return engine;
  }

  getConfig(): UmlflowConfig {
    return this.config;
  }

  /* ------------------------------------------------------------------ index */

  /** Bring the local index up to date, parsing only changed files. */
  async refreshIndex(options: { force?: boolean } = {}): Promise<IndexRefreshResult> {
    let previous: Record<string, CodeFile> = {};
    let rebuilt = false;
    let reason: string | undefined;
    if (options.force) {
      rebuilt = true;
      reason = 'forced rebuild';
    } else {
      const loaded = await this.indexStore.loadIndex();
      if (loaded.index) previous = loaded.index.files;
      else {
        rebuilt = true;
        reason = loaded.reason;
      }
    }
    const previousHashes = new Map(Object.entries(previous).map(([p, f]) => [p, f.hash]));
    const changes = await detectChanges({
      root: this.root,
      analysis: this.config.analysis,
      previous: previousHashes,
      isSupported: (rel) => this.parsers.adapterFor(rel, this.config.analysis.languages) !== null,
    });
    const next: Record<string, CodeFile> = { ...previous };
    for (const d of changes.deleted) delete next[d];
    for (const r of changes.renamed) delete next[r.from];
    const toParse = changedPaths(changes);
    const universe = changes.current.map((c) => c.path);
    const hashes = new Map(changes.current.map((c) => [c.path, c.hash]));
    const parsed = await parseFiles(
      this.root,
      toParse.map((p) => ({ path: p, hash: hashes.get(p)! })),
      universe,
      this.parsers,
      this.config.analysis.languages,
    );
    Object.assign(next, parsed);
    let parsedCount = Object.keys(parsed).length;
    // Import resolution in unchanged files may now point to added/removed files: re-parse importers.
    const structural = [...changes.added, ...changes.deleted, ...changes.renamed.flatMap((r) => [r.from, r.to])];
    if (structural.length > 0 && !rebuilt) {
      const importers = Object.values(next).filter(
        (f) =>
          !toParse.includes(f.path) &&
          f.imports.some((i) => (i.resolvedFile && structural.includes(i.resolvedFile)) || (!i.resolvedFile && couldResolveTo(i.source, f.path, structural))),
      );
      const reparsed = await parseFiles(
        this.root,
        importers.map((f) => ({ path: f.path, hash: f.hash })),
        universe,
        this.parsers,
        this.config.analysis.languages,
      );
      Object.assign(next, reparsed);
      parsedCount += Object.keys(reparsed).length;
    }
    this.files = next;
    this.indexLoaded = true;
    this.model = null;
    await this.indexStore.saveIndex(next);
    const baseline = options.force ? null : await this.indexStore.loadSyncBaseline();
    const sinceSync = diffHashSnapshots(baseline ?? {}, this.currentHashes());
    return { changes, sinceSync, noBaseline: baseline === null, parsed: parsedCount, total: Object.keys(next).length, rebuilt, reason };
  }

  private currentHashes(): Record<string, string> {
    return Object.fromEntries(Object.values(this.files).map((f) => [f.path, f.hash]));
  }

  /** Mark the current code state as synchronised (baseline for future affected-diagram detection). */
  async markSynced(): Promise<void> {
    await this.indexStore.saveSyncBaseline(this.currentHashes());
    await this.indexStore.saveModel(await this.getModel());
  }

  /** Files currently in the index (after refreshIndex). */
  indexedFiles(): Record<string, CodeFile> {
    return this.files;
  }

  /* ------------------------------------------------------------------ model */

  async getModel(): Promise<SystemModel> {
    if (!this.indexLoaded) await this.refreshIndex();
    if (!this.model) {
      this.model = buildSystemModel({ files: this.files, semantics: this.semanticsStore.get(), maxCallDepth: this.config.analysis.maxCallDepth });
    }
    return this.model;
  }

  invalidateModel(): void {
    this.model = null;
  }

  /* --------------------------------------------------------------- diagrams */

  diagramFile(name: string, definition: DiagramDefinition): string {
    const renderer = this.renderers.get(definition.renderer ?? this.config.renderer);
    return path.join(this.root, this.config.output.dir, outputFileName(name, this.config.output.format, renderer));
  }

  /**
   * Absolute path of the diagram's plain-Mermaid mirror (`<mermaidDir>/<type>/<name>.mmd`),
   * or null when `output.mermaidDir` is disabled.
   */
  mermaidMirrorFile(name: string, definition: DiagramDefinition): string | null {
    const dir = this.config.output.mermaidDir;
    if (!dir) return null;
    const renderer = this.renderers.get(definition.renderer ?? this.config.renderer);
    return path.join(this.root, ...mermaidMirrorFileName(dir, definition.type, name, renderer).split('/'));
  }

  /** Generate one diagram in memory (no writes). */
  async generateDiagram(name: string, definition: DiagramDefinition, model?: SystemModel): Promise<GeneratedDiagram> {
    const m = model ?? (await this.getModel());
    const generator = this.generators.get(definition.type);
    const renderer = this.renderers.get(definition.renderer ?? this.config.renderer);
    if (!renderer.supports(definition.type)) throw new UmlflowError(`Renderer "${renderer.id}" cannot render "${definition.type}" diagrams`);
    const semantics = this.semanticsStore.get();
    const scope = resolveScope(definition, m, semantics, this.config.analysis.maxCallDepth);
    const result = generator.generate({ name, definition, model: m, index: new ModelIndex(m), scope, semantics });
    const file = this.diagramFile(name, definition);
    const existing = await readTextOrNull(file);
    const existingBlock = existing ? extractGeneratedBlock(existing, this.config.output.format, renderer) : null;
    const manualDiagramLines = extractManualDiagramLines(existingBlock, renderer);
    const rendered = renderer.render(result.diagram);
    const block = composeGeneratedBlock({ diagram: result.diagram, rendered, renderer, format: this.config.output.format, manualDiagramLines });
    const fullText = mergeOutput({ existing, block, format: this.config.output.format, renderer, name, title: result.diagram.title, description: definition.description });
    const modelIds = [...result.modelIds];
    if (result.diagram.notes.some((n) => n.level === 'unknown')) modelIds.push(UNKNOWN_ACTOR_ID);
    const state: DiagramState = {
      type: definition.type,
      files: result.files,
      modelIds,
      fingerprint: fingerprint(result.diagram),
      definitionHash: fingerprint(definition),
      semanticsHash: this.semanticsStore.hashFor(modelIds),
      outputHash: generatedFingerprint(block, renderer),
      generatedAt: new Date().toISOString(),
    };
    const changed = existingBlock === null || generatedFingerprint(existingBlock, renderer) !== state.outputHash;
    const mirrorFile = this.mermaidMirrorFile(name, definition);
    const mirror = mirrorFile
      ? {
          file: mirrorFile,
          text: composeMermaidMirror({ diagram: result.diagram, rendered, renderer, sourceFile: path.relative(this.root, file).split(path.sep).join('/') }),
        }
      : null;
    return { name, definition, block, fullText, file, mirror, state, notes: result.diagram.notes, changed, existed: existing !== null };
  }

  async writeDiagram(generated: GeneratedDiagram): Promise<void> {
    await writeText(generated.file, generated.fullText);
    // The mirror is fully derived, so it is rewritten whenever the canonical file is.
    if (generated.mirror) await writeText(generated.mirror.file, generated.mirror.text);
    await this.saveDiagramState(generated.name, generated.state);
  }

  private async saveDiagramState(name: string, state: DiagramState): Promise<void> {
    const states = await this.indexStore.loadDiagramState();
    states[name] = state;
    await this.indexStore.saveDiagramState(states);
  }

  /**
   * Which diagrams may be affected by the given changes? Uses recorded input
   * files/ids, definition and semantics fingerprints, and — for added files —
   * scope membership or imports pointing into a diagram's inputs.
   */
  async affectedDiagrams(changes: ChangeSet, options: { includeAllIfRebuilt?: boolean } = {}): Promise<Map<string, string>> {
    const states = await this.indexStore.loadDiagramState();
    const affected = new Map<string, string>();
    const changedSet = new Set([...changes.modified, ...changes.deleted, ...changes.renamed.flatMap((r) => [r.from, r.to])]);
    for (const [name, def] of Object.entries(this.config.diagrams)) {
      const state = states[name];
      if (!state) {
        affected.set(name, 'never generated');
        continue;
      }
      if (options.includeAllIfRebuilt) {
        affected.set(name, 'index rebuilt');
        continue;
      }
      if (state.definitionHash !== fingerprint(def)) {
        affected.set(name, 'definition changed');
        continue;
      }
      if (state.semanticsHash !== this.semanticsStore.hashFor(state.modelIds)) {
        affected.set(name, 'semantics changed');
        continue;
      }
      const hit = state.files.find((f) => changedSet.has(f));
      if (hit) {
        affected.set(name, `${hit} changed`);
        continue;
      }
      const scope = def.scope ?? {};
      const inferredFiles = new Set(def.inferredScope?.files ?? []);
      const userScoped = (scope.include && scope.include.length) || (scope.components && scope.components.length) || (scope.entryPoints && scope.entryPoints.length) || (scope.entities && scope.entities.length);
      const broad = !userScoped && inferredFiles.size === 0 && !(def.inferredScope?.entities?.length);
      const generator = this.generators.has(def.type) ? this.generators.get(def.type) : null;
      for (const added of changes.added) {
        const file = this.files[added];
        if (!file) continue;
        if (generator?.isFileRelevant && !generator.isFileRelevant(file)) continue;
        const inUserScope = scope.include && scope.include.length ? matchesAny(added, scope.include) && !matchesAny(added, scope.exclude ?? []) : false;
        const importsScoped = file.imports.some((i) => i.resolvedFile && state.files.includes(i.resolvedFile));
        if (broad || inUserScope || importsScoped) {
          affected.set(name, `${added} added`);
          break;
        }
      }
    }
    return affected;
  }

  /** Update affected (or named) diagrams. */
  async update(options: { names?: string[]; force?: boolean; all?: boolean } = {}): Promise<UpdateResult> {
    const index = await this.refreshIndex();
    const previousModel = await this.indexStore.loadModel();
    const model = await this.getModel();
    const outcomes: DiagramOutcome[] = [];
    let targets: Map<string, string>;
    if (options.names && options.names.length) {
      targets = new Map();
      for (const n of options.names) {
        if (!this.config.diagrams[n]) {
          throw new UmlflowError(`Diagram "${n}" is not defined`, { hint: `Known diagrams: ${Object.keys(this.config.diagrams).join(', ') || '(none)'}` });
        }
        targets.set(n, 'requested');
      }
    } else if (options.all || options.force) {
      targets = new Map(Object.keys(this.config.diagrams).map((n) => [n, 'forced']));
    } else {
      targets = await this.affectedDiagrams(index.sinceSync, { includeAllIfRebuilt: index.noBaseline });
    }
    for (const [name, def] of Object.entries(this.config.diagrams)) {
      const reason = targets.get(name);
      const file = path.relative(this.root, this.diagramFile(name, def));
      if (!reason) {
        outcomes.push({ name, type: def.type, file, status: 'skipped', reason: 'not affected' });
        continue;
      }
      try {
        const generated = await this.generateDiagram(name, def, model);
        if (generated.changed || options.force) {
          await this.writeDiagram(generated);
          outcomes.push({ name, type: def.type, file, status: generated.existed ? 'updated' : 'created', reason, notes: generated.notes });
        } else {
          // Record state even when output is identical so future change detection stays precise.
          await this.saveDiagramState(name, generated.state);
          // The mirror is derived and unversioned in state: restore it if it went missing.
          if (generated.mirror && !(await exists(generated.mirror.file))) await writeText(generated.mirror.file, generated.mirror.text);
          outcomes.push({ name, type: def.type, file, status: 'unchanged', reason, notes: generated.notes });
        }
      } catch (err) {
        outcomes.push({ name, type: def.type, file, status: 'error', reason: (err as Error).message });
      }
    }
    const modelDiff = previousModel ? diffModels(previousModel, model) : null;
    await this.markSynced();
    return { index, diagrams: outcomes, questions: model.questions.length, modelDiff };
  }

  /** Report stale diagrams without modifying project files. Suitable for CI. */
  async check(): Promise<CheckResult> {
    const index = await this.refreshIndex();
    const model = await this.getModel();
    const outcomes: DiagramOutcome[] = [];
    for (const [name, def] of Object.entries(this.config.diagrams)) {
      const file = path.relative(this.root, this.diagramFile(name, def));
      try {
        const generated = await this.generateDiagram(name, def, model);
        if (!generated.existed) outcomes.push({ name, type: def.type, file, status: 'missing', reason: 'diagram file does not exist' });
        else if (generated.changed) outcomes.push({ name, type: def.type, file, status: 'stale', reason: 'generated content differs from the source code' });
        else outcomes.push({ name, type: def.type, file, status: 'fresh' });
      } catch (err) {
        outcomes.push({ name, type: def.type, file, status: 'error', reason: (err as Error).message });
      }
    }
    return { index, diagrams: outcomes, stale: outcomes.some((o) => o.status === 'stale' || o.status === 'missing'), questions: model.questions.length };
  }

  /** Semantic diff between the last synchronised model and the current code. */
  async diff(): Promise<{ diff: ModelDiff; affected: Map<string, string>; index: IndexRefreshResult; hasBaseline: boolean }> {
    const index = await this.refreshIndex();
    const previous = await this.indexStore.loadModel();
    const model = await this.getModel();
    const baseline: SystemModel = previous ?? { ...model, components: [], operations: [], interactions: [], dependencies: [], entities: [], relations: [], dataAccess: [], actors: [], useCases: [], flows: [], questions: [] };
    const diff = diffModels(baseline, model);
    const affected = await this.affectedDiagrams(index.sinceSync, { includeAllIfRebuilt: index.noBaseline });
    return { diff, affected, index, hasBaseline: previous !== null };
  }

  /* ---------------------------------------------------------------- generate */

  /** Define (or redefine) a diagram, inferring scope from a query when given. */
  async defineDiagram(name: string, definition: DiagramDefinition, about?: string): Promise<{ definition: DiagramDefinition; inference?: ScopeInferenceResult }> {
    if (!this.generators.has(definition.type)) throw new UmlflowError(`Unknown diagram type "${definition.type}"`, { hint: `Available: ${this.generators.types().join(', ')}` });
    const model = await this.getModel();
    let inference: ScopeInferenceResult | undefined;
    const def: DiagramDefinition = { ...definition };
    if (about) {
      inference = inferScope(about, def.type, model);
      def.inferredScope = inference.scope;
    }
    await this.configStore.setDiagram(name, def);
    this.config = this.configStore.get();
    return { definition: this.config.diagrams[name]!, inference };
  }

  async removeDiagram(name: string): Promise<boolean> {
    const def = this.config.diagrams[name];
    if (!def) return false;
    await removeFile(this.diagramFile(name, def));
    const mirror = this.mermaidMirrorFile(name, def);
    if (mirror) await removeFile(mirror);
    await this.configStore.removeDiagram(name);
    this.config = this.configStore.get();
    const states = await this.indexStore.loadDiagramState();
    delete states[name];
    await this.indexStore.saveDiagramState(states);
    return true;
  }

  /** Rebuild the parse cache. Diagram state and the sync baseline are kept so the next `update` stays targeted. */
  async rebuildIndex(): Promise<IndexRefreshResult> {
    const baseline = await this.indexStore.loadSyncBaseline();
    const states = await this.indexStore.loadDiagramState();
    await this.indexStore.clear();
    const result = await this.refreshIndex({ force: true });
    if (baseline) await this.indexStore.saveSyncBaseline(baseline);
    await this.indexStore.saveDiagramState(states);
    await this.indexStore.saveModel(await this.getModel());
    return { ...result, sinceSync: diffHashSnapshots(baseline ?? {}, this.currentHashes()), noBaseline: baseline === null };
  }
}

/** Could an unresolved relative import specifier refer to one of the given (added/removed) files? */
function couldResolveTo(source: string, importer: string, files: string[]): boolean {
  if (!source.startsWith('.')) return false;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), source));
  return files.some((f) => f === base || f.startsWith(base + '.') || f.startsWith(base + '/index.'));
}

export { isEmptyChangeSet };
