import path from 'node:path';
import type { Annotation, CallSite, CodeFile, CodeImport, CodeSymbol, Field, Param, RouteRegistration } from '../../codemodel/types.js';
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
  typeInfo,
  unquote,
  walk,
  type GrammarName,
  type Node,
} from '../treesitter/runtime.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);
const ROUTER_LIKE = /^(app|router|server|api|fastify|express|r|route|routes|http|koa|hono|v\d+)$/;
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

/**
 * TypeScript / JavaScript adapter (also TSX/JSX). Understands ES modules,
 * CommonJS require, classes with decorators (NestJS/TypeORM/Angular style),
 * constructor injection, arrow-function handlers and Express-style routes.
 */
export class TypeScriptAdapter implements LanguageAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly version = 1;
  readonly extensions: string[];
  private readonly grammarFor: (rel: string) => GrammarName;

  constructor(kind: 'typescript' | 'javascript') {
    if (kind === 'typescript') {
      this.id = 'typescript';
      this.displayName = 'TypeScript';
      this.extensions = ['.ts', '.tsx', '.mts', '.cts'];
      this.grammarFor = (rel) => (rel.endsWith('.tsx') ? 'tsx' : 'typescript');
    } else {
      this.id = 'javascript';
      this.displayName = 'JavaScript';
      this.extensions = ['.js', '.jsx', '.mjs', '.cjs'];
      this.grammarFor = (rel) => (rel.endsWith('.jsx') ? 'tsx' : 'javascript');
    }
  }

  async parse(ctx: ParseContext): Promise<CodeFile> {
    const file = emptyCodeFile(ctx.path, this.id, ctx.hash, 'ok');
    let tree;
    try {
      tree = await parseWith(this.grammarFor(ctx.path), ctx.text);
    } catch (err) {
      file.status = 'failed';
      file.message = (err as Error).message;
      return file;
    }
    try {
      const root = tree.rootNode;
      if (root.hasError) file.status = 'partial';
      for (const node of namedChildren(root)) this.visitTopLevel(node, file, ctx, false);
      file.routes.push(...collectRoutes(root, true));
    } finally {
      tree.delete();
    }
    return file;
  }

  private visitTopLevel(node: Node, file: CodeFile, ctx: ParseContext, exported: boolean, outerDecorators: Annotation[] = []): void {
    switch (node.type) {
      case 'import_statement':
        file.imports.push(parseImport(node, ctx));
        return;
      case 'export_statement': {
        const decorators = childrenOfType(node, 'decorator').map(parseDecorator);
        const decl = field(node, 'declaration') ?? firstChildOfType(node, 'class_declaration', 'abstract_class_declaration', 'function_declaration', 'lexical_declaration', 'variable_declaration', 'interface_declaration', 'enum_declaration', 'type_alias_declaration');
        if (decl) this.visitTopLevel(decl, file, ctx, true, decorators);
        return;
      }
      case 'class_declaration':
      case 'abstract_class_declaration':
        file.symbols.push(...parseClass(node, exported, outerDecorators));
        return;
      case 'interface_declaration':
        file.symbols.push(parseInterface(node, exported));
        return;
      case 'enum_declaration':
        file.symbols.push(simpleSymbol(node, 'enum', exported));
        return;
      case 'type_alias_declaration':
        file.symbols.push(simpleSymbol(node, 'type', exported));
        return;
      case 'function_declaration':
      case 'generator_function_declaration':
        file.symbols.push(parseFunction(node, exported));
        return;
      case 'lexical_declaration':
      case 'variable_declaration':
        for (const decl of childrenOfType(node, 'variable_declarator')) {
          const name = field(decl, 'name');
          const value = field(decl, 'value');
          if (!name || name.type !== 'identifier') continue;
          if (value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function')) {
            file.symbols.push(parseArrowFunction(name.text, decl, value, exported));
          } else if (value && value.type === 'call_expression' && field(value, 'function')?.text === 'require') {
            const arg = namedChildren(field(value, 'arguments')!)[0];
            if (arg && arg.type === 'string') {
              const source = unquote(arg.text);
              file.imports.push({ source, names: [name.text], line: line(node), resolvedFile: resolveRelative(ctx, source) });
            }
          } else {
            const sym = simpleSymbol(decl, 'variable', exported);
            sym.name = name.text;
            sym.id = name.text;
            if (value) {
              sym.calls = collectCalls(value);
              sym.typeRefs = collectTypeRefs(value);
            }
            file.symbols.push(sym);
          }
        }
        return;
      case 'expression_statement': {
        // module.exports = ... / top-level calls are handled by route collection.
        return;
      }
      default:
        return;
    }
  }
}

function parseImport(node: Node, ctx: ParseContext): CodeImport {
  const sourceNode = field(node, 'source');
  const source = sourceNode ? unquote(sourceNode.text) : '';
  const names: string[] = [];
  const aliases: Record<string, string> = {};
  const clause = firstChildOfType(node, 'import_clause');
  if (clause) {
    for (const c of namedChildren(clause)) {
      if (c.type === 'identifier') names.push(c.text);
      else if (c.type === 'namespace_import') {
        const id = firstChildOfType(c, 'identifier');
        if (id) names.push(id.text);
      } else if (c.type === 'named_imports') {
        for (const spec of childrenOfType(c, 'import_specifier')) {
          const orig = field(spec, 'name')?.text;
          const alias = field(spec, 'alias')?.text;
          if (!orig) continue;
          names.push(alias ?? orig);
          if (alias) aliases[alias] = orig;
        }
      }
    }
  }
  const imp: CodeImport = { source, names, line: line(node) };
  if (Object.keys(aliases).length) imp.aliases = aliases;
  const resolved = resolveRelative(ctx, source);
  if (resolved) imp.resolvedFile = resolved;
  return imp;
}

function resolveRelative(ctx: ParseContext, source: string): string | undefined {
  if (!source.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(ctx.path), source));
  const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, '');
  const candidates = [base, ...RESOLVE_EXTS.map((e) => stripped + e), ...RESOLVE_EXTS.map((e) => `${base}/index${e}`)];
  return candidates.find((c) => ctx.fileExists(c));
}

function parseDecorator(node: Node): Annotation {
  const inner = namedChildren(node)[0];
  if (!inner) return { name: node.text.replace(/^@/, ''), args: [], line: line(node) };
  if (inner.type === 'call_expression') {
    const fn = field(inner, 'function');
    const args = field(inner, 'arguments');
    return { name: fn?.text ?? '', args: args ? namedChildren(args).map(literalArg) : [], line: line(node) };
  }
  return { name: inner.text, args: [], line: line(node) };
}

function literalArg(node: Node): string {
  if (node.type === 'string' || node.type === 'template_string') return unquote(node.text);
  return argText(node);
}

function parseClass(node: Node, exported: boolean, outerDecorators: Annotation[]): CodeSymbol[] {
  const name = field(node, 'name')?.text ?? 'AnonymousClass';
  const sym: CodeSymbol = {
    id: name,
    name,
    kind: 'class',
    line: line(node),
    endLine: endLine(node),
    exported,
    annotations: [...outerDecorators, ...childrenOfType(node, 'decorator').map(parseDecorator)],
    fields: [],
    params: [],
    extends: [],
    implements: [],
    calls: [],
    typeRefs: [],
  };
  const heritage = firstChildOfType(node, 'class_heritage');
  if (heritage) {
    for (const ext of childrenOfType(heritage, 'extends_clause')) {
      for (const v of namedChildren(ext)) {
        const t = simplifyType(v.text);
        if (t) sym.extends.push(t);
      }
    }
    for (const impl of childrenOfType(heritage, 'implements_clause')) {
      for (const v of namedChildren(impl)) {
        const t = simplifyType(v.text);
        if (t) sym.implements.push(t);
      }
    }
  }
  const out: CodeSymbol[] = [sym];
  const body = field(node, 'body');
  if (!body) return out;
  // Decorators inside class bodies are siblings preceding the member they decorate.
  let pending: Annotation[] = [];
  for (const member of namedChildren(body)) {
    if (member.type === 'decorator') {
      pending.push(parseDecorator(member));
      continue;
    }
    const memberDecorators = [...pending, ...childrenOfType(member, 'decorator').map(parseDecorator)];
    pending = [];
    if (member.type === 'public_field_definition' || member.type === 'property_definition' || member.type === 'field_definition') {
      const fname = field(member, 'name')?.text;
      if (!fname) continue;
      const f: Field = {
        name: fname,
        annotations: memberDecorators,
        line: line(member),
      };
      const typeNode = field(member, 'type');
      const value = field(member, 'value');
      const typeText = typeNode ? typeNode.text.replace(/^:\s*/, '') : value?.type === 'new_expression' ? field(value, 'constructor')?.text : undefined;
      Object.assign(f, typeInfo(typeText));
      const vis = firstChildOfType(member, 'accessibility_modifier')?.text;
      if (vis === 'private' || vis === 'public' || vis === 'protected') f.visibility = vis;
      sym.fields.push(f);
      if (value) sym.calls.push(...collectCalls(value));
    } else if (member.type === 'method_definition' || member.type === 'method_signature' || member.type === 'abstract_method_signature') {
      const mname = field(member, 'name')?.text;
      if (!mname) continue;
      const params = parseParams(field(member, 'parameters'));
      if (mname === 'constructor') {
        // Parameter properties (`private readonly x: X`) are injected dependencies → fields.
        const paramsNode = field(member, 'parameters');
        if (paramsNode) {
          for (const p of namedChildren(paramsNode)) {
            const hasModifier = firstChildOfType(p, 'accessibility_modifier') !== null || p.text.includes('readonly ');
            const pname = field(p, 'pattern')?.text ?? firstChildOfType(p, 'identifier')?.text;
            const ptypeText = field(p, 'type')?.text.replace(/^:\s*/, '');
            const ptype = simplifyType(ptypeText);
            if (pname && (hasModifier || looksLikeTypeName(ptype))) {
              sym.fields.push({ name: pname, ...typeInfo(ptypeText), annotations: childrenOfType(p, 'decorator').map(parseDecorator), line: line(p) });
            }
          }
        }
        const body = field(member, 'body');
        if (body) {
          // this.x = new Foo() / this.x = foo inside the constructor
          for (const assign of descendants(body, 'assignment_expression')) {
            const left = field(assign, 'left');
            const right = field(assign, 'right');
            if (left?.type === 'member_expression' && field(left, 'object')?.type === 'this' && right) {
              const fname = field(left, 'property')?.text;
              const t = right.type === 'new_expression' ? simplifyType(field(right, 'constructor')?.text) : looksLikeTypeName(right.text) ? right.text : undefined;
              if (fname && !sym.fields.some((f) => f.name === fname)) sym.fields.push({ name: fname, type: t, annotations: [], line: line(assign) });
            }
          }
          sym.calls.push(...collectCalls(body));
        }
        continue;
      }
      const method: CodeSymbol = {
        id: `${name}.${mname}`,
        name: mname,
        kind: 'method',
        parent: name,
        line: line(member),
        endLine: endLine(member),
        exported,
        annotations: memberDecorators,
        fields: [],
        params,
        returnType: simplifyType(field(member, 'return_type')?.text.replace(/^:\s*/, '')),
        extends: [],
        implements: [],
        calls: [],
        flags: {},
      };
      const vis = firstChildOfType(member, 'accessibility_modifier')?.text;
      if (vis) method.flags!.visibility = vis;
      if (member.text.startsWith('static ') || member.children.some((c) => c?.type === 'static')) method.flags!.static = true;
      if (member.children.some((c) => c?.type === 'async')) method.flags!.async = true;
      const body = field(member, 'body');
      if (body) {
        method.calls = collectCalls(body);
        method.typeRefs = collectTypeRefs(body);
        method.routes = collectRoutes(body, false);
      }
      out.push(method);
    }
  }
  return out;
}

function parseInterface(node: Node, exported: boolean): CodeSymbol {
  const sym = simpleSymbol(node, 'interface', exported);
  const body = field(node, 'body');
  if (body) {
    for (const m of namedChildren(body)) {
      if (m.type === 'property_signature') {
        const fname = field(m, 'name')?.text;
        if (fname) sym.fields.push({ name: fname, type: simplifyType(field(m, 'type')?.text.replace(/^:\s*/, '')), annotations: [], line: line(m) });
      } else if (m.type === 'method_signature') {
        const mname = field(m, 'name')?.text;
        if (mname) sym.fields.push({ name: mname + '()', type: simplifyType(field(m, 'return_type')?.text.replace(/^:\s*/, '')), annotations: [], line: line(m) });
      }
    }
  }
  return sym;
}

function simpleSymbol(node: Node, kind: CodeSymbol['kind'], exported: boolean): CodeSymbol {
  const name = field(node, 'name')?.text ?? node.text.slice(0, 30);
  return {
    id: name,
    name,
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

function parseParams(paramsNode: Node | null): Param[] {
  if (!paramsNode) return [];
  const out: Param[] = [];
  for (const p of namedChildren(paramsNode)) {
    const pname = field(p, 'pattern')?.text ?? firstChildOfType(p, 'identifier')?.text ?? p.text;
    out.push({
      name: pname,
      ...typeInfo(field(p, 'type')?.text.replace(/^:\s*/, '')),
      annotations: childrenOfType(p, 'decorator').map(parseDecorator),
    });
  }
  return out;
}

function parseFunction(node: Node, exported: boolean): CodeSymbol {
  const sym = simpleSymbol(node, 'function', exported);
  sym.params = parseParams(field(node, 'parameters'));
  sym.returnType = simplifyType(field(node, 'return_type')?.text.replace(/^:\s*/, ''));
  const body = field(node, 'body');
  if (body) {
    sym.calls = collectCalls(body);
    sym.typeRefs = collectTypeRefs(body);
    sym.routes = collectRoutes(body, false);
  }
  if (node.children.some((c) => c?.type === 'async')) sym.flags = { async: true };
  return sym;
}

function parseArrowFunction(name: string, decl: Node, fn: Node, exported: boolean): CodeSymbol {
  const sym: CodeSymbol = {
    id: name,
    name,
    kind: 'function',
    line: line(decl),
    endLine: endLine(decl),
    exported,
    annotations: [],
    fields: [],
    params: parseParams(field(fn, 'parameters')),
    returnType: simplifyType(field(fn, 'return_type')?.text.replace(/^:\s*/, '')),
    extends: [],
    implements: [],
    calls: [],
  };
  const body = field(fn, 'body');
  if (body) {
    sym.calls = collectCalls(body);
    sym.typeRefs = collectTypeRefs(body);
    sym.routes = collectRoutes(body, false);
  }
  return sym;
}

/** Collect call sites in evaluation order, skipping nested class bodies. */
export function collectCalls(root: Node): CallSite[] {
  const calls: CallSite[] = [];
  walk(root, (n) => {
    if (n.type === 'class_declaration' || n.type === 'class') return false;
    if (n.type !== 'call_expression') return;
    const fn = field(n, 'function');
    if (!fn) return;
    const args = field(n, 'arguments');
    const argCount = args ? namedChildren(args).length : 0;
    const awaited = n.parent?.type === 'await_expression';
    if (fn.type === 'member_expression') {
      const obj = field(fn, 'object');
      const prop = field(fn, 'property');
      if (!prop) return;
      const receiver = obj ? normalizeReceiver(obj) : undefined;
      const site: CallSite = { receiver, name: prop.text, line: line(n), argCount, awaited };
      if (obj && isChained(obj)) site.chained = true;
      calls.push(site);
    } else if (fn.type === 'identifier') {
      if (fn.text === 'require') return;
      calls.push({ name: fn.text, line: line(n), argCount, awaited });
    }
  });
  return calls;
}

function isChained(obj: Node): boolean {
  return obj.type === 'call_expression' || descendants(obj, 'call_expression').length > 0;
}

function normalizeReceiver(obj: Node): string {
  // Collapse calls in receiver chains: this.repo.find().x → "this.repo"
  let node: Node | null = obj;
  while (node && (node.type === 'call_expression' || node.type === 'await_expression' || node.type === 'parenthesized_expression' || node.type === 'non_null_expression')) {
    node = node.type === 'call_expression' ? field(node, 'function') : namedChildren(node)[0] ?? null;
    if (node?.type === 'member_expression') node = field(node, 'object');
  }
  if (!node) return obj.text.replace(/\s+/g, '');
  return node.text.replace(/\s+/g, '').replace(/!/g, '');
}

function collectTypeRefs(root: Node): string[] {
  const refs = new Set<string>();
  walk(root, (n) => {
    if (n.type === 'new_expression') {
      const t = simplifyType(field(n, 'constructor')?.text);
      if (looksLikeTypeName(t)) refs.add(t);
    }
  });
  return [...refs];
}

/** Express/Fastify/Koa style routes: app.get('/path', handler). */
function collectRoutes(root: Node, topLevelOnly: boolean): RouteRegistration[] {
  const routes: RouteRegistration[] = [];
  const consider = (n: Node): void => {
    if (n.type !== 'call_expression') return;
    const fn = field(n, 'function');
    if (!fn || fn.type !== 'member_expression') return;
    const method = field(fn, 'property')?.text ?? '';
    if (!HTTP_METHODS.has(method)) return;
    const obj = field(fn, 'object');
    const objText = obj?.text ?? '';
    const args = field(n, 'arguments');
    const argNodes = args ? namedChildren(args) : [];
    const first = argNodes[0];
    if (!first || (first.type !== 'string' && first.type !== 'template_string')) return;
    const p = unquote(first.text);
    if (!p.startsWith('/') && !ROUTER_LIKE.test(objText)) return;
    const last = argNodes[argNodes.length - 1];
    let handler: string | undefined;
    if (last && last !== first && (last.type === 'identifier' || last.type === 'member_expression')) handler = last.text;
    routes.push({ method: method.toUpperCase(), path: p, handler, line: line(n) });
  };
  if (topLevelOnly) {
    for (const stmt of namedChildren(root)) {
      if (stmt.type === 'expression_statement') {
        const expr = namedChildren(stmt)[0];
        if (expr) consider(expr);
      }
    }
  } else {
    walk(root, (n) => {
      consider(n);
    });
  }
  return routes;
}
