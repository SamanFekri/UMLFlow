import type { Diagram } from '../diagrams/ir.js';
import { UmlflowError } from '../core/errors.js';

/** A renderer turns Diagram IR into text in a concrete diagram language. */
export interface Renderer {
  id: string;
  /** File extension for standalone diagram files (without the dot). */
  extension: string;
  /** Markdown fence language for embedding. */
  fenceLanguage: string;
  /** Comment prefix in the target language (used for managed-section markers). */
  commentPrefix: string;
  supports(type: string): boolean;
  render(diagram: Diagram): string;
}

export class RendererRegistry {
  private readonly renderers = new Map<string, Renderer>();

  register(r: Renderer): this {
    this.renderers.set(r.id, r);
    return this;
  }

  get(id: string): Renderer {
    const r = this.renderers.get(id);
    if (!r) throw new UmlflowError(`Unknown renderer "${id}"`, { hint: `Available: ${[...this.renderers.keys()].join(', ')}` });
    return r;
  }

  list(): Renderer[] {
    return [...this.renderers.values()];
  }
}
