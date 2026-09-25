/**
 * UMLFlow System Model — the compact, language-independent understanding of a
 * codebase. Diagrams are views of this model. Every fact carries provenance.
 */

import type { Provenance, SourceRef } from '../core/provenance.js';
import type { AttributeDecl, RelationKind, SymbolKind } from '../codemodel/types.js';

export type ComponentRole =
  | 'controller'
  | 'service'
  | 'repository'
  | 'gateway'
  | 'handler'
  | 'entity'
  | 'model'
  | 'module'
  | 'utility'
  | 'unknown';

export interface Component {
  /** Stable id, normally the symbol name; disambiguated with a file suffix on collisions. */
  id: string;
  name: string;
  kind: SymbolKind;
  role: ComponentRole;
  roleProvenance: Provenance;
  file: string;
  ref: SourceRef;
  /** Operation ids exposed by this component. */
  operations: string[];
  /** Component ids this component holds references to (constructor injection, fields, imports). */
  dependsOn: string[];
}

export type EntryPointKind = 'http' | 'cli' | 'event' | 'message' | 'public' | 'scheduled';

export interface EntryPoint {
  kind: EntryPointKind;
  method?: string;
  path?: string;
  provenance: Provenance;
}

export interface Operation {
  /** "<Component>.<name>" or "<function>" for free functions. */
  id: string;
  componentId: string;
  name: string;
  ref: SourceRef;
  entryPoint?: EntryPoint;
  visibility?: string;
}

export interface Interaction {
  id: string;
  /** Calling operation id. */
  from: string;
  fromComponent: string;
  toComponent: string;
  /** Called operation id if the callee was resolved to a known operation. */
  toOperation?: string;
  /** Human readable message label (method name). */
  label: string;
  order: number;
  ref: SourceRef;
  provenance: Provenance;
}

export type DependencyKind = 'injects' | 'imports' | 'calls' | 'extends' | 'implements' | 'uses';

export interface Dependency {
  from: string;
  to: string;
  kind: DependencyKind;
  provenance: Provenance;
}

export interface Entity {
  id: string;
  name: string;
  table?: string;
  attributes: AttributeDecl[];
  origin: string;
  ref: SourceRef;
  provenance: Provenance;
}

export interface EntityRelation {
  from: string;
  to: string;
  kind: RelationKind;
  label?: string;
  fromField?: string;
  provenance: Provenance;
}

export type AccessMode = 'read' | 'write' | 'read-write' | 'unknown';

export interface DataAccess {
  componentId: string;
  entityId: string;
  mode: AccessMode;
  provenance: Provenance;
  /** Operation ids in which the access was observed (empty for declaration-level access). */
  operations?: string[];
}

export interface Actor {
  id: string;
  name: string;
  description?: string;
  provenance: Provenance;
}

export interface UseCase {
  id: string;
  name: string;
  nameProvenance: Provenance;
  /** Actor ids; empty when unknown. */
  actorIds: string[];
  actorProvenance: Provenance;
  operationIds: string[];
  componentId: string;
}

export interface FlowStep {
  depth: number;
  fromComponent: string;
  toComponent: string;
  toOperation?: string;
  label: string;
  interactionId: string;
  ref: SourceRef;
  provenance: Provenance;
}

export interface Flow {
  id: string;
  name: string;
  nameProvenance: Provenance;
  entryOperation: string;
  entryComponent: string;
  actorId?: string;
  steps: FlowStep[];
  /** Components touched by this flow, in first-seen order. */
  components: string[];
  /** Entity ids accessed along the flow. */
  entities: string[];
}

export type QuestionKind = 'actor' | 'usecase-name' | 'component-role' | 'flow-name' | 'entity-relation';

/**
 * How much a question matters.
 * - `required`: the model has a hole (unknown actor, non-descriptive name,
 *   unclassified component). Diagrams are incomplete until it is answered.
 * - `optional`: a refinement an LLM can improve on (naming a multi-step
 *   scenario, confirming an inferred relation). Diagrams are already usable.
 */
export type QuestionPriority = 'required' | 'optional';

/** Something UMLFlow could not determine deterministically; answered by a person or by Claude. */
export interface SemanticQuestion {
  id: string;
  kind: QuestionKind;
  /** Defaults to 'required' when absent. */
  priority?: QuestionPriority;
  /** The model id the question is about (operation id, component id, …). */
  subject: string;
  question: string;
  refs: SourceRef[];
  /** Candidate answers when UMLFlow can suggest some. */
  options?: string[];
  /** Compact context lines to avoid re-reading source. */
  context?: string[];
}

export interface SystemModel {
  version: number;
  builtAt: string;
  files: string[];
  components: Component[];
  operations: Operation[];
  interactions: Interaction[];
  dependencies: Dependency[];
  entities: Entity[];
  relations: EntityRelation[];
  dataAccess: DataAccess[];
  actors: Actor[];
  useCases: UseCase[];
  flows: Flow[];
  questions: SemanticQuestion[];
  /** Files that could not be analysed (status != ok). */
  unparsed: { file: string; status: string; message?: string }[];
}

export const MODEL_VERSION = 1;

export function emptyModel(): SystemModel {
  return {
    version: MODEL_VERSION,
    builtAt: new Date(0).toISOString(),
    files: [],
    components: [],
    operations: [],
    interactions: [],
    dependencies: [],
    entities: [],
    relations: [],
    dataAccess: [],
    actors: [],
    useCases: [],
    flows: [],
    questions: [],
    unparsed: [],
  };
}

/** Indexed view over a SystemModel for O(1) lookups. */
export class ModelIndex {
  readonly components = new Map<string, Component>();
  readonly operations = new Map<string, Operation>();
  readonly entities = new Map<string, Entity>();
  readonly actors = new Map<string, Actor>();
  readonly flows = new Map<string, Flow>();
  readonly interactionsByFrom = new Map<string, Interaction[]>();
  readonly componentsByFile = new Map<string, Component[]>();
  readonly entitiesByFile = new Map<string, Entity[]>();

  constructor(readonly model: SystemModel) {
    for (const c of model.components) {
      this.components.set(c.id, c);
      push(this.componentsByFile, c.file, c);
    }
    for (const o of model.operations) this.operations.set(o.id, o);
    for (const e of model.entities) {
      this.entities.set(e.id, e);
      push(this.entitiesByFile, e.ref.file, e);
    }
    for (const a of model.actors) this.actors.set(a.id, a);
    for (const f of model.flows) this.flows.set(f.id, f);
    for (const i of model.interactions) push(this.interactionsByFrom, i.from, i);
  }

  componentByName(name: string): Component | undefined {
    const direct = this.components.get(name);
    if (direct) return direct;
    for (const c of this.components.values()) if (c.name === name) return c;
    return undefined;
  }

  entityByName(name: string): Entity | undefined {
    const direct = this.entities.get(name);
    if (direct) return direct;
    const lower = name.toLowerCase();
    for (const e of this.entities.values()) {
      if (e.name.toLowerCase() === lower || e.table?.toLowerCase() === lower) return e;
    }
    return undefined;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
