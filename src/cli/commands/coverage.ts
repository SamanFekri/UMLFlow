import type { Command } from 'commander';
import pc from 'picocolors';
import { Umlflow } from '../../sync/pipeline.js';
import { globalOptions, makeOut } from '../index.js';
import { buildCoverage, validateDiagrams, type DiagramEvidence } from '../../sync/coverage.js';
import { plural } from '../../core/text.js';

/** Collect every diagram's rendered text plus the model ids it drew from. */
async function evidence(engine: Umlflow): Promise<{ items: DiagramEvidence[]; ids: Set<string> }> {
  const items: DiagramEvidence[] = [];
  const ids = new Set<string>();
  const model = await engine.getModel();
  for (const [name, def] of Object.entries(engine.getConfig().diagrams)) {
    try {
      const generated = await engine.generateDiagram(name, def, model);
      items.push({ name, type: def.type, rendered: generated.block, modelIds: generated.state.modelIds });
      for (const id of generated.state.modelIds) ids.add(id);
    } catch {
      /* a broken diagram is reported by `update`/`check`; coverage should not fail on it */
    }
  }
  return { items, ids };
}

export function registerCoverage(program: Command): void {
  program
    .command('coverage')
    .description('Report what UMLFlow analysed and what it could not: files, entry points, use cases, components')
    .action(async (_opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      await engine.refreshIndex();
      const model = await engine.getModel();
      const { ids } = await evidence(engine);
      const c = buildCoverage(model, engine.getConfig().diagrams, ids);

      out.heading(`Coverage: ${(c.score * 100).toFixed(0)}% of indexed files produced structure`);
      out.line(`Files: ${c.files.total} indexed — ${pc.green(String(c.files.analysed))} analysed, ${c.files.noStructure} without structure, ${c.files.unparsed} unparsed`);
      out.line(`Entry points: ${c.entryPoints.total}${Object.keys(c.entryPoints.byKind).length ? ` (${Object.entries(c.entryPoints.byKind).map(([k, n]) => `${k}:${n}`).join(', ')})` : ''}`);
      out.line(`Use cases: ${c.useCases.total} — ${pc.green(String(c.useCases.withScenario))} with a sequence diagram, ${c.useCases.withoutScenario.length} without`);
      out.line(`Components: ${c.components.total} — ${c.components.unknownRole.length} with an unknown role, ${c.components.notInAnyDiagram.length} in no diagram`);

      if (c.useCases.withoutScenario.length) {
        out.line('');
        out.line(pc.yellow('Use cases without their own sequence diagram:'));
        for (const uc of c.useCases.withoutScenario) out.line(`  - ${uc.name} ${pc.dim(`(${uc.entryOperation})`)}`);
        out.line(pc.dim('  Run `umlflow scenarios` to give each one its own diagram.'));
      }
      if (c.notUnderstood.length) {
        out.line('');
        out.line(pc.yellow(`${plural(c.notUnderstood.length, 'file')} UMLFlow could not turn into structure:`));
        for (const f of c.notUnderstood.slice(0, 20)) out.line(`  - ${f.file} ${pc.dim(`(${f.reason ?? f.status})`)}`);
        if (c.notUnderstood.length > 20) out.line(pc.dim(`  … and ${c.notUnderstood.length - 20} more (use --json for the full list)`));
      }
      if (c.components.notInAnyDiagram.length) {
        out.line('');
        out.line(pc.dim(`Components in no diagram: ${c.components.notInAnyDiagram.slice(0, 15).join(', ')}${c.components.notInAnyDiagram.length > 15 ? ' …' : ''}`));
      }
      if (c.unresolvedCalls.length) {
        out.line('');
        out.line(pc.dim(`${plural(c.unresolvedCalls.length, 'call')} could not be resolved to an operation; downstream steps are not drawn.`));
      }
      if (c.openQuestions) out.line(pc.yellow(`\n${plural(c.openQuestions, 'semantic question')} open: umlflow semantic questions`));
      out.emitJson(c);
    });

  program
    .command('validate')
    .description('Validate generated diagrams against the System Model (clean names, evidence-backed participants, one scenario per use case)')
    .option('--strict', 'exit non-zero on warnings as well as errors')
    .action(async (opts: { strict?: boolean }, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      await engine.refreshIndex();
      const model = await engine.getModel();
      const { items, ids } = await evidence(engine);
      const coverage = buildCoverage(model, engine.getConfig().diagrams, ids);
      const issues = validateDiagrams(model, items, coverage, engine.getConfig().diagrams);
      const errors = issues.filter((i) => i.level === 'error');
      const warnings = issues.filter((i) => i.level === 'warning');

      if (issues.length === 0) {
        out.line(`${pc.green('✓')} ${plural(items.length, 'diagram')} validated: names are clean, participants are backed by the model, every use case has a scenario.`);
      } else {
        out.heading(`${errors.length} error(s), ${warnings.length} warning(s)`);
        for (const i of issues) {
          const tag = i.level === 'error' ? pc.red('✗') : pc.yellow('!');
          out.line(`  ${tag} ${i.diagram ? pc.dim(`[${i.diagram}] `) : ''}${i.message} ${pc.dim(`(${i.code})`)}`);
        }
      }
      out.emitJson({ issues, errors: errors.length, warnings: warnings.length, diagrams: items.length });
      if (errors.length || (opts.strict && warnings.length)) process.exitCode = 1;
    });
}
