import path from 'node:path';
import type { Annotation, CallSite, CodeFile, CodeImport, CodeSymbol, Field, Param } from '../../codemodel/types.js';
import { emptyCodeFile } from '../../codemodel/types.js';
import type { LanguageAdapter, ParseContext } from '../adapter.js';
import {
  argText,
  childrenOfType,
  descendants,
  endLine,
  field,
  firstChildOfType,
  line,
  looksLikeTypeName,
  namedChildren,
  parseWith,
  simplifyType,
  unquote,
  walk,
  type Node,
} from '../treesitter/runtime.js';

/**
 * Python adapter. Understands modules, classes (incl. Django/SQLAlchemy
 * models via class-level assignments), decorators (Flask/FastAPI/Django
 * routes), `__init__` injection and `self.x` attribute assignment.
 */
export class PythonAdapter implements LanguageAdapter {
  readonly id = 'python';
  readonly displayName = 'Python';
  readonly version = 1;
  readonly extensions = ['.py'];

  async parse(ctx: ParseContext): Promise<CodeFile> {
    const file = emptyCodeFile(ctx.path, this.id, ctx.hash, 'ok');
    let tree;
    try {
      tree = await parseWith('python', ctx.text);
    } catch (err) {
      file.status = 'failed';
      file.message = (err as Error).message;
      return file;
    }
    try {
      const root = tree.rootNode;
      if (root.hasError) file.status = 'partial';
      file.module = ctx.path.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/').join('.');
      for (const node of namedChildren(root)) visitTopLevel(node, file, ctx, []);
    } finally {
      tree.delete();
    }
    return file;
  }
}

function visitTopLevel(node: Node, file: CodeFile, ctx: ParseContext, decorators: Annotation[]): void {
  switch (node.type) {
    case 'import_statement':
      for (const n of namedChildren(node)) {
        if (n.type === 'dotted_name') file.imports.push(withResolution(ctx, { source: n.text, names: [n.text.split('.').pop()!], line: line(node) }));
        else if (n.type === 'aliased_import') {
          const name = field(n, 'name')?.text ?? '';
          const alias = field(n, 'alias')?.text ?? name;
          file.imports.push(withResolution(ctx, { source: name, names: [alias], aliases: { [alias]: name }, line: line(node) }));
        }
      }
      return;
    case 'import_from_statement': {
      const moduleNode = field(node, 'module_name');
      const source = moduleNode?.text ?? '';
      const names: string[] = [];
      const aliases: Record<string, string> = {};
      for (const n of namedChildren(node)) {
        if (n === moduleNode) continue;
        if (n.type === 'dotted_name') names.push(n.text);
        else if (n.type === 'aliased_import') {
          const name = field(n, 'name')?.text ?? '';
          const alias = field(n, 'alias')?.text ?? name;
          names.push(alias);
          aliases[alias] = name;
        } else if (n.type === 'wildcard_import') names.push('*');
      }
      const imp: CodeImport = { source, names, line: line(node) };
      if (Object.keys(aliases).length) imp.aliases = aliases;
      file.imports.push(withResolution(ctx, imp));
      return;
    }
    case 'decorated_definition': {
      const decs = childrenOfType(node, 'decorator').map(parseDecorator);
      const def = field(node, 'definition') ?? firstChildOfType(node, 'class_definition', 'function_definition');
      if (def) visitTopLevel(def, file, ctx, decs);
      return;
    }
    case 'class_definition':
      file.symbols.push(...parseClass(node, decorators));
      return;
    case 'function_definition':
      file.symbols.push(parseFunction(node, undefined, decorators));
      return;
    case 'expression_statement': {
      const assign = namedChildren(node)[0];
      if (assign?.type === 'assignment') {
        const left = field(assign, 'left');
        const right = field(assign, 'right');
        if (left?.type === 'identifier' && right) {
          const sym = baseSymbol(left.text, 'variable', assign, !left.text.startsWith('_'));
          sym.calls = collectCalls(right);
          sym.typeRefs = right.type === 'call' ? [field(right, 'function')?.text ?? ''].filter(looksLikeTypeName) : [];
          file.symbols.push(sym);
        }
      }
      return;
    }
    default:
      return;
  }
}

function withResolution(ctx: ParseContext, imp: CodeImport): CodeImport {
  const resolved = resolveModule(ctx, imp.source);
  if (resolved) imp.resolvedFile = resolved;
  return imp;
}

function resolveModule(ctx: ParseContext, source: string): string | undefined {
  if (!source) return undefined;
  let base: string;
  const rel = source.match(/^(\.+)(.*)$/);
  if (rel) {
    let dir = path.posix.dirname(ctx.path);
    for (let i = 1; i < rel[1]!.length; i++) dir = path.posix.dirname(dir);
    base = rel[2] ? path.posix.join(dir, rel[2].split('.').join('/')) : dir;
  } else {
    base = source.split('.').join('/');
  }
  const candidates = [`${base}.py`, `${base}/__init__.py`];
  // Also try common source roots.
  for (const root of ['src', 'app', 'lib']) candidates.push(`${root}/${base}.py`, `${root}/${base}/__init__.py`);
  return candidates.find((c) => ctx.fileExists(c));
}

function parseDecorator(node: Node): Annotation {
  const inner = namedChildren(node)[0];
  if (!inner) return { name: node.text.replace(/^@/, ''), args: [], line: line(node) };
  if (inner.type === 'call') {
    const fn = field(inner, 'function');
    const args = field(inner, 'arguments');
    const ann: Annotation = { name: fn?.text ?? '', args: [], line: line(node) };
    if (args) {
      for (const a of namedChildren(args)) {
        if (a.type === 'keyword_argument') {
          ann.named ??= {};
          ann.named[field(a, 'name')?.text ?? ''] = literalArg(field(a, 'value'));
        } else ann.args.push(literalArg(a));
      }
    }
    return ann;
  }
  return { name: inner.text, args: [], line: line(node) };
}

function literalArg(node: Node | null): string {
  if (!node) return '';
  if (node.type === 'string') return unquote(node.text);
  return argText(node);
}

function parseClass(node: Node, decorators: Annotation[]): CodeSymbol[] {
  const name = field(node, 'name')?.text ?? 'AnonymousClass';
  const sym = baseSymbol(name, 'class', node, !name.startsWith('_'));
  sym.annotations = decorators;
  const supers = field(node, 'superclasses');
  if (supers) {
    for (const s of namedChildren(supers)) {
      if (s.type === 'keyword_argument') continue;
      const t = simplifyType(s.text);
      if (t) sym.extends.push(t);
    }
  }
  const out: CodeSymbol[] = [sym];
  const body = field(node, 'body');
  if (!body) return out;
  for (const stmt of namedChildren(body)) {
    let member = stmt;
    let memberDecorators: Annotation[] = [];
    if (stmt.type === 'decorated_definition') {
      memberDecorators = childrenOfType(stmt, 'decorator').map(parseDecorator);
      member = field(stmt, 'definition') ?? firstChildOfType(stmt, 'function_definition', 'class_definition') ?? stmt;
    }
    if (member.type === 'function_definition') {
      const method = parseFunction(member, name, memberDecorators);
      if (method.name === '__init__') {
        // Typed params and self.x assignments → fields (dependency injection).
        for (const p of method.params) {
          if (p.name !== 'self' && looksLikeTypeName(p.type)) sym.fields.push({ name: p.name, type: p.type, annotations: [], line: member.startPosition.row + 1 });
        }
        const fbody = field(member, 'body');
        if (fbody) {
          walk(fbody, (n) => {
            if (n.type !== 'assignment') return;
            const left = field(n, 'left');
            const right = field(n, 'right');
            if (left?.type === 'attribute' && field(left, 'object')?.text === 'self' && right) {
              const fname = field(left, 'attribute')?.text;
              if (!fname || sym.fields.some((f) => f.name === fname)) return;
              let t: string | undefined;
              if (right.type === 'call') t = simplifyType(field(right, 'function')?.text);
              else if (right.type === 'identifier') {
                const p = method.params.find((pp) => pp.name === right.text);
                t = p?.type;
              }
              sym.fields.push({ name: fname, type: looksLikeTypeName(t) ? t : undefined, annotations: [], line: line(n) });
            }
          });
        }
        sym.calls.push(...method.calls);
        continue;
      }
      out.push(method);
    } else if (member.type === 'expression_statement') {
      const assign = namedChildren(member)[0];
      if (assign?.type === 'assignment') {
        const left = field(assign, 'left');
        const right = field(assign, 'right');
        const typeNode = field(assign, 'type');
        if (left?.type === 'identifier') {
          const f: Field = { name: left.text, annotations: [], line: line(assign) };
          if (typeNode) f.type = simplifyType(typeNode.text);
          if (right?.type === 'call') {
            // ORM column definitions: name = models.CharField(...) / Column(Integer, ForeignKey("x.id"))
            const fn = field(right, 'function')?.text ?? '';
            const ann: Annotation = { name: fn, args: [], line: line(assign) };
            const args = field(right, 'arguments');
            if (args) {
              for (const a of namedChildren(args)) {
                if (a.type === 'keyword_argument') {
                  ann.named ??= {};
                  ann.named[field(a, 'name')?.text ?? ''] = literalArg(field(a, 'value'));
                } else ann.args.push(a.type === 'call' ? a.text.replace(/\s+/g, '') : literalArg(a));
              }
            }
            f.annotations.push(ann);
            if (!f.type) f.type = simplifyType(fn);
          } else if (right?.type === 'string') {
            f.annotations.push({ name: 'literal', args: [unquote(right.text)], line: line(assign) });
          }
          sym.fields.push(f);
        }
      }
    } else if (member.type === 'class_definition') {
      // Nested Meta class (Django): capture db_table.
      const nested = parseClass(member, []);
      const meta = nested[0]!;
      if (meta.name === 'Meta') {
        for (const f of meta.fields) {
          if (f.name === 'db_table') {
            const ann = f.annotations[0];
            sym.annotations.push({ name: 'Meta.db_table', args: [ann?.args[0] ?? ''], line: f.line });
          }
        }
        // Store the literal value from a plain assignment.
        const bodyNode = field(member, 'body');
        if (bodyNode) {
          for (const st of childrenOfType(bodyNode, 'expression_statement')) {
            const a = namedChildren(st)[0];
            if (a?.type === 'assignment' && field(a, 'left')?.text === 'db_table') {
              const r = field(a, 'right');
              if (r?.type === 'string') sym.annotations.push({ name: 'Meta.db_table', args: [unquote(r.text)], line: line(a) });
            }
          }
        }
      }
    }
  }
  return out;
}

function parseFunction(node: Node, parent: string | undefined, decorators: Annotation[]): CodeSymbol {
  const name = field(node, 'name')?.text ?? 'anonymous';
  const sym = baseSymbol(parent ? `${parent}.${name}` : name, parent ? 'method' : 'function', node, !name.startsWith('_') || name === '__init__');
  sym.name = name;
  sym.parent = parent;
  sym.annotations = decorators;
  sym.params = parseParams(field(node, 'parameters'));
  sym.returnType = simplifyType(field(node, 'return_type')?.text);
  const body = field(node, 'body');
  if (body) {
    sym.calls = collectCalls(body);
    sym.typeRefs = collectTypeRefs(body);
  }
  if (node.children.some((c) => c?.type === 'async')) sym.flags = { async: true };
  return sym;
}

function parseParams(params: Node | null): Param[] {
  if (!params) return [];
  const out: Param[] = [];
  for (const p of namedChildren(params)) {
    if (p.type === 'identifier') out.push({ name: p.text, annotations: [] });
    else if (p.type === 'typed_parameter' || p.type === 'typed_default_parameter' || p.type === 'default_parameter') {
      const nameNode = field(p, 'name') ?? firstChildOfType(p, 'identifier');
      out.push({ name: nameNode?.text ?? p.text, type: simplifyType(field(p, 'type')?.text), annotations: [] });
    } else if (p.type === 'list_splat_pattern' || p.type === 'dictionary_splat_pattern') {
      out.push({ name: p.text, annotations: [] });
    }
  }
  return out;
}

function baseSymbol(id: string, kind: CodeSymbol['kind'], node: Node, exported: boolean): CodeSymbol {
  return {
    id,
    name: id.includes('.') ? id.split('.').pop()! : id,
    kind,
    line: line(node),
    endLine: endLine(node),
    exported,
    annotations: [],
    fields: [],
    params: [],
    extends: [],
    implements: [],
    calls: [],
  };
}

export function collectCalls(root: Node): CallSite[] {
  const calls: CallSite[] = [];
  walk(root, (n) => {
    if (n.type === 'class_definition') return false;
    if (n.type !== 'call') return;
    const fn = field(n, 'function');
    if (!fn) return;
    const args = field(n, 'arguments');
    const argCount = args ? namedChildren(args).length : 0;
    const awaited = n.parent?.type === 'await';
    if (fn.type === 'attribute') {
      const obj = field(fn, 'object');
      const attr = field(fn, 'attribute');
      if (!attr) return;
      const site: CallSite = { receiver: obj ? normalizeReceiver(obj) : undefined, name: attr.text, line: line(n), argCount, awaited };
      if (obj && isChained(obj)) site.chained = true;
      calls.push(site);
    } else if (fn.type === 'identifier') {
      calls.push({ name: fn.text, line: line(n), argCount, awaited });
    }
  });
  return calls;
}

function isChained(obj: Node): boolean {
  return obj.type === 'call' || descendants(obj, 'call').length > 0;
}

function normalizeReceiver(obj: Node): string {
  let node: Node | null = obj;
  while (node && (node.type === 'call' || node.type === 'await' || node.type === 'parenthesized_expression' || node.type === 'subscript')) {
    if (node.type === 'call') {
      node = field(node, 'function');
      if (node?.type === 'attribute') node = field(node, 'object');
    } else if (node.type === 'subscript') node = field(node, 'value');
    else node = namedChildren(node)[0] ?? null;
  }
  return (node ?? obj).text.replace(/\s+/g, '');
}

function collectTypeRefs(root: Node): string[] {
  const refs = new Set<string>();
  walk(root, (n) => {
    if (n.type === 'call') {
      const fn = field(n, 'function');
      const t = fn?.type === 'identifier' ? fn.text : fn?.type === 'attribute' ? field(fn, 'attribute')?.text : undefined;
      if (looksLikeTypeName(t)) refs.add(t);
    }
  });
  return [...refs];
}
