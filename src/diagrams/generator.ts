import type { DiagramDefinition } from '../config/schema.js';
import type { SemanticsData } from '../model/semantics.js';
import type { ModelIndex, SystemModel } from '../model/types.js';
import type { Diagram } from './ir.js';
import type { ResolvedScope } from './scope.js';
import { UmlflowError } from '../core/errors.js';
import type { CodeFile } from '../codemodel/types.js';

export interface GenerateContext {
  name: string;
  definition: DiagramDefinition;
  model: SystemModel;
  index: ModelIndex;
  scope: ResolvedScope;
  semantics: SemanticsData;
}

export interface GenerateResult {
  diagram: Diagram;
  /** Repo-relative files whose facts contributed (used for affected-diagram detection). */
  files: string[];
  /** System Model ids that contributed (components, entities, operations). */
  modelIds: string[];
}

export interface DiagramGenerator {
  type: string;
  displayName: string;
  generate(ctx: GenerateContext): GenerateResult;
  /**
   * Can facts in this newly added file influence a broadly scoped diagram of this
   * type? Used to avoid regenerating unrelated diagrams. Default: yes.
   */
  isFileRelevant?(file: CodeFile): boolean;
}

export class GeneratorRegistry {
  private readonly generators = new Map<string, DiagramGenerator>();

  register(g: DiagramGenerator): this {
    this.generators.set(g.type, g);
    return this;
  }

  get(type: string): DiagramGenerator {
    const g = this.generators.get(type);
    if (!g) throw new UmlflowError(`Unknown diagram type "${type}"`, { hint: `Available types: ${this.types().join(', ')}` });
    return g;
  }

  has(type: string): boolean {
    return this.generators.has(type);
  }

  types(): string[] {
    return [...this.generators.keys()];
  }
}
