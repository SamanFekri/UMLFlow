import path from 'node:path';
import type { Umlflow } from '../sync/pipeline.js';
import type { SystemModel } from '../model/types.js';

/**
 * Compact project summary for Claude (and humans). Designed to be the first
 * thing read before any source file: it answers "what does UMLFlow already
 * know?" in a few hundred tokens.
 */
export interface ContextSummary {
  root: string;
  initialized: boolean;
  diagrams: { name: string; type: string; file: string; description?: string; scope: string; status: string }[];
  index: { files: number; unparsed: number; languages: Record<string, number>; pendingChanges: number; rebuilt: boolean };
  model: {
    components: number;
    byRole: Record<string, number>;
    entryPoints: number;
    entities: number;
    relations: number;
    flows: number;
    inferredFacts: number;
    unknownFacts: number;
  };
  semantics: { userFacts: number; inferredFacts: number };
  questions: { id: string; kind: string; priority: string; subject: string; question: string; options?: string[]; context?: string[]; refs: string[] }[];
  entryPoints: string[];
  nextSteps: string[];
}

export async function buildContext(engine: Umlflow): Promise<ContextSummary> {
  const config = engine.getConfig();
  const index = await engine.refreshIndex();
  const model = await engine.getModel();
  const states = await engine.indexStore.loadDiagramState();
  const affected = await engine.affectedDiagrams(index.sinceSync, { includeAllIfRebuilt: false });
  const diagrams = Object.entries(config.diagrams).map(([name, def]) => {
    const scope = def.scope && Object.values(def.scope).some((v) => (Array.isArray(v) ? v.length : v !== undefined)) ? 'user' : def.inferredScope?.files?.length || def.inferredScope?.entities?.length ? `inferred("${def.inferredScope?.query ?? ''}")` : 'whole repository';
    const status = !states[name] ? 'never generated' : affected.has(name) ? `possibly stale (${affected.get(name)})` : 'up to date';
    return { name, type: def.type, file: path.relative(engine.root, engine.diagramFile(name, def)), description: def.description, scope, status };
  });
  const languages: Record<string, number> = {};
  for (const f of Object.values(engine.indexedFiles())) languages[f.language] = (languages[f.language] ?? 0) + 1;
  const sem = engine.semanticsStore.get();
  const semEntries = [...Object.values(sem.components), ...Object.values(sem.actors), ...Object.values(sem.operations), ...Object.values(sem.entities)];
  const nextSteps: string[] = [];
  const pending = index.sinceSync.added.length + index.sinceSync.modified.length + index.sinceSync.deleted.length + index.sinceSync.renamed.length;
  if (diagrams.some((d) => d.status !== 'up to date')) nextSteps.push('Run `umlflow update` to bring affected diagrams up to date.');
  const required = model.questions.filter((q) => (q.priority ?? 'required') === 'required').length;
  const optional = model.questions.length - required;
  if (required) nextSteps.push(`Answer ${required} required semantic question(s): \`umlflow semantic questions\` then \`umlflow semantic answer --set <id>=<value>\`.`);
  if (optional) nextSteps.push(`${optional} optional refinement(s) (flow names, relations) can improve diagram quality: \`umlflow semantic questions --kind flow-name\`.`);
  if (diagrams.length === 0) nextSteps.push('No diagrams defined: `umlflow generate --type <usecase|sequence|erd> --name <name> [--about "<topic>"]`.');
  return {
    root: engine.root,
    initialized: true,
    diagrams,
    index: { files: index.total, unparsed: model.unparsed.length, languages, pendingChanges: pending, rebuilt: index.rebuilt },
    model: summarizeModel(model),
    semantics: { userFacts: semEntries.filter((e) => e.source === 'user').length, inferredFacts: semEntries.filter((e) => e.source === 'semantic-inference').length },
    questions: model.questions.map((q) => ({ id: q.id, kind: q.kind, priority: q.priority ?? 'required', subject: q.subject, question: q.question, options: q.options, context: q.context, refs: q.refs.map((r) => `${r.file}${r.line ? ':' + r.line : ''}`) })),
    entryPoints: model.operations.filter((o) => o.entryPoint).map((o) => `${o.id} [${o.entryPoint!.kind}${o.entryPoint!.path ? ' ' + (o.entryPoint!.method ?? '') + ' ' + o.entryPoint!.path : ''}]`),
    nextSteps,
  };
}

export function summarizeModel(model: SystemModel): ContextSummary['model'] {
  const byRole: Record<string, number> = {};
  for (const c of model.components) byRole[c.role] = (byRole[c.role] ?? 0) + 1;
  const provs = [
    ...model.components.map((c) => c.roleProvenance),
    ...model.interactions.map((i) => i.provenance),
    ...model.useCases.map((u) => u.actorProvenance),
    ...model.useCases.map((u) => u.nameProvenance),
  ];
  return {
    components: model.components.length,
    byRole,
    entryPoints: model.operations.filter((o) => o.entryPoint).length,
    entities: model.entities.length,
    relations: model.relations.length,
    flows: model.flows.length,
    inferredFacts: provs.filter((p) => p.confidence === 'inferred').length,
    unknownFacts: provs.filter((p) => p.confidence === 'unknown').length,
  };
}

export function formatContext(ctx: ContextSummary): string {
  const lines: string[] = [];
  lines.push(`UMLFlow project: ${ctx.root}`);
  lines.push(`Index: ${ctx.index.files} files (${Object.entries(ctx.index.languages).map(([l, n]) => `${l}:${n}`).join(', ') || 'none'})${ctx.index.unparsed ? `, ${ctx.index.unparsed} not analysable` : ''}${ctx.index.pendingChanges ? `, ${ctx.index.pendingChanges} changed since last sync` : ''}`);
  const m = ctx.model;
  lines.push(`Model: ${m.components} components (${Object.entries(m.byRole).map(([r, n]) => `${n} ${r}`).join(', ')}), ${m.entryPoints} entry points, ${m.entities} entities, ${m.relations} relations, ${m.flows} flows; ${m.inferredFacts} inferred, ${m.unknownFacts} unknown facts`);
  lines.push(`Semantics: ${ctx.semantics.userFacts} user-declared, ${ctx.semantics.inferredFacts} established inferences`);
  lines.push('Diagrams:');
  if (!ctx.diagrams.length) lines.push('  (none defined)');
  for (const d of ctx.diagrams) lines.push(`  - ${d.name} [${d.type}] ${d.file} — scope: ${d.scope}; ${d.status}`);
  if (ctx.entryPoints.length) {
    lines.push('Entry points:');
    for (const e of ctx.entryPoints.slice(0, 40)) lines.push(`  - ${e}`);
    if (ctx.entryPoints.length > 40) lines.push(`  … ${ctx.entryPoints.length - 40} more (see \`umlflow status --json\`)`);
  }
  if (ctx.questions.length) {
    const req = ctx.questions.filter((q) => q.priority === 'required').length;
    lines.push(`Open semantic questions (${ctx.questions.length}${req !== ctx.questions.length ? `, ${req} required` : ''}):`);
    for (const q of ctx.questions.slice(0, 20)) {
      lines.push(`  - ${q.id}: ${q.question}`);
      if (q.context?.length) lines.push(`      context: ${q.context.join('; ')}`);
      if (q.options?.length) lines.push(`      options: ${q.options.join(', ')}`);
      lines.push(`      refs: ${q.refs.join(', ')}`);
    }
    if (ctx.questions.length > 20) lines.push(`  … ${ctx.questions.length - 20} more`);
  }
  if (ctx.nextSteps.length) {
    lines.push('Next steps:');
    for (const s of ctx.nextSteps) lines.push(`  - ${s}`);
  }
  return lines.join('\n');
}
