import type { Command } from 'commander';
import pc from 'picocolors';
import { globalOptions, makeOut } from '../index.js';
import { Umlflow } from '../../sync/pipeline.js';

/**
 * `umlflow scenarios` — one sequence diagram per use case.
 *
 * Each scenario is pinned to a single entry point, so unrelated use cases are
 * never merged into one diagram.
 */
export function registerScenarios(program: Command): void {
  program
    .command('scenarios')
    .description('Define and build one sequence diagram per use case (scenario), each scoped to a single entry point')
    .option('--dry-run', 'show what would be created without writing anything')
    .option('--depth <n>', 'call depth for the generated scenarios', (v) => Number.parseInt(v, 10))
    .option('--no-build', 'only define the diagrams; do not generate them yet')
    .action(async (opts: { dryRun?: boolean; depth?: number; build?: boolean }, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      const engine = await Umlflow.open(g.cwd);
      const plans = await engine.defineScenarios({
        ...(opts.depth ? { depth: opts.depth } : {}),
        ...(opts.dryRun ? { dryRun: true } : {}),
      });
      const created = plans.filter((p) => !p.exists);
      const existing = plans.filter((p) => p.exists);

      if (plans.length === 0) {
        out.line('No use cases found — nothing to build a scenario from.');
        out.line(pc.dim('Entry points are what create use cases: routes, CLI commands, handlers. Check `umlflow coverage`.'));
        out.emitJson({ scenarios: [], created: 0, existing: 0 });
        return;
      }

      out.heading(opts.dryRun ? `Would define ${created.length} scenario(s):` : `${created.length} scenario(s) defined, ${existing.length} already present:`);
      for (const p of plans) {
        const mark = p.exists ? pc.dim('=') : pc.green('+');
        out.line(`  ${mark} ${p.name} ${pc.dim(`→ ${p.entryOperation}`)}`);
      }

      if (!opts.dryRun && opts.build !== false) {
        const names = plans.map((p) => p.name);
        const result = await engine.update({ names, force: true });
        out.line('');
        out.outcomes(result.diagrams);
      } else if (!opts.dryRun) {
        out.line('');
        out.line(pc.dim('Run `umlflow update` to generate them.'));
      }
      out.emitJson({
        scenarios: plans.map((p) => ({ name: p.name, useCase: p.useCaseId, entryOperation: p.entryOperation, title: p.title, existed: p.exists })),
        created: created.length,
        existing: existing.length,
      });
    });
}
