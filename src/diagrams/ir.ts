/**
 * Diagram Intermediate Representation.
 *
 * Generators produce these renderer-agnostic structures from the System
 * Model; renderers (Mermaid today, others later) turn them into text.
 */

import type { Confidence } from '../core/provenance.js';

export interface DiagramNote {
  level: 'info' | 'inferred' | 'unknown';
  text: string;
}

export interface DiagramBase {
  name: string;
  type: string;
  title: string;
  description?: string;
  notes: DiagramNote[];
  /** Renderer-specific raw lines supplied by the user (appended verbatim). */
  rawLines: string[];
  /** Renderer-specific style lines supplied by the user. */
  styleLines: string[];
}

/* ---------------------------------------------------------------- use case */

export interface UseCaseActor {
  id: string;
  label: string;
  confidence: Confidence;
}

export interface UseCaseNode {
  id: string;
  label: string;
  confidence: Confidence;
  /** Component that provides the capability (for grouping). */
  provider?: string;
}

export interface UseCaseAssociation {
  actor: string;
  useCase: string;
  confidence: Confidence;
}

export interface UseCaseRelation {
  from: string;
  to: string;
  kind: 'include' | 'extend' | 'generalize';
  label?: string;
}

export interface UseCaseDiagram extends DiagramBase {
  type: 'usecase';
  systemName: string;
  actors: UseCaseActor[];
  useCases: UseCaseNode[];
  associations: UseCaseAssociation[];
  relations: UseCaseRelation[];
  /** Group name → use case ids (rendered as nested boundaries). */
  groups: Record<string, string[]>;
}

/* ---------------------------------------------------------------- sequence */

export interface SequenceParticipant {
  id: string;
  label: string;
  kind: 'actor' | 'participant' | 'database' | 'external';
  group?: string;
}

export interface SequenceMessage {
  kind: 'message';
  from: string;
  to: string;
  label: string;
  async?: boolean;
  /** Reply / return message (dashed). */
  reply?: boolean;
  confidence: Confidence;
}

export interface SequenceNote {
  kind: 'note';
  over: string[];
  text: string;
}

export interface SequenceFragment {
  kind: 'fragment';
  op: 'alt' | 'opt' | 'loop' | 'par' | 'critical' | 'group';
  label: string;
  body: SequenceElement[];
  /** For alt: additional branches. */
  branches?: { label: string; body: SequenceElement[] }[];
}

export type SequenceElement = SequenceMessage | SequenceNote | SequenceFragment;

export interface SequenceDiagram extends DiagramBase {
  type: 'sequence';
  participants: SequenceParticipant[];
  elements: SequenceElement[];
}

/* --------------------------------------------------------------------- erd */

export interface ErdAttribute {
  name: string;
  type?: string;
  keys: ('PK' | 'FK' | 'UK')[];
  comment?: string;
}

export interface ErdEntity {
  id: string;
  label: string;
  attributes: ErdAttribute[];
  confidence: Confidence;
}

export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many' | 'unknown';

export interface ErdRelation {
  from: string;
  to: string;
  cardinality: Cardinality;
  label: string;
  confidence: Confidence;
}

export interface ErDiagram extends DiagramBase {
  type: 'erd';
  entities: ErdEntity[];
  relations: ErdRelation[];
}

export type Diagram = UseCaseDiagram | SequenceDiagram | ErDiagram | (DiagramBase & { type: string; [key: string]: unknown });

export const UNKNOWN_ACTOR_ID = '__unknown_actor__';
export const UNKNOWN_ACTOR_LABEL = 'Unknown actor';
