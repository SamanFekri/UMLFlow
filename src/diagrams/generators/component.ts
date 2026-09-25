import { humanize, slugify } from '../../core/text.js';
import type { Component } from '../../model/types.js';
import type { DiagramGenerator, GenerateContext, GenerateResult } from '../generator.js';
import type { ComponentDiagram, ComponentEdge, ComponentNode, DiagramNote } from '../ir.js';
import { OverrideHelper } from '../overrides.js';
import { componentInScope, entityInScope } from '../scope.js';

/**
 * Architecture / component diagram.
 *
 * A structural view of the same System Model the sequence and use case
 * diagrams are built from: components, the dependencies between them, the
 * external systems they reach and the data they touch.
 *
 * Layers are *emergent*: a group is only drawn when the codebase actually has
 * components of that role, so a CLI tool does not get an empty "Interface"
 * band and an event-driven system is not forced into a request/response shape.
 */
export class ComponentGenerator implements DiagramGenerator {
  readonly type = 'component';
  readonly displayName = 'Component';

  generate(ctx: GenerateContext): GenerateResult {
    const { model, index, scope, definition, name } = ctx;
    const ov = new OverrideHelper(definition);
    const notes: DiagramNote[] = [];
    const files = new Set<string>();
    const modelIds = new Set<string>();
    const nodes = new Map<string, ComponentNode>();
    const edges: ComponentEdge[] = [];
    let inferredRoles = 0;

    // Components that are worth drawing: pure data shapes are noise in an
    // architecture view, and the ERD already covers them.
    const drawable = (c: Component): boolean =>
      c.role !== 'model' && componentInScope(c, scope) && !ov.isExcluded(c.id, c.name);

    const addComponent = (c: Component): ComponentNode => {
      const id = ov.canonical(c.id);
      const existing = nodes.get(id);
      if (existing) return existing;
      const node: ComponentNode = {
        id: slugify(id) || id,
        label: ov.label(c.id, c.name),
        role: c.role,
        kind: c.file === '' ? 'external' : 'component',
        confidence: c.roleProvenance.confidence,
      };
      nodes.set(id, node);
      modelIds.add(c.id);
      if (c.file) files.add(c.file);
      if (c.roleProvenance.confidence === 'inferred') inferredRoles++;
      return node;
    };

    for (const c of model.components) if (drawable(c)) addComponent(c);

    // Dependencies between drawn components. A pair is drawn once: "injects"
    // and "calls" between the same two components are the same architectural
    // edge seen twice, and the behavioural one is the more informative.
    const RANK: Record<string, number> = { calls: 5, injects: 4, implements: 3, extends: 3, imports: 2, uses: 1 };
    const visible = new Set(nodes.keys());
    const byPair = new Map<string, ComponentEdge>();
    for (const dep of model.dependencies) {
      const from = ov.canonical(dep.from);
      const to = ov.canonical(dep.to);
      if (!visible.has(from) || !visible.has(to) || from === to) continue;
      const fromId = nodes.get(from)!.id;
      const toId = nodes.get(to)!.id;
      const key = `${fromId}->${toId}`;
      const candidate: ComponentEdge = { from: fromId, to: toId, kind: dep.kind, confidence: dep.provenance.confidence };
      const current = byPair.get(key);
      if (!current || (RANK[dep.kind] ?? 0) > (RANK[current.kind] ?? 0)) byPair.set(key, candidate);
    }
    edges.push(...byPair.values());

    // Datastores: entities a drawn component reads or writes.
    for (const access of model.dataAccess) {
      const owner = index.components.get(access.componentId);
      const entity = index.entities.get(access.entityId);
      if (!owner || !entity || !drawable(owner)) continue;
      if (!entityInScope(entity, scope)) continue;
      const storeKey = `db:${ov.canonical(entity.id)}`;
      let store = nodes.get(storeKey);
      if (!store) {
        store = { id: slugify(storeKey), label: ov.label(entity.id, entity.name), role: 'entity', kind: 'datastore', confidence: entity.provenance.confidence };
        nodes.set(storeKey, store);
        modelIds.add(entity.id);
      }
      const fromId = nodes.get(ov.canonical(owner.id))!.id;
      if (edges.some((e) => e.from === fromId && e.to === store!.id)) continue;
      edges.push({ from: fromId, to: store.id, kind: access.mode, confidence: access.provenance.confidence });
    }

    // Emergent layers: only roles that actually occur become groups.
    const LAYERS: [string, string[]][] = [
      ['Interface', ['controller']],
      ['Application', ['service', 'handler']],
      ['Domain & Data', ['repository', 'entity']],
      ['Integration', ['gateway']],
    ];
    const groups: Record<string, string[]> = {};
    for (const [layer, roles] of LAYERS) {
      const members = [...nodes.values()].filter((n) => n.kind === 'component' && roles.includes(n.role)).map((n) => n.id);
      if (members.length) groups[layer] = members;
    }
    const externals = [...nodes.values()].filter((n) => n.kind === 'external').map((n) => n.id);
    if (externals.length) groups['External systems'] = externals;

    if (nodes.size === 0) notes.push({ level: 'info', text: 'No components matched this scope.' });
    if (inferredRoles > 0) {
      notes.push({ level: 'inferred', text: `${inferredRoles} component role(s) were inferred rather than read from the code. Confirm with \`umlflow semantic questions --kind component-role\`.` });
    }

    const diagram: ComponentDiagram = {
      name,
      type: 'component',
      title: humanize(name),
      description: definition.description,
      notes,
      rawLines: ov.rawLines,
      styleLines: ov.styleLines,
      uncertaintyMarkers: ctx.uncertaintyMarkers,
      nodes: [...nodes.values()],
      edges,
      groups,
    };
    return { diagram, files: [...files].filter(Boolean).sort(), modelIds: [...modelIds].sort() };
  }
}
