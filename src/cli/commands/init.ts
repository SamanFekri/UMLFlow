import type { Command } from 'commander';
import pc from 'picocolors';
import { initProject } from '../../config/init.js';
import { HOOK_MODES, KNOWN_DIAGRAM_TYPES, type DiagramType, type HookMode } from '../../config/schema.js';
import { UmlflowError } from '../../core/errors.js';
import { Umlflow } from '../../sync/pipeline.js';
import { globalOptions, makeOut } from '../index.js';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize UMLFlow in this repository (.umlflow/config.yaml, semantics.yaml, diagrams/)')
    .option('-t, --types <types>', `comma-separated diagram types (${KNOWN_DIAGRAM_TYPES.join(', ')})`)
    .option('--hook-mode <mode>', `pre-commit hook mode (${HOOK_MODES.join(', ')})`, 'check')
    .option('--no-analyze', 'do not build the initial index and diagrams')
    .option('-y, --yes', 'accept defaults without prompting')
    .option('--force', 'overwrite an existing configuration')
    .action(async (opts: { types?: string; hookMode: string; analyze: boolean; yes?: boolean; force?: boolean }, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      let types: DiagramType[];
      if (opts.types) {
        types = opts.types.split(',').map((t) => t.trim()).filter(Boolean);
      } else if (opts.yes || g.json || !process.stdin.isTTY) {
        types = [...KNOWN_DIAGRAM_TYPES];
      } else {
        const { checkbox } = await import('@inquirer/prompts');
        types = await checkbox({
          message: 'Which diagrams should UMLFlow maintain?',
          choices: [
            { name: 'Use Case — actors and system capabilities', value: 'usecase', checked: true },
            { name: 'Sequence — interactions for the main entry points', value: 'sequence', checked: true },
            { name: 'ERD — database entities and relationships', value: 'erd', checked: true },
          ],
        });
      }
      for (const t of types) if (!KNOWN_DIAGRAM_TYPES.includes(t)) throw new UmlflowError(`Unknown diagram type "${t}"`, { hint: `Known types: ${KNOWN_DIAGRAM_TYPES.join(', ')}` });
      if (!HOOK_MODES.includes(opts.hookMode as HookMode)) throw new UmlflowError(`Invalid hook mode "${opts.hookMode}"`);
      const result = await initProject({ root: g.cwd, diagramTypes: types, hookMode: opts.hookMode as HookMode, force: opts.force });
      out.line(pc.green('Initialized UMLFlow.'));
      for (const f of result.created) out.line(`  + ${f}`);
      let update;
      if (opts.analyze) {
        const engine = await Umlflow.open(g.cwd);
        update = await engine.update({ all: true });
        out.line('');
        out.indexSummary(update.index);
        out.outcomes(update.diagrams);
        if (update.questions > 0) out.line(pc.yellow(`\n${update.questions} semantic question(s) need an answer: umlflow semantic questions`));
      }
      out.line(pc.dim('\nNext: review .umlflow/config.yaml, then `umlflow install-hooks` to keep diagrams in sync.'));
      out.emitJson({ ...result, update });
    });
}
