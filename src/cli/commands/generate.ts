import type { Command } from 'commander';
import pc from 'picocolors';
import type { DiagramDefinition } from '../../config/schema.js';
import { UmlflowError } from '../../core/errors.js';
import { slugify } from '../../core/text.js';
import { Umlflow } from '../../sync/pipeline.js';
import { globalOptions, makeOut } from '../index.js';

export function registerGenerate(program: Command): void {
  program
    .command('generate')
    .alias('gen')
    .description('Define and generate a diagram (interactive when no options are given)')
    .option('-t, --type <type>', 'diagram type: usecase | sequence | erd')
    .option('-n, --name <name>', 'diagram name (also the output file name)')
    .option('-a, --about <query>', 'infer the scope from a topic, e.g. "login" or "checkout"')
    .option('-d, --description <text>', 'description shown in the diagram title')
    .option('--include <globs...>', 'explicit path scope (overrides inference)')
    .option('--exclude <globs...>', 'paths to exclude')
    .option('--entry <ids...>', 'entry operations, e.g. AuthController.login or "POST /login"')
    .option('--components <names...>', 'explicit components to include')
    .option('--entities <names...>', 'explicit entities to include (ERD)')
    .option('--depth <n>', 'maximum call depth for sequence diagrams', (v) => Number.parseInt(v, 10))
    .option('--no-write', 'print the diagram instead of writing it')
    .action(async (opts: GenerateOptions, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      const engine = await Umlflow.open(g.cwd);
      const known = engine.generators.types();
      let { type, name, about } = opts;
      if (!type && !name) {
        if (g.json || !process.stdin.isTTY) throw new UmlflowError('Specify --type and --name (or run interactively)');
        const { select, input } = await import('@inquirer/prompts');
        type = await select({ message: 'Diagram type', choices: known.map((t) => ({ name: t, value: t })) });
        about = await input({ message: 'What should it cover? (topic for scope inference, empty = whole repository)' });
        const suggested = about ? slugify(`${about}-${type}`) : slugify(`${type}-diagram`);
        name = await input({ message: 'Diagram name', default: suggested });
      }
      const existing = name ? engine.getConfig().diagrams[name] : undefined;
      if (!type && existing) type = existing.type;
      if (!type) throw new UmlflowError('Missing --type');
      if (!known.includes(type)) throw new UmlflowError(`Unknown diagram type "${type}"`, { hint: `Available: ${known.join(', ')}` });
      if (!name) name = about ? slugify(`${about}-${type}`) : slugify(`${type}-diagram`);
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) throw new UmlflowError(`Invalid diagram name "${name}"`);

      const def: DiagramDefinition = { ...(existing ?? {}), type };
      if (opts.description) def.description = opts.description;
      const scope = { ...(existing?.scope ?? {}) };
      if (opts.include) scope.include = opts.include;
      if (opts.exclude) scope.exclude = opts.exclude;
      if (opts.entry) scope.entryPoints = opts.entry;
      if (opts.components) scope.components = opts.components;
      if (opts.entities) scope.entities = opts.entities;
      if (opts.depth !== undefined) scope.depth = opts.depth;
      if (Object.keys(scope).length) def.scope = scope;

      await engine.refreshIndex();
      const { definition, inference } = await engine.defineDiagram(name, def, about);
      if (inference) {
        const n = inference.matchedEntryPoints.length + inference.matchedComponents.length + inference.matchedEntities.length;
        if (n === 0) {
          out.line(pc.yellow(`Nothing in the code matched "${about}". The diagram will use the whole repository; narrow it with --include/--entry or edit .umlflow/config.yaml.`));
        } else {
          out.line(pc.dim(`Inferred scope from "${about}": ${inference.matchedEntryPoints.length} entry points, ${inference.matchedComponents.length} components, ${inference.matchedEntities.length} entities.`));
        }
      }
      const generated = await engine.generateDiagram(name, definition);
      if (opts.write === false) {
        out.line(generated.block);
        out.emitJson({ name, definition, block: generated.block, notes: generated.notes });
        return;
      }
      await engine.writeDiagram(generated);
      await engine.markSynced();
      out.line(`${pc.green(generated.existed ? '✓ Updated' : '+ Created')} ${name} ${pc.dim(definition.type)} → ${generated.file.replace(engine.root + '/', '')}`);
      for (const n of generated.notes) if (n.level !== 'info') out.line(`    ${n.level === 'unknown' ? pc.yellow('?') : pc.cyan('≈')} ${n.text}`);
      out.emitJson({ name, definition, file: generated.file, notes: generated.notes, inference: inference?.scope });
    });

  program
    .command('remove <name>')
    .description('Remove a diagram definition and its generated file')
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const removed = await engine.removeDiagram(name);
      if (!removed) throw new UmlflowError(`Diagram "${name}" is not defined`);
      out.line(`Removed ${name}.`);
      out.emitJson({ removed: name });
    });
}

interface GenerateOptions {
  type?: string;
  name?: string;
  about?: string;
  description?: string;
  include?: string[];
  exclude?: string[];
  entry?: string[];
  components?: string[];
  entities?: string[];
  depth?: number;
  write: boolean;
}
