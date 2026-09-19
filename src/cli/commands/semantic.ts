import type { Command } from 'commander';
import pc from 'picocolors';
import { promises as fs } from 'node:fs';
import { UmlflowError } from '../../core/errors.js';
import type { SemanticSource } from '../../model/semantics.js';
import type { ComponentRole, SemanticQuestion } from '../../model/types.js';
import { Umlflow } from '../../sync/pipeline.js';
import { globalOptions, makeOut } from '../index.js';

const ROLES: ComponentRole[] = ['controller', 'service', 'repository', 'gateway', 'handler', 'entity', 'model', 'module', 'utility', 'unknown'];

/**
 * The semantic question/answer protocol. UMLFlow never calls an LLM itself:
 * it lists what it could not determine, and Claude (via the skill) or a
 * person answers with targeted context. Answers are persisted so they are
 * never re-discovered.
 */
export function registerSemantic(program: Command): void {
  const semantic = program.command('semantic').description('Semantic questions UMLFlow cannot answer from code, and their answers');

  semantic
    .command('questions')
    .description('List open semantic questions with compact context (answer them with `semantic answer`)')
    .option('--diagram <name>', 'only questions relevant to one diagram')
    .option('--kind <kind>', 'filter by kind: actor | usecase-name | component-role | flow-name')
    .action(async (opts: { diagram?: string; kind?: string }, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const model = await engine.getModel();
      let questions = model.questions;
      if (opts.kind) questions = questions.filter((q) => q.kind === opts.kind);
      if (opts.diagram) {
        const states = await engine.indexStore.loadDiagramState();
        const ids = new Set(states[opts.diagram]?.modelIds ?? []);
        questions = questions.filter((q) => ids.has(q.subject) || [...ids].some((id) => id.startsWith(q.subject + '.')));
      }
      if (!questions.length) out.line(pc.green('No open semantic questions.'));
      for (const q of questions) printQuestion(out, q);
      if (questions.length) out.line(pc.dim('\nAnswer with: umlflow semantic answer --set <id>=<value> [--set ...]   (or --file answers.json)'));
      out.emitJson(questions);
    });

  semantic
    .command('answer')
    .description('Record answers to semantic questions')
    .option('--set <id=value...>', 'answer by question id, e.g. actor:OrderController=Customer')
    .option('--file <path>', 'JSON file: { "<question id>": "<value>", ... }')
    .option('--as <source>', '"inference" (default; how Claude answers) or "user" (a person\'s declaration)', 'inference')
    .action(async (opts: { set?: string[]; file?: string; as: string }, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const source: SemanticSource = opts.as === 'user' ? 'user' : 'semantic-inference';
      const answers: Record<string, string> = {};
      if (opts.file) Object.assign(answers, JSON.parse(await fs.readFile(opts.file, 'utf8')) as Record<string, string>);
      for (const s of opts.set ?? []) {
        const eq = s.indexOf('=');
        if (eq < 0) throw new UmlflowError(`Invalid --set "${s}"; expected id=value`);
        answers[s.slice(0, eq)] = s.slice(eq + 1);
      }
      if (!Object.keys(answers).length) throw new UmlflowError('No answers given', { hint: 'Use --set <id>=<value> or --file answers.json' });
      const model = await engine.getModel();
      const results: { id: string; status: string }[] = [];
      for (const [id, value] of Object.entries(answers)) {
        const status = await applyAnswer(engine, model.questions, id, value.trim(), source);
        results.push({ id, status });
        out.line(`${status === 'recorded' ? pc.green('✓') : pc.yellow('-')} ${id} ${pc.dim(status)}`);
      }
      out.emitJson(results);
      out.line(pc.dim('Run `umlflow update` to refresh affected diagrams.'));
    });

  semantic
    .command('show')
    .description('Show stored semantic facts (declared and inferred)')
    .action(async (_o: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const data = engine.semanticsStore.get();
      for (const section of ['actors', 'components', 'operations', 'entities'] as const) {
        const entries = Object.entries(data[section]);
        if (!entries.length) continue;
        out.line(pc.bold(section));
        for (const [k, v] of entries) {
          const { source, ...rest } = v as { source: string } & Record<string, unknown>;
          out.line(`  ${k}: ${JSON.stringify(rest)} ${pc.dim(`[${source}]`)}`);
        }
      }
      out.emitJson(data);
    });

  const declare = program.command('declare').description('Declare facts as a person (highest precedence; never overwritten)');

  declare
    .command('actor <name>')
    .description('Declare an actor, optionally as the initiator of components/operations')
    .option('--for <ids...>', 'component or operation ids this actor initiates, e.g. OrderController or OrderController.create')
    .option('--description <text>')
    .action(async (name: string, opts: { for?: string[]; description?: string }, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      await engine.semanticsStore.set('actors', name, opts.description ? { description: opts.description } : {}, 'user');
      for (const id of opts.for ?? []) {
        if (id.includes('.')) await engine.semanticsStore.set('operations', id, { actor: name }, 'user');
        else await engine.semanticsStore.set('components', id, { actor: name }, 'user');
      }
      out.line(`${pc.green('✓')} actor ${name}${opts.for?.length ? ` initiates ${opts.for.join(', ')}` : ''}`);
      out.emitJson({ actor: name, for: opts.for ?? [] });
    });

  declare
    .command('role <component> <role>')
    .description(`Declare a component's architectural role (${ROLES.join(' | ')})`)
    .action(async (component: string, role: string, _opts: unknown, cmd: Command) => {
      if (!ROLES.includes(role as ComponentRole)) throw new UmlflowError(`Invalid role "${role}"`, { hint: `Roles: ${ROLES.join(', ')}` });
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      await engine.semanticsStore.set('components', component, { role }, 'user');
      out.line(`${pc.green('✓')} ${component} is a ${role}`);
      out.emitJson({ component, role });
    });

  declare
    .command('usecase <operation> <name>')
    .description('Name the use case an entry operation provides (e.g. OrderController.create "Place order")')
    .action(async (operation: string, name: string, _opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      await engine.semanticsStore.set('operations', operation, { useCase: name }, 'user');
      out.line(`${pc.green('✓')} ${operation} → "${name}"`);
      out.emitJson({ operation, useCase: name });
    });

  declare
    .command('flow <operation> <name>')
    .description('Name the flow that starts at an entry operation')
    .action(async (operation: string, name: string, _opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      await engine.semanticsStore.set('operations', operation, { flow: name }, 'user');
      out.line(`${pc.green('✓')} flow ${operation} → "${name}"`);
      out.emitJson({ operation, flow: name });
    });

  declare
    .command('ignore <id>')
    .description('Hide a component, entry operation or entity from all diagrams')
    .option('--undo', 'stop ignoring')
    .action(async (id: string, opts: { undo?: boolean }, cmd: Command) => {
      const out = makeOut(cmd);
      const engine = await Umlflow.open(globalOptions(cmd).cwd);
      const model = await engine.getModel();
      const section = model.entities.some((e) => e.id === id || e.name === id) ? 'entities' : id.includes('.') ? 'operations' : 'components';
      if (opts.undo) await engine.semanticsStore.set(section, id, { ignore: false }, 'user');
      else await engine.semanticsStore.set(section, id, { ignore: true }, 'user');
      out.line(`${pc.green('✓')} ${id} ${opts.undo ? 'no longer ignored' : 'ignored'}`);
      out.emitJson({ id, ignore: !opts.undo });
    });
}

function printQuestion(out: ReturnType<typeof makeOut>, q: SemanticQuestion): void {
  out.line(`${pc.bold(q.id)}  ${pc.dim(q.kind)}`);
  out.line(`  ${q.question}`);
  if (q.context?.length) out.line(`  context: ${q.context.join('; ')}`);
  if (q.options?.length) out.line(`  options: ${q.options.join(', ')}`);
  out.line(`  source: ${q.refs.map((r) => `${r.file}${r.line ? ':' + r.line : ''}`).join(', ')}`);
}

async function applyAnswer(engine: Umlflow, questions: SemanticQuestion[], id: string, value: string, source: SemanticSource): Promise<string> {
  if (!value || /^(unknown|skip|\?)$/i.test(value)) return 'skipped (no answer)';
  const [kind, ...rest] = id.split(':');
  const subject = rest.join(':');
  if (!subject) return 'invalid id';
  const known = questions.find((q) => q.id === id);
  const store = engine.semanticsStore;
  let ok = false;
  switch (kind) {
    case 'actor':
      await store.set('actors', value, {}, source);
      ok = subject.includes('.') ? await store.set('operations', subject, { actor: value }, source) : await store.set('components', subject, { actor: value }, source);
      break;
    case 'usecase-name':
      ok = await store.set('operations', subject, { useCase: value }, source);
      break;
    case 'flow-name':
      ok = await store.set('operations', subject, { flow: value }, source);
      break;
    case 'component-role':
      if (!ROLES.includes(value as ComponentRole)) return `invalid role "${value}"`;
      ok = await store.set('components', subject, { role: value }, source);
      break;
    default:
      return `unknown question kind "${kind}"`;
  }
  if (!ok) return 'kept existing user declaration';
  return known ? 'recorded' : 'recorded (no open question with this id; stored anyway)';
}
