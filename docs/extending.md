# Extending UMLFlow

## Adding a language adapter

1. Check whether `@vscode/tree-sitter-wasm` ships the grammar (`ls node_modules/@vscode/tree-sitter-wasm/wasm`).
   If it does, add its name to `GrammarName` in `src/parsers/treesitter/runtime.ts`.
2. Create `src/parsers/adapters/<lang>.ts` implementing `LanguageAdapter`:

```ts
export class RustAdapter implements LanguageAdapter {
  readonly id = 'rust';
  readonly displayName = 'Rust';
  readonly version = 1;            // bump when extraction changes → cached code models are invalidated
  readonly extensions = ['.rs'];
  async parse(ctx: ParseContext): Promise<CodeFile> {
    const file = emptyCodeFile(ctx.path, this.id, ctx.hash, 'ok');
    const tree = await parseWith('rust', ctx.text);
    try {
      // walk tree.rootNode; fill file.imports, file.symbols (with fields/params/calls/annotations), file.routes
      // use ctx.fileExists(rel) to resolve imports to repo-relative paths without touching the file system
    } finally { tree.delete(); }
    return file;
  }
}
```

3. Register it in `createDefaultRegistry()` (`src/parsers/registry.ts`).
4. Add a fixture under `tests/fixtures/repos/` and tests in `tests/unit/parsers.test.ts` plus a golden case.

Rules: only facts, never source text; set `status: 'partial'` when the tree has errors; never invent calls
or types you cannot see. Everything downstream (roles, entry points, entities) keys off annotations, names,
fields and calls in the Code Model, so most frameworks work as soon as those are captured. Framework-specific
knowledge lives in `src/model/classify.ts` (roles, entry points) and `src/model/entities/extract.ts` (ORMs).

## Adding a schema / ORM extractor

Implement `EntityExtractor { id; extract(symbol, file): EntityDecl | null }` in
`src/model/entities/extract.ts` and add it to `DEFAULT_ENTITY_EXTRACTORS`. Declarative formats (like SQL or
Prisma) are adapters that fill `file.entities` directly.

## Adding a diagram type

1. Add IR types in `src/diagrams/ir.ts` (or reuse existing ones).
2. Implement `DiagramGenerator { type; displayName; generate(ctx); isFileRelevant?(file) }` in
   `src/diagrams/generators/`. Return the diagram plus the input `files` and `modelIds` — they drive
   affected-diagram detection.
3. Register in `createDefaultGenerators()`; teach the renderer(s) about the new type.
4. Add `KNOWN_DIAGRAM_TYPES` entry if `init` should offer it.

The System Model already contains what class, component, package and state diagrams need
(`dependencies`, `components`, `entities`, `flows`); a generator is mostly a projection plus overrides.

## Adding a renderer

Implement `Renderer { id; extension; fenceLanguage; commentPrefix; supports(type); render(diagram) }` in
`src/render/<name>/` and register it in `createDefaultRenderers()`. Select it globally (`renderer: plantuml`)
or per diagram (`diagrams.x.renderer`). Output merging uses `commentPrefix` for the in-diagram manual section,
so protected sections work for any text-based diagram language.

## Programmatic use

```ts
import { Umlflow } from 'umlflow';
const engine = await Umlflow.open(process.cwd());
const result = await engine.update();          // { index, diagrams, questions, modelDiff }
const model = await engine.getModel();         // SystemModel
```
