import { humanize, slugify } from '../../core/text.js';
import type { DiagramGenerator, GenerateContext, GenerateResult } from '../generator.js';
import { UNKNOWN_ACTOR_ID, UNKNOWN_ACTOR_LABEL, type DiagramNote, type UseCaseDiagram } from '../ir.js';
import { OverrideHelper } from '../overrides.js';
import { componentInScope } from '../scope.js';
import { componentRoleFromSymbol, entryPointFromAnnotations } from '../../model/classify.js';
import type { CodeFile } from '../../codemodel/types.js';

/**
 * Use case diagram: actors and the capabilities (entry points) they trigger.
 * Only entry points become use cases — never every function.
 */
export class UseCaseGenerator implements DiagramGenerator {
  readonly type = 'usecase';
  readonly displayName = 'Use Case';

  isFileRelevant(file: CodeFile): boolean {
    if (file.routes.length > 0) return true;
    return file.symbols.some((s) => (s.routes && s.routes.length > 0) || entryPointFromAnnotations(s, file) !== undefined || (!s.parent && componentRoleFromSymbol(s, file).role === 'controller'));
  }

  generate(ctx: GenerateContext): GenerateResult {
    const { model, index, scope, definition, name } = ctx;
    const ov = new OverrideHelper(definition);
    const notes: DiagramNote[] = [];
    const files = new Set<string>();
    const modelIds = new Set<string>();
    const diagram: UseCaseDiagram = {
      name,
      type: 'usecase',
      title: humanize(name),
      description: definition.description,
      notes,
      rawLines: ov.rawLines,
      styleLines: ov.styleLines,
      uncertaintyMarkers: ctx.uncertaintyMarkers,
      systemName: definition.overrides?.labels?.__system__ ?? 'System',
      actors: [],
      useCases: [],
      associations: [],
      relations: [],
      groups: {},
    };
    const actorsById = new Map<string, { label: string; confidence: UseCaseDiagram['actors'][number]['confidence'] }>();
    let unknownCount = 0;
    let inferredNames = 0;

    for (const uc of model.useCases) {
      const component = index.components.get(uc.componentId);
      if (!component || !componentInScope(component, scope)) continue;
      const op = index.operations.get(uc.operationIds[0]!);
      if (!op) continue;
      if (scope.entryPoints && !scope.entryPoints.has(op.id)) continue;
      if (ov.isExcluded(uc.id) || ov.isExcluded(op.id) || ov.isExcluded(component.id, component.name)) continue;
      files.add(component.file);
      modelIds.add(component.id);
      modelIds.add(op.id);
      modelIds.add(uc.id);
      const label = ov.label(uc.id, ov.label(op.id, uc.name));
      if (uc.nameProvenance.confidence === 'inferred') inferredNames++;
      diagram.useCases.push({ id: uc.id, label, confidence: uc.nameProvenance.confidence === 'declared' ? 'declared' : uc.nameProvenance.confidence, provider: component.id });

      const overrideActor = ov.actorFor(op.id, uc.id, component.id);
      const actorIds = overrideActor ? [overrideActor] : uc.actorIds;
      if (actorIds.length === 0) {
        unknownCount++;
        actorsById.set(UNKNOWN_ACTOR_ID, { label: UNKNOWN_ACTOR_LABEL, confidence: 'unknown' });
        diagram.associations.push({ actor: UNKNOWN_ACTOR_ID, useCase: uc.id, confidence: 'unknown' });
        continue;
      }
      for (const actorId of actorIds) {
        const actor = index.actors.get(actorId);
        const confidence = overrideActor ? 'declared' : actor?.provenance.confidence ?? uc.actorProvenance.confidence;
        const id = slugify(actorId);
        if (!actorsById.has(id)) actorsById.set(id, { label: ov.label(actorId, actor?.name ?? actorId), confidence });
        modelIds.add(actorId);
        diagram.associations.push({ actor: id, useCase: uc.id, confidence: confidence === 'declared' ? 'declared' : confidence });
      }
    }

    for (const [id, a] of actorsById) diagram.actors.push({ id, label: a.label, confidence: a.confidence });
    diagram.actors.sort((a, b) => (a.id === UNKNOWN_ACTOR_ID ? 1 : b.id === UNKNOWN_ACTOR_ID ? -1 : a.label.localeCompare(b.label)));

    for (const [group, members] of Object.entries(definition.overrides?.groups ?? {})) {
      const ids = members
        .map((m) => diagram.useCases.find((u) => u.id === m || u.id === slugify(m) || u.provider === m)?.id)
        .filter((x): x is string => !!x);
      if (ids.length) diagram.groups[group] = [...new Set(ids)];
    }
    for (const rel of ov.relationships) {
      const from = diagram.useCases.find((u) => u.id === rel.from || u.id === slugify(rel.from))?.id;
      const to = diagram.useCases.find((u) => u.id === rel.to || u.id === slugify(rel.to))?.id;
      if (!from || !to) continue;
      const kind = rel.kind === 'extend' ? 'extend' : rel.kind === 'generalize' ? 'generalize' : 'include';
      diagram.relations.push({ from, to, kind, label: rel.label });
    }

    if (unknownCount > 0) {
      notes.push({ level: 'unknown', text: `${unknownCount} use case(s) have no known actor. Declare one with \`umlflow declare actor <Name> --for <Component>\` or answer \`umlflow semantic questions\`.` });
    }
    if (inferredNames > 0) notes.push({ level: 'inferred', text: `${inferredNames} use case name(s) were derived from operation names (marked "?").` });
    if (diagram.useCases.length === 0) notes.push({ level: 'info', text: 'No entry points found in scope. Widen the scope or declare entry points.' });

    return { diagram, files: [...files].filter(Boolean).sort(), modelIds: [...modelIds].sort() };
  }
}
