import { slugify } from '../core/text.js';
import type { DiagramDefinition } from '../config/schema.js';
import type { SystemModel, UseCase, Operation } from '../model/types.js';

/**
 * Scenario diagrams: one sequence diagram per use case.
 *
 * A "scenario" is a single use case — one entry point and the execution path
 * reachable from it. The model already reconstructs one Flow per entry point;
 * this turns each into its own diagram definition pinned to that entry point
 * via `scope.entryPoints`, so a scenario diagram can never drift into showing
 * an unrelated flow.
 */

export interface ScenarioPlan {
  /** Diagram name (config key and file stem). */
  name: string;
  /** The use case this scenario covers. */
  useCaseId: string;
  /** Entry operation id the diagram is pinned to. */
  entryOperation: string;
  title: string;
  definition: DiagramDefinition;
  /** True when a definition with this name already exists in the config. */
  exists: boolean;
}

/** Suffix appended to a use case slug to form the diagram name. */
export const SCENARIO_SUFFIX = '-sequence';

/**
 * Stable, collision-free diagram name for a use case. Derived from the use
 * case name when it is descriptive, else from the operation id, so a renamed
 * use case keeps a readable file name without colliding with a sibling.
 */
export function scenarioName(useCase: UseCase, op: Operation | undefined, taken: Set<string>): string {
  const base = slugify(useCase.name) || slugify(useCase.id) || 'scenario';
  let candidate = `${base}${SCENARIO_SUFFIX}`;
  if (taken.has(candidate) && op) {
    // Disambiguate with the component so "Get Order" on two controllers stays distinct.
    candidate = `${slugify(op.componentId)}-${base}${SCENARIO_SUFFIX}`;
  }
  let n = 2;
  const stem = candidate;
  while (taken.has(candidate)) candidate = `${stem}-${n++}`;
  return candidate;
}

export interface PlanOptions {
  /** Existing diagram definitions, so already-defined scenarios are recognised. */
  existing: Record<string, DiagramDefinition>;
  /** Only plan scenarios for these use case ids (default: all). */
  only?: Set<string>;
  /** Call depth for the generated definitions. */
  depth?: number;
}

/**
 * Plan one scenario diagram per use case. Pure: performs no writes, so it can
 * back both a dry run and the real thing.
 */
export function planScenarios(model: SystemModel, options: PlanOptions): ScenarioPlan[] {
  const opById = new Map(model.operations.map((o) => [o.id, o]));
  // A scenario already defined for an entry point is matched by scope, not by
  // name: the user may have renamed the diagram.
  const definedEntryPoints = new Map<string, string>();
  for (const [name, def] of Object.entries(options.existing)) {
    if (def.type !== 'sequence') continue;
    for (const ep of def.scope?.entryPoints ?? []) definedEntryPoints.set(ep, name);
    if ((def.scope?.entryPoints ?? []).length === 0) {
      for (const ep of def.inferredScope?.entryPoints ?? []) definedEntryPoints.set(ep, name);
    }
  }
  const taken = new Set(Object.keys(options.existing));
  const plans: ScenarioPlan[] = [];
  for (const uc of model.useCases) {
    if (options.only && !options.only.has(uc.id)) continue;
    const entryOperation = uc.operationIds[0];
    if (!entryOperation) continue;
    const op = opById.get(entryOperation);
    const already = definedEntryPoints.get(entryOperation);
    const name = already ?? scenarioName(uc, op, taken);
    taken.add(name);
    const definition: DiagramDefinition = {
      type: 'sequence',
      description: `Execution path for the "${uc.name}" scenario`,
      scope: { entryPoints: [entryOperation], ...(options.depth ? { depth: options.depth } : {}) },
    };
    plans.push({ name, useCaseId: uc.id, entryOperation, title: uc.name, definition, exists: already !== undefined });
  }
  return plans;
}

/** Use cases that have no sequence diagram covering their entry point. */
export function uncoveredUseCases(model: SystemModel, existing: Record<string, DiagramDefinition>): UseCase[] {
  const covered = new Set<string>();
  for (const def of Object.values(existing)) {
    if (def.type !== 'sequence') continue;
    const pinned = [...(def.scope?.entryPoints ?? []), ...(def.inferredScope?.entryPoints ?? [])];
    for (const ep of pinned) covered.add(ep);
  }
  return model.useCases.filter((uc) => !uc.operationIds.some((id) => covered.has(id)));
}
