import type { SystemModel } from '../model/types.js';

/** Semantic changes between two System Models (line numbers and timestamps ignored). */
export interface ModelDiff {
  added: string[];
  removed: string[];
  changed: string[];
  isEmpty: boolean;
}

function setDiff(prev: Iterable<string>, next: Iterable<string>): { added: string[]; removed: string[] } {
  const p = new Set(prev);
  const n = new Set(next);
  return { added: [...n].filter((x) => !p.has(x)).sort(), removed: [...p].filter((x) => !n.has(x)).sort() };
}

export function diffModels(prev: SystemModel, next: SystemModel): ModelDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  const comps = setDiff(
    prev.components.map((c) => c.id),
    next.components.map((c) => c.id),
  );
  for (const id of comps.added) added.push(`${roleLabel(next, id)} ${id} added`);
  for (const id of comps.removed) removed.push(`${roleLabel(prev, id)} ${id} removed`);
  for (const c of next.components) {
    const before = prev.components.find((p) => p.id === c.id);
    if (before && before.role !== c.role) changed.push(`${c.id} role changed: ${before.role} → ${c.role}`);
  }

  const deps = setDiff(
    prev.dependencies.map((d) => `${d.from}|${d.kind}|${d.to}`),
    next.dependencies.map((d) => `${d.from}|${d.kind}|${d.to}`),
  );
  for (const d of deps.added) added.push(describeDep(d, 'now'));
  for (const d of deps.removed) removed.push(describeDep(d, 'no longer'));

  const inter = setDiff(
    prev.interactions.map((i) => `${i.from} → ${i.toComponent}.${i.label}`),
    next.interactions.map((i) => `${i.from} → ${i.toComponent}.${i.label}`),
  );
  for (const i of inter.added) added.push(`call ${i} added`);
  for (const i of inter.removed) removed.push(`call ${i} removed`);

  const entries = (m: SystemModel) =>
    m.operations.filter((o) => o.entryPoint).map((o) => `${o.id} [${o.entryPoint!.kind}${o.entryPoint!.path ? ' ' + (o.entryPoint!.method ?? '') + ' ' + o.entryPoint!.path : ''}]`);
  const eps = setDiff(entries(prev), entries(next));
  for (const e of eps.added) added.push(`entry point ${e} added`);
  for (const e of eps.removed) removed.push(`entry point ${e} removed`);

  const ents = setDiff(
    prev.entities.map((e) => e.id),
    next.entities.map((e) => e.id),
  );
  for (const e of ents.added) added.push(`entity ${e} added`);
  for (const e of ents.removed) removed.push(`entity ${e} removed`);
  for (const e of next.entities) {
    const before = prev.entities.find((p) => p.id === e.id);
    if (!before) continue;
    const attrs = setDiff(
      before.attributes.map((a) => a.name),
      e.attributes.map((a) => a.name),
    );
    if (attrs.added.length) changed.push(`entity ${e.id}: attributes added ${attrs.added.join(', ')}`);
    if (attrs.removed.length) changed.push(`entity ${e.id}: attributes removed ${attrs.removed.join(', ')}`);
  }
  const rels = setDiff(
    prev.relations.map((r) => `${r.from} ${r.kind} ${r.to}`),
    next.relations.map((r) => `${r.from} ${r.kind} ${r.to}`),
  );
  for (const r of rels.added) added.push(`relation ${r} added`);
  for (const r of rels.removed) removed.push(`relation ${r} removed`);

  const access = setDiff(
    prev.dataAccess.map((a) => `${a.componentId} ${a.mode} ${a.entityId}`),
    next.dataAccess.map((a) => `${a.componentId} ${a.mode} ${a.entityId}`),
  );
  for (const a of access.added) added.push(`data access ${a} added`);
  for (const a of access.removed) removed.push(`data access ${a} removed`);

  const key = (u: SystemModel['useCases'][number]) => `${u.id}:${u.name}:${u.actorIds.join('+')}`;
  const ucs = setDiff(prev.useCases.map(key), next.useCases.map(key));
  const idOf = (k: string) => k.split(':')[0]!;
  for (const u of ucs.added) {
    const before = ucs.removed.find((r) => idOf(r) === idOf(u));
    if (before) changed.push(`use case ${before.split(':')[1]} → ${u.split(':')[1]}${u.split(':')[2] ? ` (actor: ${u.split(':')[2]})` : ''}`);
    else added.push(`use case ${u.split(':')[1]} added`);
  }
  for (const u of ucs.removed) if (!ucs.added.some((a) => idOf(a) === idOf(u))) removed.push(`use case ${u.split(':')[1]} removed`);

  return { added, removed, changed, isEmpty: added.length + removed.length + changed.length === 0 };
}

function roleLabel(model: SystemModel, id: string): string {
  return model.components.find((c) => c.id === id)?.role ?? 'component';
}

function describeDep(key: string, when: string): string {
  const [from, kind, to] = key.split('|');
  const verb = kind === 'injects' ? 'depends on' : kind === 'calls' ? 'calls' : kind === 'extends' ? 'extends' : kind === 'implements' ? 'implements' : kind === 'imports' ? 'imports' : 'uses';
  return `${from} ${when} ${verb} ${to}`;
}
