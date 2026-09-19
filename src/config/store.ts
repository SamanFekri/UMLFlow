import path from 'node:path';
import { Document, parseDocument, YAMLMap } from 'yaml';
import { exists, readText, writeText } from '../core/fs.js';
import { NotInitializedError, UmlflowError } from '../core/errors.js';
import { projectPaths, type ProjectPaths } from './paths.js';
import { DEFAULT_CONFIG, normalizeConfig, type DiagramDefinition, type InferredScope, type UmlflowConfig } from './schema.js';

/**
 * Loads and saves `.umlflow/config.yaml` while preserving user comments and
 * formatting. Only targeted fields are ever written back.
 */
export class ConfigStore {
  readonly paths: ProjectPaths;
  private doc: Document.Parsed | Document | null = null;
  private config: UmlflowConfig | null = null;

  constructor(root: string) {
    this.paths = projectPaths(root);
  }

  static async find(startDir: string): Promise<string | null> {
    let dir = path.resolve(startDir);
    for (;;) {
      if (await exists(projectPaths(dir).configFile)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }

  async isInitialized(): Promise<boolean> {
    return exists(this.paths.configFile);
  }

  async load(): Promise<UmlflowConfig> {
    if (this.config) return this.config;
    if (!(await this.isInitialized())) throw new NotInitializedError(this.paths.root);
    const text = await readText(this.paths.configFile);
    const doc = parseDocument(text);
    if (doc.errors.length > 0) {
      throw new UmlflowError(`Config: ${doc.errors[0]!.message}`, {
        hint: `Fix the YAML syntax in ${this.paths.configFile}`,
      });
    }
    this.doc = doc;
    this.config = normalizeConfig(doc.toJS());
    return this.config;
  }

  get(): UmlflowConfig {
    if (!this.config) throw new Error('ConfigStore.load() must be called first');
    return this.config;
  }

  /** Write a full config (used by `init`). */
  async writeInitial(config: UmlflowConfig, header?: string): Promise<void> {
    const doc = new Document(config);
    if (header) doc.commentBefore = header;
    await writeText(this.paths.configFile, doc.toString());
    this.doc = doc;
    this.config = normalizeConfig(doc.toJS());
  }

  private ensureDoc(): Document {
    if (!this.doc) throw new Error('ConfigStore.load() must be called first');
    return this.doc;
  }

  /** Add or replace a diagram definition. Preserves comments elsewhere. */
  async setDiagram(name: string, def: DiagramDefinition): Promise<void> {
    const doc = this.ensureDoc();
    let diagrams = doc.get('diagrams', true);
    if (!(diagrams instanceof YAMLMap)) {
      diagrams = doc.createNode({});
      doc.set('diagrams', diagrams);
    }
    (diagrams as YAMLMap).set(name, doc.createNode(stripUndefined(def)));
    await this.flush();
  }

  async removeDiagram(name: string): Promise<boolean> {
    const doc = this.ensureDoc();
    const diagrams = doc.get('diagrams', true);
    if (!(diagrams instanceof YAMLMap) || !diagrams.has(name)) return false;
    diagrams.delete(name);
    await this.flush();
    return true;
  }

  /** Update only the UMLFlow-owned inferred scope of a diagram. */
  async setInferredScope(name: string, scope: InferredScope): Promise<void> {
    const doc = this.ensureDoc();
    const diagrams = doc.get('diagrams', true);
    if (!(diagrams instanceof YAMLMap)) throw new UmlflowError(`Diagram "${name}" is not defined`);
    const def = diagrams.get(name, true);
    if (!(def instanceof YAMLMap)) throw new UmlflowError(`Diagram "${name}" is not defined`);
    def.set('inferredScope', doc.createNode(stripUndefined(scope)));
    await this.flush();
  }

  private async flush(): Promise<void> {
    const doc = this.ensureDoc();
    await writeText(this.paths.configFile, doc.toString());
    this.config = normalizeConfig(doc.toJS());
  }
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

export { DEFAULT_CONFIG };
