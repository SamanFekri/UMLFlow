/**
 * Provenance and confidence primitives.
 *
 * Every fact in the UMLFlow System Model carries a provenance record so that
 * consumers (diagram generators, the CLI, the Claude skill) can distinguish
 * between facts directly supported by code, semantic inferences, user
 * declarations, and unknowns. Nothing uncertain is ever presented as fact.
 */

/** Where a fact came from. */
export type FactSource = 'code' | 'semantic-inference' | 'user';

/** How much the fact can be trusted. */
export type Confidence = 'deterministic' | 'inferred' | 'declared' | 'unknown';

/** A pointer back to source code. Lines are 1-based. */
export interface SourceRef {
  file: string;
  line?: number;
  endLine?: number;
  symbol?: string;
}

export interface Provenance {
  source: FactSource;
  confidence: Confidence;
  refs: SourceRef[];
  /** Optional short explanation, e.g. "@Controller decorator" or "name suffix". */
  reason?: string;
}

/** Precedence order used when several sources disagree. Higher wins. */
export const PRECEDENCE: Record<Confidence, number> = {
  declared: 4,
  deterministic: 3,
  inferred: 2,
  unknown: 1,
};

export function codeFact(refs: SourceRef[], reason?: string): Provenance {
  return { source: 'code', confidence: 'deterministic', refs, reason };
}

export function inferredFact(refs: SourceRef[], reason?: string): Provenance {
  return { source: 'semantic-inference', confidence: 'inferred', refs, reason };
}

export function declaredFact(reason?: string): Provenance {
  return { source: 'user', confidence: 'declared', refs: [], reason };
}

export function unknownFact(refs: SourceRef[] = [], reason?: string): Provenance {
  return { source: 'code', confidence: 'unknown', refs, reason };
}

/**
 * Pick the provenance that wins according to the precedence rules.
 * Ties keep the first argument (existing fact) so results are stable.
 */
export function strongerOf(a: Provenance, b: Provenance): Provenance {
  return PRECEDENCE[b.confidence] > PRECEDENCE[a.confidence] ? b : a;
}

export function isUncertain(p: Provenance): boolean {
  return p.confidence === 'inferred' || p.confidence === 'unknown';
}

export function sourceRefKey(ref: SourceRef): string {
  return `${ref.file}:${ref.line ?? 0}${ref.symbol ? '#' + ref.symbol : ''}`;
}
