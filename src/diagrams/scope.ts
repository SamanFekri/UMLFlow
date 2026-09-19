import { matchesAny } from '../core/fs.js';
import type { DiagramDefinition, InferredScope } from '../config/schema.js';
import type { SemanticsData } from '../model/semantics.js';
import { ModelIndex, type Component, type Entity, type Operation, type SystemModel } from '../model/types.js';

/**
 * Resolved scope for one diagram. User `scope` always wins over UMLFlow's
 * `inferredScope`; each is only consulted for fields the user left empty.
 */
export interface ResolvedScope {
  includePaths: string[];
  excludePaths: string[];
  /** Explicit component ids/names, or null for "any". */
  components: Set<string> | null;
  entities: Set<string> | null;
  /** Entry operation ids, or null for "all entry points in scope". */
  entryPoints: Set<string> | null;
  depth: number;
  /** Ids hidden by overrides.exclude or semantics ignore flags. */
  excludedIds: Set<string>;
  /** Where the effective values came from (for reporting). */
  origin: 'user' | 'inferred' | 'mixed' | 'none';
}

export function resolveScope(definition: DiagramDefinition, model: SystemModel, semantics: SemanticsData, defaultDepth: number): ResolvedScope {
  const user = definition.scope ?? {};
  const inferred = definition.inferredScope ?? {};
  const index = new ModelIndex(model);
  let usedUser = false;
  let usedInferred = false;
  const pick = <T>(u: T[] | undefined, i: T[] | undefined): T[] => {
    if (u && u.length > 0) {
      usedUser = true;
      return u;
    }
    if (i && i.length > 0) {
      usedInferred = true;
      return i;
    }
    return [];
  };
  // Inferred `files` are informational (they record what the inference touched); only user paths filter.
  // Inferred entry points / entities pin the diagram to what was asked for while flows may reach new code.
  const includePaths = user.include && user.include.length ? (usedUser = true, user.include) : [];
  const excludePaths = user.exclude ?? [];
  if (excludePaths.length) usedUser = true;
  const componentNames = user.components && user.components.length ? (usedUser = true, user.components) : [];
  if (!componentNames.length && inferred.components?.length && !inferred.entryPoints?.length) {
    usedInferred = true;
    componentNames.push(...inferred.components);
  }
  const entityNames = pick(user.entities, inferred.entities);
  const entryNames = pick(user.entryPoints, inferred.entryPoints);

  const components = componentNames.length ? new Set(componentNames.map((n) => index.componentByName(n)?.id ?? n)) : null;
  const entities = entityNames.length ? new Set(entityNames.map((n) => index.entityByName(n)?.id ?? n)) : null;
  const entryPoints = entryNames.length ? new Set(entryNames.map((n) => resolveEntryPoint(n, model)?.id ?? n)) : null;

  const excludedIds = new Set<string>(definition.overrides?.exclude ?? []);
  for (const [id, sem] of Object.entries(semantics.components)) if (sem.ignore) excludedIds.add(index.componentByName(id)?.id ?? id);
  for (const [id, sem] of Object.entries(semantics.entities)) if (sem.ignore) excludedIds.add(index.entityByName(id)?.id ?? id);

  return {
    includePaths,
    excludePaths,
    components,
    entities,
    entryPoints,
    depth: user.depth ?? defaultDepth,
    excludedIds,
    origin: usedUser && usedInferred ? 'mixed' : usedUser ? 'user' : usedInferred ? 'inferred' : 'none',
  };
}

/** Find an entry operation by id ("AuthController.login"), by "METHOD /path" or by path alone. */
export function resolveEntryPoint(spec: string, model: SystemModel): Operation | undefined {
  const direct = model.operations.find((o) => o.id === spec && o.entryPoint);
  if (direct) return direct;
  const m = spec.match(/^([A-Z]+)\s+(\S+)$/);
  const method = m ? m[1] : undefined;
  const p = m ? m[2] : spec.startsWith('/') ? spec : undefined;
  if (p) {
    return model.operations.find((o) => o.entryPoint?.path === p && (!method || method === 'ANY' || o.entryPoint.method === method || o.entryPoint.method === 'ANY'));
  }
  return model.operations.find((o) => o.entryPoint && (o.name === spec || o.id.endsWith('.' + spec)));
}

export function fileInScope(file: string, scope: ResolvedScope): boolean {
  if (!file) return scope.includePaths.length === 0; // external components have no file
  if (scope.includePaths.length > 0 && !matchesAny(file, scope.includePaths)) return false;
  if (scope.excludePaths.length > 0 && matchesAny(file, scope.excludePaths)) return false;
  return true;
}

export function componentInScope(c: Component, scope: ResolvedScope): boolean {
  if (scope.excludedIds.has(c.id) || scope.excludedIds.has(c.name)) return false;
  if (scope.components) return scope.components.has(c.id) || scope.components.has(c.name);
  if (c.file === '') return true; // external systems are reachable from any scope
  return fileInScope(c.file, scope);
}

export function entityInScope(e: Entity, scope: ResolvedScope): boolean {
  if (scope.excludedIds.has(e.id) || scope.excludedIds.has(e.name)) return false;
  if (scope.entities) return scope.entities.has(e.id) || scope.entities.has(e.name);
  if (scope.includePaths.length === 0 && scope.excludePaths.length === 0) return true;
  return e.provenance.refs.some((r) => fileInScope(r.file, scope));
}

/* ------------------------------------------------------------------ inference */

export interface ScopeInferenceResult {
  scope: InferredScope;
  matchedEntryPoints: Operation[];
  matchedComponents: Component[];
  matchedEntities: Entity[];
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'or', 'to', 'flow', 'diagram', 'sequence', 'usecase', 'use', 'case', 'erd', 'database', 'system', 'process', 'feature', 'module', 'create', 'show', 'me', 'all']);

export function keywordsFor(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .map((w) => (w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

function matches(text: string | undefined, keywords: string[]): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  return keywords.reduce((n, k) => (t.includes(k) ? n + 1 : n), 0);
}

/**
 * Infer a diagram scope from a natural-language query such as "login" or
 * "checkout flow". Deterministic keyword matching over the System Model:
 * entry points and components whose names/paths/files match seed the scope;
 * flows reachable from matched entry points extend it.
 */
export function inferScope(query: string, type: string, model: SystemModel): ScopeInferenceResult {
  const keywords = keywordsFor(query);
  const index = new ModelIndex(model);
  const files = new Set<string>();
  const components = new Set<string>();
  const entryPoints = new Set<string>();
  const entities = new Set<string>();
  const matchedEntryPoints: Operation[] = [];
  const matchedComponents: Component[] = [];
  const matchedEntities: Entity[] = [];
  if (keywords.length === 0) {
    return { scope: { query }, matchedEntryPoints, matchedComponents, matchedEntities };
  }
  for (const c of model.components) {
    if (c.role === 'model' || c.role === 'utility') continue;
    if (matches(c.name, keywords) || matches(c.file, keywords)) matchedComponents.push(c);
  }
  for (const op of model.operations) {
    if (!op.entryPoint) continue;
    const score = matches(op.name, keywords) + matches(op.entryPoint.path, keywords) + matches(op.componentId, keywords) + matches(index.components.get(op.componentId)?.file, keywords);
    if (score > 0) matchedEntryPoints.push(op);
  }
  for (const e of model.entities) {
    if (matches(e.name, keywords) || matches(e.table, keywords)) matchedEntities.push(e);
  }
  if (type === 'erd') {
    for (const e of matchedEntities) {
      entities.add(e.id);
      // include directly related entities
      for (const r of model.relations) {
        if (r.from === e.id) entities.add(r.to);
        if (r.to === e.id) entities.add(r.from);
      }
    }
    return { scope: { query, entities: [...entities].sort(), inferredAt: new Date().toISOString() }, matchedEntryPoints, matchedComponents, matchedEntities };
  }
  for (const op of matchedEntryPoints) entryPoints.add(op.id);
  for (const c of matchedComponents) {
    components.add(c.id);
    for (const opId of c.operations) {
      const op = index.operations.get(opId);
      if (op?.entryPoint) entryPoints.add(op.id);
    }
  }
  for (const flow of model.flows) {
    if (!entryPoints.has(flow.entryOperation)) continue;
    for (const cid of flow.components) {
      const c = index.components.get(cid);
      if (!c) continue;
      components.add(cid);
      if (c.file) files.add(c.file);
    }
    for (const eid of flow.entities) entities.add(eid);
  }
  for (const c of matchedComponents) if (c.file) files.add(c.file);
  return {
    scope: {
      query,
      files: [...files].sort(),
      components: [...components].sort(),
      entryPoints: [...entryPoints].sort(),
      entities: [...entities].sort(),
      inferredAt: new Date().toISOString(),
    },
    matchedEntryPoints,
    matchedComponents,
    matchedEntities,
  };
}
