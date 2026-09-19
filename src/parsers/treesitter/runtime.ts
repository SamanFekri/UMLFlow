import { createRequire } from 'node:module';
import path from 'node:path';
import type { Language, Node, Parser as ParserType, Tree } from '@vscode/tree-sitter-wasm';

/**
 * Lazily initialised web-tree-sitter runtime. Grammars are loaded on first
 * use and cached for the process lifetime.
 */
const require = createRequire(import.meta.url);

type TreeSitterModule = typeof import('@vscode/tree-sitter-wasm');

let modulePromise: Promise<TreeSitterModule> | null = null;
const languages = new Map<string, Promise<Language>>();

function wasmDir(): string {
  return path.dirname(require.resolve('@vscode/tree-sitter-wasm'));
}

async function loadModule(): Promise<TreeSitterModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = require('@vscode/tree-sitter-wasm') as TreeSitterModule;
      await mod.Parser.init({
        locateFile: (file: string) => path.join(wasmDir(), file),
      });
      return mod;
    })();
  }
  return modulePromise;
}

/** Grammar names as shipped by @vscode/tree-sitter-wasm. */
export type GrammarName =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'python'
  | 'java'
  | 'go'
  | 'rust'
  | 'ruby'
  | 'php'
  | 'c-sharp'
  | 'cpp';

export async function loadGrammar(name: GrammarName): Promise<Language> {
  let p = languages.get(name);
  if (!p) {
    p = (async () => {
      const mod = await loadModule();
      return mod.Language.load(path.join(wasmDir(), `tree-sitter-${name}.wasm`));
    })();
    languages.set(name, p);
  }
  return p;
}

export async function parseWith(name: GrammarName, text: string): Promise<Tree> {
  const mod = await loadModule();
  const lang = await loadGrammar(name);
  const parser: ParserType = new mod.Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(text);
  parser.delete();
  if (!tree) throw new Error(`tree-sitter failed to parse with grammar ${name}`);
  return tree;
}

export type { Node, Tree };

/* ---------- Small AST helpers shared by adapters ---------- */

export function namedChildren(node: Node): Node[] {
  return node.namedChildren.filter((c): c is Node => c !== null);
}

export function childrenOfType(node: Node, ...types: string[]): Node[] {
  return namedChildren(node).filter((c) => types.includes(c.type));
}

export function firstChildOfType(node: Node, ...types: string[]): Node | null {
  return namedChildren(node).find((c) => types.includes(c.type)) ?? null;
}

export function field(node: Node, name: string): Node | null {
  return node.childForFieldName(name);
}

export function fieldText(node: Node, name: string): string | undefined {
  return node.childForFieldName(name)?.text;
}

/** Walk descendants depth-first; return false from visit to skip a subtree. */
export function walk(node: Node, visit: (n: Node) => boolean | void): void {
  const stack: Node[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    const res = visit(n);
    if (res === false) continue;
    const kids = namedChildren(n);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
}

export function descendants(node: Node, ...types: string[]): Node[] {
  return node.descendantsOfType(types).filter((n): n is Node => n !== null);
}

export function line(node: Node): number {
  return node.startPosition.row + 1;
}

export function endLine(node: Node): number {
  return node.endPosition.row + 1;
}

/** Strip quotes from a string literal token. */
export function unquote(text: string): string {
  const t = text.trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' || a === "'" || a === '`') && a === b) return t.slice(1, -1);
  }
  return t;
}

/** Strip generics/array/optional markers from a type expression: "Promise<Foo[]>" → "Foo". */
export function simplifyType(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let t = text.trim();
  const wrappers =
    /^(?:Promise|Observable|Optional|List|Set|Array|Mono|Flux|ReadonlyArray|Partial|Readonly|Awaited|Future|CompletableFuture|Iterable|Collection|ArrayList|HashSet|Map|HashMap|Record|Dict|Sequence|Uni|Multi)\s*<(.*)>$/s;
  for (let i = 0; i < 3; i++) {
    const m = t.match(wrappers);
    if (!m) break;
    t = m[1]!.trim();
  }
  t = t.replace(/\[\]$/, '').replace(/^\*+/, '').replace(/^&/, '').replace(/\?$/, '');
  t = t.replace(/<.*$/s, '').trim();
  const seg = t.split(/[.:]/).filter(Boolean);
  const last = seg.length ? seg[seg.length - 1]! : t;
  return last.length ? last : undefined;
}

/** Simplified generic type arguments of a type expression: "Repository<Order, Long>" → ["Order", "Long"]. */
export function typeArguments(text: string | undefined): string[] | undefined {
  if (!text) return undefined;
  const t = text.trim();
  const open = t.indexOf('<');
  if (open < 0 || !t.endsWith('>')) return undefined;
  const inner = t.slice(open + 1, -1);
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '<') depth++;
    if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  const out = parts.map((p) => simplifyType(p)).filter((p): p is string => !!p);
  return out.length ? out : undefined;
}

/** Type name + generic arguments for a declared type expression. */
export function typeInfo(text: string | undefined): { type?: string; typeArgs?: string[] } {
  const info: { type?: string; typeArgs?: string[] } = { type: simplifyType(text) };
  const args = typeArguments(text);
  if (args) info.typeArgs = args;
  return info;
}

/** Truncate long non-literal argument text. */
export function argText(node: Node, max = 80): string {
  const t = node.text.replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** True when a type-like name looks like a user-defined type (PascalCase identifier). */
export function looksLikeTypeName(name: string | undefined): name is string {
  return !!name && /^[A-Z][A-Za-z0-9_]*$/.test(name);
}
