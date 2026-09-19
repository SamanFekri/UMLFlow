import { Command, Option } from 'commander';
import pc from 'picocolors';
import { createRequire } from 'node:module';
import { UmlflowError } from '../core/errors.js';
import { Out } from './output.js';
import { registerInit } from './commands/init.js';
import { registerGenerate } from './commands/generate.js';
import { registerSync } from './commands/sync.js';
import { registerHooks } from './commands/hooks.js';
import { registerSemantic } from './commands/semantic.js';
import { registerSkill } from './commands/skill.js';

const require = createRequire(import.meta.url);

export function version(): string {
  try {
    return (require('../../package.json') as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

export interface GlobalOptions {
  json: boolean;
  cwd: string;
  quiet: boolean;
}

export function globalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.optsWithGlobals() as { json?: boolean; cwd?: string; quiet?: boolean };
  return { json: !!opts.json, cwd: opts.cwd ?? process.cwd(), quiet: !!opts.quiet };
}

export function makeOut(cmd: Command): Out {
  const g = globalOptions(cmd);
  return new Out(g.json, g.quiet);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('umlflow')
    .description(
      'Language-agnostic code understanding and incremental UML (Mermaid) synchronization.\n' +
        'The source code is the source of truth; diagrams are generated views of a cached System Model.',
    )
    .version(version())
    .addOption(new Option('--json', 'machine-readable JSON output'))
    .addOption(new Option('--cwd <dir>', 'run as if started in <dir>'))
    .addOption(new Option('-q, --quiet', 'suppress non-essential output'))
    .showHelpAfterError()
    .configureHelp({ sortSubcommands: true });

  registerInit(program);
  registerGenerate(program);
  registerSync(program);
  registerHooks(program);
  registerSemantic(program);
  registerSkill(program);
  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err && typeof err === 'object' && 'exitCode' in err && typeof (err as { exitCode: unknown }).exitCode === 'number') {
      // commander handled help/version/usage errors
      process.exitCode = (err as { exitCode: number }).exitCode;
      return;
    }
    if (err instanceof UmlflowError) {
      console.error(pc.red(`error: ${err.message}`));
      if (err.hint) console.error(pc.dim(`hint: ${err.hint}`));
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}
