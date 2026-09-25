import type { DiagramDefinition } from '../config/schema.js';
import { ModelIndex, type SystemModel, type UseCase } from '../model/types.js';
import { uncoveredUseCases } from './scenarios.js';
import { UNKNOWN_ACTOR_ID } from '../diagrams/ir.js';

/**
 * Analysis coverage and diagram validation.
 *
 * UMLFlow's honesty rule is that unknowns are reported, never silently
 * dropped. These functions turn "what did we actually understand?" into data:
 * which files produced structure, which produced nothing, which use cases have
 * a diagram, and which diagram content is not backed by evidence in the model.
 */

export interface FileCoverage {
  file: string;
  /** Components + entities extracted from this file. */
  symbols: number;
  status: 'analysed' | 'no-structure' | 'unparsed';
  reason?: string;
}

export interface CoverageReport {
  files: { total: number; analysed: number; noStructure: number; unparsed: number };
  /** Files that yielded no component and no entity, with the reason when known. */
  notUnderstood: FileCoverage[];
  entryPoints: { total: number; byKind: Record<string, number> };
  useCases: { total: number; withScenario: number; withoutScenario: { id: string; name: string; entryOperation: string }[] };
  components: { total: number; unknownRole: string[]; notInAnyDiagram: string[] };
  /** Calls whose target operation could not be resolved: their downstream path is invisible. */
  unresolvedCalls: { from: string; to: string; label: string; ref: string }[];
  openQuestions: number;
  /** 0..1 — share of indexed files that produced structure. */
  score: number;
}

export function buildCoverage(model: SystemModel, diagrams: Record<string, DiagramDefinition>, diagramModelIds: Set<string>): CoverageReport {
  const index = new ModelIndex(model);
  const symbolsByFile = new Map<string, number>();
  for (const c of model.components) if (c.file) symbolsByFile.set(c.file, (symbolsByFile.get(c.file) ?? 0) + 1);
  for (const e of model.entities) symbolsByFile.set(e.ref.file, (symbolsByFile.get(e.ref.file) ?? 0) + 1);

  const unparsed = new Map(model.unparsed.map((u) => [u.file, u]));
  const notUnderstood: FileCoverage[] = [];
  let analysed = 0;
  for (const file of model.files) {
    const symbols = symbolsByFile.get(file) ?? 0;
    const bad = unparsed.get(file);
    if (bad) {
      notUnderstood.push({ file, symbols, status: 'unparsed', ...(bad.message ? { reason: bad.message } : { reason: bad.status }) });
    } else if (symbols === 0) {
      notUnderstood.push({ file, symbols, status: 'no-structure', reason: 'parsed, but no component or entity was extracted' });
    } else {
      analysed++;
    }
  }

  const byKind: Record<string, number> = {};
  for (const op of model.operations) {
    if (!op.entryPoint) continue;
    byKind[op.entryPoint.kind] = (byKind[op.entryPoint.kind] ?? 0) + 1;
  }
  const uncovered = uncoveredUseCases(model, diagrams);

  const unresolvedCalls = model.interactions
    .filter((i) => !i.toOperation && index.components.get(i.toComponent)?.file !== '')
    .map((i) => ({ from: i.fromComponent, to: i.toComponent, label: i.label, ref: `${i.ref.file}:${i.ref.line ?? 0}` }));

  const participantRoles = new Set(['controller', 'service', 'repository', 'gateway', 'handler', 'module']);
  const notInAnyDiagram = model.components
    .filter((c) => participantRoles.has(c.role) && c.file !== '' && !diagramModelIds.has(c.id))
    .map((c) => c.id)
    .sort();

  const totalFiles = model.files.length;
  return {
    files: {
      total: totalFiles,
      analysed,
      noStructure: notUnderstood.filter((f) => f.status === 'no-structure').length,
      unparsed: notUnderstood.filter((f) => f.status === 'unparsed').length,
    },
    notUnderstood: notUnderstood.sort((a, b) => a.file.localeCompare(b.file)),
    entryPoints: { total: model.operations.filter((o) => o.entryPoint).length, byKind },
    useCases: {
      total: model.useCases.length,
      withScenario: model.useCases.length - uncovered.length,
      withoutScenario: uncovered.map((uc: UseCase) => ({ id: uc.id, name: uc.name, entryOperation: uc.operationIds[0] ?? '' })),
    },
    components: {
      total: model.components.length,
      unknownRole: model.components.filter((c) => c.role === 'unknown' && c.file !== '').map((c) => c.id).sort(),
      notInAnyDiagram,
    },
    unresolvedCalls,
    openQuestions: model.questions.length,
    score: totalFiles === 0 ? 1 : analysed / totalFiles,
  };
}

/* -------------------------------------------------------------- validation */

export type ValidationLevel = 'error' | 'warning';

export interface ValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  /** Diagram the issue was found in, when it is diagram-specific. */
  diagram?: string;
}

/** A rendered diagram plus the model ids the generator said it drew from. */
export interface DiagramEvidence {
  name: string;
  type: string;
  rendered: string;
  modelIds: string[];
}

/**
 * Validate generated diagrams against the model.
 *
 * Checks names are clean (no "?" suffix — a name with a marker is not a name),
 * that every use case has its own sequence diagram, that drawn participants
 * exist in the model, and that entities are not duplicated.
 */
export function validateDiagrams(model: SystemModel, diagrams: DiagramEvidence[], coverage: CoverageReport, definitions: Record<string, DiagramDefinition> = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const index = new ModelIndex(model);
  const useCaseIds = new Set(model.useCases.map((u) => u.id));

  for (const d of diagrams) {
    // A participant/entity/use-case label must never carry an uncertainty marker.
    for (const line of d.rendered.split('\n')) {
      const m = line.match(/(?:as |\["|\(\[")([^"\]\n]*?)\s\?{1,2}\s*(?:"|$)/);
      if (m) issues.push({ level: 'error', code: 'name-uncertainty-marker', diagram: d.name, message: `Name ends with an uncertainty marker: "${m[1]} ?" — names must be clean (set output.uncertaintyMarkers: false).` });
    }
    // Every drawn model id must exist in the model: no speculative participants.
    for (const id of d.modelIds) {
      if (id === UNKNOWN_ACTOR_ID) continue; // sentinel for "actor not yet declared", reported separately
      if (index.components.has(id) || index.entities.has(id) || index.operations.has(id) || index.actors.has(id) || index.flows.has(id)) continue;
      if (useCaseIds.has(id)) continue;
      // Actors are referenced by name in diagrams, not by id.
      if (model.actors.some((a) => a.name === id)) continue;
      issues.push({ level: 'warning', code: 'unbacked-id', diagram: d.name, message: `Drawn id "${id}" is not present in the System Model.` });
    }
  }

  // A sequence diagram pinned to several entry points merges unrelated use cases.
  // An unpinned diagram is a deliberate whole-system overview and is not flagged.
  for (const [name, def] of Object.entries(definitions)) {
    if (def.type !== 'sequence') continue;
    const pinned = [...(def.scope?.entryPoints ?? []), ...(def.inferredScope?.entryPoints ?? [])];
    if (pinned.length > 1) {
      issues.push({
        level: 'warning',
        code: 'multi-scenario-diagram',
        diagram: name,
        message: `Covers ${pinned.length} use cases in one diagram (${pinned.join(', ')}). Run \`umlflow scenarios\` to give each its own.`,
      });
    }
  }

  for (const uc of coverage.useCases.withoutScenario) {
    issues.push({ level: 'warning', code: 'usecase-without-scenario', message: `Use case "${uc.name}" (${uc.entryOperation}) has no sequence diagram. Run \`umlflow scenarios\`.` });
  }

  const byName = new Map<string, string[]>();
  for (const e of model.entities) {
    const key = e.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), e.id]);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) issues.push({ level: 'warning', code: 'duplicate-entity', message: `Entity "${name}" appears ${ids.length} times (${ids.join(', ')}) — they may need merging.` });
  }

  if (coverage.unresolvedCalls.length > 0) {
    issues.push({ level: 'warning', code: 'unresolved-calls', message: `${coverage.unresolvedCalls.length} call(s) target an unresolved operation; their downstream path is not drawn.` });
  }
  return issues;
}
