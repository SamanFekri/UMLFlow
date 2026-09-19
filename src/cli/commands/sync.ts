import type { Command } from 'commander';
import pc from 'picocolors';
import { Umlflow } from '../../sync/pipeline.js';
import { globalOptions, makeOut } from '../index.js';
import { buildContext, formatContext } from '../context.js';
import { plural } from '../../core/text.js';

export function registerSync(program: Command): void {
  program
    .command('update [names...]')
    .description('Bring affected diagrams up to date (only re-analyses changed files)')
    .option('--all', 'regenerate every diagram, even unaffected ones')
    .option('--force', 'rewrite every diagram file even if unchanged')
    .action(async (names: string[], opts: { all?: boolean; force?: boolean }, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const result = await engine.update({ names, all: opts.all, force: opts.force });
      out.indexSummary(result.index);
      const touched = result.diagrams.filter((d) => d.status === 'updated' || d.status === 'created').length;
      out.line(`${plural(result.diagrams.filter((d) => d.status !== 'skipped').length, 'diagram')} affected, ${touched} written.`);
      out.outcomes(result.diagrams);
      if (result.modelDiff && !result.modelDiff.isEmpty) {
        out.line('\nArchitecture changes since last sync:');
        out.modelDiff(result.modelDiff);
      }
      if (result.questions > 0) out.line(pc.yellow(`\n${plural(result.questions, 'semantic question')} open: umlflow semantic questions`));
      out.emitJson(result);
      if (result.diagrams.some((d) => d.status === 'error')) process.exitCode = 1;
    });

  program
    .command('check')
    .description('Report stale diagrams without modifying them (exit code 1 when stale; suitable for CI)')
    .action(async (_opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const result = await engine.check();
      out.indexSummary(result.index);
      out.outcomes(result.diagrams);
      if (result.stale) {
        out.line(pc.yellow('\nDiagrams are out of date. Run `umlflow update`.'));
        process.exitCode = 1;
      } else out.line(pc.green('\nAll diagrams are up to date.'));
      out.emitJson(result);
    });

  program
    .command('status')
    .description('Show index health, pending changes, diagram freshness and open questions')
    .action(async (_opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const health = await engine.indexStore.health();
      const ctx = await buildContext(engine);
      if (health.corrupt) out.line(pc.yellow(`Cache was corrupt and has been rebuilt: ${health.problems.join('; ')}`));
      out.line(formatContext(ctx));
      out.emitJson({ ...ctx, cache: health });
    });

  program
    .command('context')
    .description('Compact summary of what UMLFlow already knows (read this before reading source code)')
    .action(async (_opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const ctx = await buildContext(engine);
      out.line(formatContext(ctx));
      out.emitJson(ctx);
    });

  program
    .command('diff')
    .description('Show semantic architecture changes since the last sync and the diagrams they affect')
    .action(async (_opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const result = await engine.diff();
      out.indexSummary(result.index);
      if (!result.hasBaseline) out.line(pc.dim('No previous sync found; showing everything as new.'));
      if (!result.diff.isEmpty) out.line('UMLFlow detected architecture changes:');
      out.modelDiff(result.diff);
      out.line('\nAffected diagrams:');
      if (result.affected.size === 0) out.line(pc.dim('  (none)'));
      for (const [name, reason] of result.affected) out.line(`  - ${name} ${pc.dim(`(${reason})`)}`);
      out.emitJson({ ...result, affected: Object.fromEntries(result.affected) });
    });

  program
    .command('rebuild-index')
    .description('Discard the local cache and rebuild it from the source code')
    .action(async (_opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const result = await engine.rebuildIndex();
      out.line(pc.green(`Index rebuilt: ${plural(result.total, 'file')} analysed.`));
      out.emitJson(result);
    });

  program
    .command('diagrams')
    .description('List defined diagrams')
    .action(async (_opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const config = engine.getConfig();
      const list = Object.entries(config.diagrams).map(([name, def]) => ({ name, type: def.type, description: def.description, file: engine.diagramFile(name, def).replace(engine.root + '/', '') }));
      for (const d of list) out.line(`${d.name} ${pc.dim(d.type)} → ${d.file}${d.description ? pc.dim(` — ${d.description}`) : ''}`);
      if (!list.length) out.line(pc.dim('No diagrams defined. Try `umlflow generate`.'));
      out.emitJson(list);
    });
}
