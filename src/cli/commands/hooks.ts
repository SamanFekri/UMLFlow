import type { Command } from 'commander';
import pc from 'picocolors';
import { Git } from '../../change/git.js';
import { HOOK_MODES, SUPPORTED_HOOKS, type HookMode } from '../../config/schema.js';
import { UmlflowError } from '../../core/errors.js';
import { hookStatus, installHook, uninstallHook } from '../../hooks/install.js';
import { Umlflow } from '../../sync/pipeline.js';
import { ConfigStore } from '../../config/store.js';
import { globalOptions, makeOut } from '../index.js';

export function registerHooks(program: Command): void {
  program
    .command('install-hooks')
    .description('Install UMLFlow git hooks (managed section; existing hook logic is preserved)')
    .option('--hooks <names>', `comma-separated hooks (${SUPPORTED_HOOKS.join(', ')})`, 'pre-commit')
    .option('--mode <mode>', `set the mode for these hooks in config (${HOOK_MODES.join(', ')})`)
    .action(async (opts: { hooks: string; mode?: string }, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      const engine = await Umlflow.open(g.cwd);
      const hooks = opts.hooks.split(',').map((h) => h.trim()).filter(Boolean);
      if (opts.mode) {
        if (!HOOK_MODES.includes(opts.mode as HookMode)) throw new UmlflowError(`Invalid mode "${opts.mode}"`, { hint: `Modes: ${HOOK_MODES.join(', ')}` });
        await setHookModes(engine.configStore, hooks, opts.mode as HookMode);
      }
      const config = await new ConfigStore(engine.root).load();
      const results = [];
      for (const hook of hooks) {
        const r = await installHook(engine.root, hook, { recordedBin: currentBinary() });
        results.push({ ...r, mode: config.git.hooks[hook] ?? 'off' });
        out.line(`${pc.green('✓')} ${hook}: ${r.status} ${pc.dim(`(mode: ${config.git.hooks[hook] ?? 'off (set git.hooks.' + hook + ' in config)'})`)}`);
      }
      out.emitJson(results);
    });

  program
    .command('uninstall-hooks')
    .description('Remove UMLFlow managed sections from git hooks')
    .option('--hooks <names>', 'comma-separated hooks', SUPPORTED_HOOKS.join(','))
    .action(async (opts: { hooks: string }, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      const root = (await ConfigStore.find(g.cwd)) ?? g.cwd;
      const results = [];
      for (const hook of opts.hooks.split(',').map((h) => h.trim()).filter(Boolean)) {
        const r = await uninstallHook(root, hook);
        results.push(r);
        if (r.status !== 'absent') out.line(`${pc.green('✓')} ${hook}: ${r.status}`);
      }
      if (results.every((r) => r.status === 'absent')) out.line(pc.dim('No UMLFlow hooks were installed.'));
      out.emitJson(results);
    });

  program
    .command('hook <name>', { hidden: true })
    .description('Run the configured behaviour for a git hook (called by the installed hook)')
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      const root = await ConfigStore.find(g.cwd);
      if (!root) return; // not initialised: hooks stay silent
      const engine = await Umlflow.open(root);
      const mode = engine.getConfig().git.hooks[name] ?? 'off';
      if (mode === 'off') return;
      if (mode === 'check') {
        const result = await engine.check();
        if (result.stale) {
          out.error(pc.yellow(`umlflow: diagrams are out of date (${result.diagrams.filter((d) => d.status !== 'fresh').map((d) => d.name).join(', ')}).`));
          out.error(pc.dim('Run `umlflow update` and stage the diagrams, or set git.hooks.' + name + ' to "update" or "off".'));
          process.exitCode = 1;
        }
        return;
      }
      const result = await engine.update();
      const written = result.diagrams.filter((d) => d.status === 'updated' || d.status === 'created');
      if (written.length && name === 'pre-commit') {
        await new Git(engine.root).add(written.map((d) => d.file));
      }
      if (written.length) out.error(pc.dim(`umlflow: updated ${written.map((d) => d.name).join(', ')}${name === 'pre-commit' ? ' (staged)' : ''}`));
    });

  program
    .command('hook-status', { hidden: true })
    .action(async (_o: unknown, cmd: Command) => {
      const out = makeOut(cmd);
      const g = globalOptions(cmd);
      const root = (await ConfigStore.find(g.cwd)) ?? g.cwd;
      const result: Record<string, string> = {};
      for (const h of SUPPORTED_HOOKS) result[h] = await hookStatus(root, h);
      out.line(JSON.stringify(result));
      out.emitJson(result);
    });
}

/** Absolute path of the running umlflow binary, recorded in hooks as a PATH-independent fallback. */
function currentBinary(): string | undefined {
  const bin = process.argv[1];
  return bin && /umlflow/.test(bin) ? bin : undefined;
}

async function setHookModes(store: ConfigStore, hooks: string[], mode: HookMode): Promise<void> {
  const { parseDocument } = await import('yaml');
  const { readText, writeText } = await import('../../core/fs.js');
  const text = await readText(store.paths.configFile);
  const doc = parseDocument(text);
  for (const hook of hooks) doc.setIn(['git', 'hooks', hook], mode);
  await writeText(store.paths.configFile, doc.toString());
}
