import { inferredFact, unknownFact, type Provenance } from '../core/provenance.js';
import { provenanceFor, type SemanticsData } from './semantics.js';
import { ModelIndex, type Flow, type FlowStep, type SystemModel } from './types.js';

/**
 * Builds behavioural flows: for every entry point, walk resolved interactions
 * depth-first (bounded, cycle-safe). Self-calls are inlined so that private
 * helper methods contribute their downstream calls without appearing as
 * participants.
 */
export function buildFlows(model: SystemModel, semantics: SemanticsData, maxDepth: number): Flow[] {
  const index = new ModelIndex(model);
  const accessByComponent = new Map<string, string[]>();
  for (const a of model.dataAccess) {
    const list = accessByComponent.get(a.componentId) ?? [];
    list.push(a.entityId);
    accessByComponent.set(a.componentId, list);
  }
  const flows: Flow[] = [];
  for (const op of model.operations) {
    if (!op.entryPoint) continue;
    if (semantics.operations[op.id]?.ignore) continue;
    const steps: FlowStep[] = [];
    const components: string[] = [op.componentId];
    const entities = new Set<string>(accessByComponent.get(op.componentId) ?? []);
    const visited = new Set<string>([op.id]);
    const walk = (fromOp: string, fromComponent: string, depth: number): void => {
      if (depth > maxDepth) return;
      const outgoing = (index.interactionsByFrom.get(fromOp) ?? []).slice().sort((a, b) => a.order - b.order);
      for (const inter of outgoing) {
        if (inter.toComponent === fromComponent) {
          // self call: inline callee's interactions
          if (inter.toOperation && !visited.has(inter.toOperation)) {
            visited.add(inter.toOperation);
            walk(inter.toOperation, fromComponent, depth);
          }
          continue;
        }
        steps.push({
          depth,
          fromComponent,
          toComponent: inter.toComponent,
          toOperation: inter.toOperation,
          label: inter.label,
          interactionId: inter.id,
          ref: inter.ref,
          provenance: inter.provenance,
        });
        if (!components.includes(inter.toComponent)) components.push(inter.toComponent);
        for (const e of accessByComponent.get(inter.toComponent) ?? []) entities.add(e);
        if (inter.toOperation && !visited.has(inter.toOperation)) {
          visited.add(inter.toOperation);
          walk(inter.toOperation, inter.toComponent, depth + 1);
        }
      }
    };
    walk(op.id, op.componentId, 1);
    const sem = semantics.operations[op.id];
    const useCase = model.useCases.find((uc) => uc.operationIds.includes(op.id));
    let name: string;
    let nameProvenance: Provenance;
    if (sem?.flow) {
      name = sem.flow;
      nameProvenance = provenanceFor(sem.source, 'semantics.yaml');
    } else if (useCase) {
      name = useCase.name;
      nameProvenance = useCase.nameProvenance.confidence === 'unknown' ? unknownFact([op.ref]) : inferredFact([op.ref], 'named after use case');
    } else {
      name = op.name;
      nameProvenance = inferredFact([op.ref], 'named after operation');
    }
    flows.push({
      id: op.id,
      name,
      nameProvenance,
      entryOperation: op.id,
      entryComponent: op.componentId,
      actorId: useCase?.actorIds[0],
      steps,
      components,
      entities: [...entities].sort(),
    });
  }
  return flows;
}
