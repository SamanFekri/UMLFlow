import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ensureDir, exists, readTextOrNull, writeText } from '../core/fs.js';
import { UmlflowError } from '../core/errors.js';
import { ConfigStore } from './store.js';
import { DEFAULT_CONFIG, type DiagramType, type HookMode, type UmlflowConfig } from './schema.js';

export interface InitOptions {
  root: string;
  /** Diagram types to create default definitions for. */
  diagramTypes: DiagramType[];
  hookMode?: HookMode;
  force?: boolean;
}

export interface InitResult {
  configFile: string;
  created: string[];
  diagrams: string[];
}

const CONFIG_HEADER = ` UMLFlow project configuration.
 Source code is the source of truth; diagrams under output.dir are generated views.
 Edit diagram definitions/overrides here. UMLFlow only writes "inferredScope" fields.
 Docs: docs/configuration.md`;

/** Default diagram definitions created by `init` for each selected type. */
export function defaultDiagramFor(type: DiagramType): { name: string; description: string } {
  switch (type) {
    case 'usecase':
      return { name: 'system-usecases', description: 'Actors and the capabilities the system exposes to them' };
    case 'sequence':
      return { name: 'main-flows', description: 'Interactions for the main entry points of the system' };
    case 'erd':
      return { name: 'database-erd', description: 'Database entities and their relationships' };
    case 'component':
      return { name: 'architecture', description: 'Components, their dependencies, external systems and datastores' };
    default:
      return { name: `${type}-diagram`, description: `${type} diagram` };
  }
}

export async function initProject(options: InitOptions): Promise<InitResult> {
  const store = new ConfigStore(options.root);
  if ((await store.isInitialized()) && !options.force) {
    throw new UmlflowError(`UMLFlow is already initialized (${store.paths.configFile})`, {
      hint: 'Use --force to overwrite the configuration, or edit .umlflow/config.yaml directly.',
    });
  }
  const created: string[] = [];
  const config: UmlflowConfig = structuredClone(DEFAULT_CONFIG);
  if (options.hookMode) config.git.hooks['pre-commit'] = options.hookMode;
  const diagrams: string[] = [];
  for (const type of options.diagramTypes) {
    const { name, description } = defaultDiagramFor(type);
    config.diagrams[name] = { type, description };
    diagrams.push(name);
  }

  await ensureDir(store.paths.umlflowDir);
  await store.writeInitial(config, CONFIG_HEADER);
  created.push(path.relative(options.root, store.paths.configFile));

  if (!(await exists(store.paths.semanticsFile))) {
    await writeText(
      store.paths.semanticsFile,
      `# UMLFlow semantic facts.\n# Entries with source "user" were declared by people and are never overwritten.\n# Entries with source "semantic-inference" were established once (e.g. by Claude) and are reused.\nversion: 1\ncomponents: {}\nactors: {}\noperations: {}\n`,
    );
    created.push(path.relative(options.root, store.paths.semanticsFile));
  }

  await ensureDir(path.join(options.root, config.output.dir));
  await ensureDir(store.paths.cacheDir);

  const gitignore = path.join(store.paths.umlflowDir, '.gitignore');
  if (!(await exists(gitignore))) {
    await writeText(gitignore, '# UMLFlow local cache is disposable and machine-specific.\ncache/\n');
    created.push(path.relative(options.root, gitignore));
  }
  // Keep the diagrams dir even when empty so the layout is visible in git.
  const keep = path.join(options.root, config.output.dir, '.gitkeep');
  if (!(await exists(keep)) && (await readTextOrNull(keep)) === null) {
    await fs.writeFile(keep, '');
  }
  return { configFile: store.paths.configFile, created, diagrams };
}
