import { GeneratorRegistry } from './generator.js';
import { UseCaseGenerator } from './generators/usecase.js';
import { SequenceGenerator } from './generators/sequence.js';
import { ErdGenerator } from './generators/erd.js';
import { RendererRegistry } from '../render/renderer.js';
import { MermaidRenderer } from '../render/mermaid/index.js';

export function createDefaultGenerators(): GeneratorRegistry {
  return new GeneratorRegistry().register(new UseCaseGenerator()).register(new SequenceGenerator()).register(new ErdGenerator());
}

export function createDefaultRenderers(): RendererRegistry {
  return new RendererRegistry().register(new MermaidRenderer());
}
