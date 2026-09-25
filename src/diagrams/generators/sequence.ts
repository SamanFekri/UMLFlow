import { humanize, slugify } from '../../core/text.js';
import { accessMode } from '../../model/build.js';
import type { Component, Flow, FlowStep } from '../../model/types.js';
import type { DiagramGenerator, GenerateContext, GenerateResult } from '../generator.js';
import { UNKNOWN_ACTOR_ID, UNKNOWN_ACTOR_LABEL, type DiagramNote, type SequenceDiagram, type SequenceElement, type SequenceParticipant } from '../ir.js';
import { OverrideHelper } from '../overrides.js';
import { componentInScope } from '../scope.js';

const PARTICIPANT_ROLES = new Set(['controller', 'service', 'repository', 'gateway', 'handler', 'module', 'unknown']);

/**
 * Sequence diagram: one section per flow in scope. Participants are
 * components (never individual functions); scope and depth bound the detail.
 */
export class SequenceGenerator implements DiagramGenerator {
  readonly type = 'sequence';
  readonly displayName = 'Sequence';

  generate(ctx: GenerateContext): GenerateResult {
    const { model, index, scope, definition, name } = ctx;
    const ov = new OverrideHelper(definition);
    const notes: DiagramNote[] = [];
    const files = new Set<string>();
    const modelIds = new Set<string>();
    const participants = new Map<string, SequenceParticipant>();
    const elements: SequenceElement[] = [];
    let inferredCount = 0;
    let unknownActors = 0;
    const uncertainNames: string[] = [];
    let asyncCount = 0;

    const flows = model.flows.filter((f) => {
      if (scope.entryPoints) return scope.entryPoints.has(f.entryOperation);
      const entry = index.components.get(f.entryComponent);
      return !!entry && componentInScope(entry, scope) && !ov.isExcluded(entry.id, entry.name) && !ov.isExcluded(f.entryOperation);
    });

    const participantFor = (c: Component): SequenceParticipant => {
      const id = ov.canonical(c.id);
      let p = participants.get(id);
      if (!p) {
        const kind: SequenceParticipant['kind'] = c.file === '' ? 'external' : 'participant';
        p = { id: slugify(id) || id, label: ov.label(c.id, c.name), kind, group: ov.groupOf(c.id) };
        participants.set(id, p);
      }
      return p;
    };
    const dbParticipant = (entityId: string): SequenceParticipant => {
      const id = `db:${ov.canonical(entityId)}`;
      let p = participants.get(id);
      if (!p) {
        const entity = index.entities.get(entityId);
        p = { id: slugify(id), label: ov.label(entityId, entity?.name ?? entityId), kind: 'database', group: ov.groupOf(entityId) };
        participants.set(id, p);
      }
      return p;
    };
    const visible = (c: Component | undefined): c is Component =>
      !!c && PARTICIPANT_ROLES.has(c.role) && componentInScope(c, scope) && !ov.isExcluded(c.id, c.name);

    const accessesFor = (operationId: string, componentId: string) =>
      model.dataAccess.filter((a) => a.componentId === componentId && a.operations?.includes(operationId));
    const accessLabel = (operationId: string, entityId: string, fallback: string): string => {
      const op = index.operations.get(operationId);
      const mode = op ? accessMode(op.name) : 'unknown';
      return `${mode === 'unknown' ? fallback : mode} ${index.entities.get(entityId)?.name ?? entityId}`;
    };

    for (const flow of flows) {
      const entry = index.components.get(flow.entryComponent);
      const entryOp = index.operations.get(flow.entryOperation);
      if (!entry || !entryOp) continue;
      modelIds.add(flow.id);
      modelIds.add(entry.id);
      files.add(entry.file);
      const body: SequenceElement[] = [];
      // Actor
      const useCase = model.useCases.find((u) => u.operationIds.includes(flow.entryOperation));
      const overrideActor = ov.actorFor(entryOp.id, useCase?.id ?? '', entry.id);
      const actorName = overrideActor ?? flow.actorId;
      let actorParticipant: SequenceParticipant;
      if (actorName) {
        const id = `actor:${actorName}`;
        actorParticipant = participants.get(id) ?? { id: slugify(id), label: ov.label(actorName, actorName), kind: 'actor' };
        participants.set(id, actorParticipant);
        modelIds.add(actorName);
      } else {
        unknownActors++;
        actorParticipant = participants.get(UNKNOWN_ACTOR_ID) ?? { id: UNKNOWN_ACTOR_ID, label: UNKNOWN_ACTOR_LABEL, kind: 'actor' };
        participants.set(UNKNOWN_ACTOR_ID, actorParticipant);
      }
      const entryParticipant = participantFor(entry);
      const ep = entryOp.entryPoint!;
      const entryLabel = ep.kind === 'http' ? `${ep.method ?? ''} ${ep.path ?? ''}`.trim() : ep.kind === 'public' ? entryOp.name : `${ep.kind}: ${ep.path ?? entryOp.name}`;
      body.push({ kind: 'message', from: actorParticipant.id, to: entryParticipant.id, label: entryLabel, confidence: 'deterministic' });
      for (const a of accessesFor(entryOp.id, entry.id)) {
        body.push({ kind: 'message', from: entryParticipant.id, to: dbParticipant(a.entityId).id, label: accessLabel(entryOp.id, a.entityId, a.mode), confidence: a.provenance.confidence });
        modelIds.add(a.entityId);
      }
      // Steps: skip subtrees rooted at out-of-scope components.
      let skipDepth: number | null = null;
      const returnStack: { from: string; to: string; depth: number }[] = [];
      const emitReturnsDownTo = (depth: number): void => {
        while (returnStack.length && returnStack[returnStack.length - 1]!.depth >= depth) {
          const r = returnStack.pop()!;
          body.push({ kind: 'message', from: r.to, to: r.from, label: 'result', reply: true, confidence: 'deterministic' });
        }
      };
      for (const step of flow.steps as FlowStep[]) {
        if (skipDepth !== null) {
          if (step.depth > skipDepth) continue;
          skipDepth = null;
        }
        if (step.depth > scope.depth) continue;
        const from = index.components.get(step.fromComponent);
        const to = index.components.get(step.toComponent);
        if (!visible(from)) continue;
        if (!visible(to)) {
          skipDepth = step.depth;
          continue;
        }
        emitReturnsDownTo(step.depth);
        const fromP = participantFor(from);
        const toP = participantFor(to);
        if (fromP.id === toP.id) continue; // aliased into the same participant
        files.add(to.file);
        modelIds.add(to.id);
        if (step.toOperation) modelIds.add(step.toOperation);
        if (step.provenance.confidence === 'inferred') inferredCount++;
        body.push({ kind: 'message', from: fromP.id, to: toP.id, label: ov.label(step.interactionId, step.label), confidence: step.provenance.confidence, ...(step.async ? { async: true } : {}) });
        if (step.async) asyncCount++;
        if (step.toOperation) {
          for (const a of accessesFor(step.toOperation, to.id)) {
            body.push({ kind: 'message', from: toP.id, to: dbParticipant(a.entityId).id, label: accessLabel(step.toOperation, a.entityId, a.mode), confidence: a.provenance.confidence });
            modelIds.add(a.entityId);
          }
        }
        // Reply arrows only for depth-1 calls keep diagrams readable.
        if (step.depth === 1) returnStack.push({ from: fromP.id, to: toP.id, depth: step.depth });
      }
      emitReturnsDownTo(1);
      body.push({ kind: 'message', from: entryParticipant.id, to: actorParticipant.id, label: 'response', reply: true, confidence: 'deterministic' });
      // Names are always clean: uncertainty is reported in notes, never welded onto the name.
      // A name that came back through the question protocol (semantics.yaml) was
      // answered, not guessed, so it is not reported as uncertain.
      const answered = flow.nameProvenance.reason?.startsWith('semantics.yaml') ?? false;
      if (!answered && flow.nameProvenance.confidence === 'inferred') uncertainNames.push(`${flow.name} — named by heuristic from ${flow.entryOperation}; confirm with \`umlflow semantic questions --kind flow-name\``);
      else if (!answered && flow.nameProvenance.confidence === 'unknown') uncertainNames.push(`${flow.name} — name unknown; declare it with \`umlflow declare flow\``);
      elements.push({ kind: 'fragment', op: 'group', label: flows.length > 1 ? `Flow: ${flow.name}` : flow.name, body });
    }

    for (const rel of ov.relationships) {
      const from = participants.get(ov.canonical(rel.from)) ?? participants.get(`actor:${rel.from}`);
      const to = participants.get(ov.canonical(rel.to)) ?? participants.get(`actor:${rel.to}`);
      if (from && to) elements.push({ kind: 'message', from: from.id, to: to.id, label: rel.label ?? rel.kind ?? 'uses', confidence: 'declared' });
    }

    if (unknownActors > 0) notes.push({ level: 'unknown', text: `${unknownActors} flow(s) start from an unknown actor. Declare one with \`umlflow declare actor <Name> --for <Component>\`.` });
    if (inferredCount > 0) notes.push({ level: 'inferred', text: `${inferredCount} interaction(s) were resolved by naming heuristics rather than typed references (marked "?").` });
    if (flows.length === 0) notes.push({ level: 'info', text: 'No flows matched this scope. Add scope.entryPoints or scope.include, or check `umlflow status`.' });
    for (const u of uncertainNames) notes.push({ level: 'inferred', text: `Uncertain name: ${u}` });
    if (asyncCount > 0) notes.push({ level: 'info', text: `${asyncCount} interaction(s) are awaited / asynchronous (drawn with an open arrow).` });
    for (const f of flows) {
      const unresolved = f.steps.filter((s) => !s.toOperation && index.components.get(s.toComponent)?.file !== '').length;
      if (unresolved > 0) notes.push({ level: 'info', text: `Flow "${f.name}": ${unresolved} call(s) target components whose operation could not be resolved; their downstream calls are not shown.` });
    }

    const diagram: SequenceDiagram = {
      name,
      type: 'sequence',
      title: humanize(name),
      description: definition.description,
      notes,
      rawLines: ov.rawLines,
      styleLines: ov.styleLines,
      uncertaintyMarkers: ctx.uncertaintyMarkers,
      participants: [...participants.values()],
      elements,
    };
    return { diagram, files: [...files].filter(Boolean).sort(), modelIds: [...modelIds].sort() };
  }
}

export type { Flow };
