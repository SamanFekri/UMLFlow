import { parseDocument, Document } from 'yaml';
import { readTextOrNull, writeText } from '../core/fs.js';
import { UmlflowError } from '../core/errors.js';
import type { FactSource, Provenance } from '../core/provenance.js';
import { fingerprint } from '../core/hash.js';
import type { ComponentRole } from './types.js';

/**
 * Persistent semantic facts (`.umlflow/semantics.yaml`).
 *
 * Two sources are stored: `user` (declared by a person; never overwritten by
 * inference) and `semantic-inference` (established once, typically by Claude
 * through the question protocol, and reused so it is never re-discovered).
 */

export type SemanticSource = Extract<FactSource, 'user' | 'semantic-inference'>;

export interface ComponentSemantics {
  role?: ComponentRole;
  label?: string;
  /** Default actor for every entry point of this component. */
  actor?: string;
  /** Exclude from all diagrams (e.g. logging helper). */
  ignore?: boolean;
  source: SemanticSource;
  note?: string;
}

export interface ActorSemantics {
  description?: string;
  source: SemanticSource;
}

export interface OperationSemantics {
  /** Use case name for this operation. */
  useCase?: string;
  /** Actor name initiating this operation. */
  actor?: string;
  /** Flow (sequence) name starting at this operation. */
  flow?: string;
  /** Exclude from use case / sequence diagrams (internal, not a capability). */
  ignore?: boolean;
  source: SemanticSource;
  note?: string;
}

export interface EntitySemantics {
  label?: string;
  ignore?: boolean;
  source: SemanticSource;
}

export interface SemanticsData {
  version: number;
  components: Record<string, ComponentSemantics>;
  actors: Record<string, ActorSemantics>;
  operations: Record<string, OperationSemantics>;
  entities: Record<string, EntitySemantics>;
}

const SOURCES: SemanticSource[] = ['user', 'semantic-inference'];

export function emptySemantics(): SemanticsData {
  return { version: 1, components: {}, actors: {}, operations: {}, entities: {} };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeSection<T extends { source: SemanticSource }>(raw: unknown, section: string): Record<string, T> {
  const out: Record<string, T> = {};
  if (raw === undefined || raw === null) return out;
  if (!isRecord(raw)) throw new UmlflowError(`semantics.yaml: "${section}" must be a mapping`);
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) throw new UmlflowError(`semantics.yaml: ${section}.${key} must be a mapping`);
    const source = value.source ?? 'user';
    if (!SOURCES.includes(source as SemanticSource)) {
      throw new UmlflowError(`semantics.yaml: ${section}.${key}.source must be "user" or "semantic-inference"`);
    }
    out[key] = { ...(value as object), source } as T;
  }
  return out;
}

export function normalizeSemantics(raw: unknown): SemanticsData {
  if (raw === null || raw === undefined) return emptySemantics();
  if (!isRecord(raw)) throw new UmlflowError('semantics.yaml: top level must be a mapping');
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    components: normalizeSection<ComponentSemantics>(raw.components, 'components'),
    actors: normalizeSection<ActorSemantics>(raw.actors, 'actors'),
    operations: normalizeSection<OperationSemantics>(raw.operations, 'operations'),
    entities: normalizeSection<EntitySemantics>(raw.entities, 'entities'),
  };
}

export function provenanceFor(source: SemanticSource, reason?: string): Provenance {
  return source === 'user'
    ? { source: 'user', confidence: 'declared', refs: [], reason }
    : { source: 'semantic-inference', confidence: 'inferred', refs: [], reason };
}

export class SemanticsStore {
  private doc: Document | null = null;
  private data: SemanticsData = emptySemantics();

  constructor(readonly file: string) {}

  async load(): Promise<SemanticsData> {
    const text = await readTextOrNull(this.file);
    if (text === null) {
      this.doc = new Document(emptySemantics());
      this.data = emptySemantics();
      return this.data;
    }
    const doc = parseDocument(text);
    if (doc.errors.length > 0) throw new UmlflowError(`semantics.yaml: ${doc.errors[0]!.message}`);
    this.doc = doc;
    this.data = normalizeSemantics(doc.toJS());
    return this.data;
  }

  get(): SemanticsData {
    return this.data;
  }

  hash(): string {
    return fingerprint(this.data);
  }

  /**
   * Fingerprint of only the facts that can influence a diagram built from the
   * given model ids, so unrelated semantic changes never mark it stale.
   * Actors are always included: a new actor can resolve an unknown actor.
   */
  hashFor(modelIds: Iterable<string>): string {
    const ids = new Set(modelIds);
    const relevant = (section: Record<string, unknown>) => Object.fromEntries(Object.entries(section).filter(([k]) => ids.has(k) || [...ids].some((id) => id.startsWith(k + '.'))));
    return fingerprint({
      actors: this.data.actors,
      components: relevant(this.data.components),
      operations: relevant(this.data.operations),
      entities: relevant(this.data.entities),
    });
  }

  /**
   * Record a semantic fact. Returns false when an existing fact with higher or
   * equal precedence blocks the write (user facts are never overwritten by inference).
   */
  async set(
    section: keyof Omit<SemanticsData, 'version'>,
    key: string,
    values: Record<string, unknown>,
    source: SemanticSource,
  ): Promise<boolean> {
    const existing = (this.data[section] as Record<string, { source: SemanticSource }>)[key];
    if (existing && existing.source === 'user' && source !== 'user') return false;
    const merged = { ...(existing ?? {}), ...values, source };
    (this.data[section] as Record<string, unknown>)[key] = merged;
    await this.flush();
    return true;
  }

  async remove(section: keyof Omit<SemanticsData, 'version'>, key: string): Promise<boolean> {
    const sectionData = this.data[section] as Record<string, unknown>;
    if (!(key in sectionData)) return false;
    delete sectionData[key];
    await this.flush();
    return true;
  }

  private async flush(): Promise<void> {
    const doc = this.doc ?? new Document(emptySemantics());
    for (const section of ['components', 'actors', 'operations', 'entities'] as const) {
      doc.set(section, doc.createNode(this.data[section]));
    }
    if (!doc.has('version')) doc.set('version', 1);
    if (!doc.commentBefore) {
      doc.commentBefore =
        ' UMLFlow semantic facts.\n Entries with source "user" are declared by people and never overwritten.\n Entries with source "semantic-inference" were established once and are reused.';
    }
    this.doc = doc;
    await writeText(this.file, doc.toString());
  }
}
