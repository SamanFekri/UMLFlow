import path from 'node:path';
import type { Annotation, CallSite, CodeFile, CodeImport, CodeSymbol, Field, Param, RouteRegistration, MountRegistration } from '../../codemodel/types.js';
import { matchEntryVerb, REGISTRAR_LIKE, type PatternMatch } from '../entrypatterns.js';
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
      resetRegistrations();
      for (const node of namedChildren(root)) this.visitTopLevel(node, file, ctx, false);
      const top = collectRegistrations(root, true, regCtx);
      file.routes.push(...top.registrations);
      if (top.mounts.length) file.mounts = [...(file.mounts ?? []), ...top.mounts];
      file.symbols.push(...top.handlers);
      // Handlers lifted out of nested function/method bodies during the walk.
      file.symbols.push(...pendingHandlers.splice(0));
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
        const reg = collectRegistrations(body, false, regCtx);
        method.calls = callsOutside(body, reg.handlerRanges);
        method.typeRefs = collectTypeRefs(body);
        method.routes = reg.registrations;
        if (reg.mounts.length) method.mounts = reg.mounts;
        pendingHandlers.push(...reg.handlers);
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
    const reg = collectRegistrations(body, false, regCtx);
    sym.calls = callsOutside(body, reg.handlerRanges);
    sym.typeRefs = collectTypeRefs(body);
    sym.routes = reg.registrations;
    if (reg.mounts.length) sym.mounts = reg.mounts;
    pendingHandlers.push(...reg.handlers);
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
    const reg = collectRegistrations(body, false, regCtx);
    sym.calls = callsOutside(body, reg.handlerRanges);
    sym.typeRefs = collectTypeRefs(body);
    sym.routes = reg.registrations;
    if (reg.mounts.length) sym.mounts = reg.mounts;
    pendingHandlers.push(...reg.handlers);
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

/**
 * Handler registrations of the shape `<receiver>.<verb>(<name>, <handler>)`.
 *
 * Covers HTTP routes, event subscriptions, queue consumers, scheduled jobs and
 * commands through the shared pattern table in `entrypatterns.ts`, so a new
 * framework is a new verb rather than a new branch here.
 *
 * When the handler is written inline (`app.get('/x', async (req, res) => {…})`,
 * by far the most common style) the arrow body is lifted into its own synthetic
 * symbol. Without that, the handler's calls are attributed to the enclosing
 * setup function and no per-route flow can be reconstructed.
 */
function collectRegistrations(root: Node, topLevelOnly: boolean, ctx: RegistrationContext): RegistrationResult {
  const registrations: RouteRegistration[] = [];
  const mounts: MountRegistration[] = [];
  const handlers: CodeSymbol[] = [];
  const handlerRanges: [number, number][] = [];

  const consider = (n: Node): void => {
    if (n.type !== 'call_expression') return;
    const fn = field(n, 'function');
    if (!fn || fn.type !== 'member_expression') return;
    const verb = field(fn, 'property')?.text ?? '';
    const mount = matchMount(n, verb);
    if (mount) {
      mounts.push(mount);
      return;
    }
    const match = matchEntryVerb(verb);
    if (!match) return;
    const objText = field(fn, 'object')?.text ?? '';
    const argNodes = (() => {
      const args = field(n, 'arguments');
      return args ? namedChildren(args) : [];
    })();
    const first = argNodes[0];
    if (!first || (first.type !== 'string' && first.type !== 'template_string')) return;
    const name = unquote(first.text);
    if (!name) return;
    const last = argNodes[argNodes.length - 1];
    if (!last || last === first) return;

    // A bare `x.on('a', fn)` is only accepted when the name looks like a route
    // or a topic, or the receiver looks like a registrar. This keeps
    // `stream.on('data', cb)` from being read as an application entry point.
    const pathLike = name.startsWith('/');
    const topicLike = /[.:_\-\s*]/.test(name) || match.pattern.kind === 'cli';
    const registrarLike = REGISTRAR_LIKE.test(objText.split('.').pop() ?? objText);
    if (!pathLike && !registrarLike && !topicLike) return;
    if (match.pattern.kind === 'http' && !pathLike && !registrarLike) return;

    let handler: string | undefined;
    if (last.type === 'identifier' || last.type === 'member_expression') {
      handler = last.text;
    } else if (last.type === 'arrow_function' || last.type === 'function_expression' || last.type === 'function') {
      const synthetic = liftInlineHandler(last, name, match, ctx);
      if (synthetic) {
        handlers.push(synthetic);
        handler = synthetic.name;
        handlerRanges.push([synthetic.line, synthetic.endLine]);
      }
    }
    registrations.push({
      ...(match.method ? { method: match.method } : {}),
      path: name,
      ...(handler ? { handler } : {}),
      line: line(n),
      kind: match.pattern.kind,
      reason: match.pattern.id,
      confidence: match.pattern.confidence,
    });
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
  return { registrations, mounts, handlers, handlerRanges };
}

/**
 * Mounting a sub-router under a prefix. Two shapes cover the common cases:
 *   mount(path, target)                     — `app.use('/api', routes)`
 *   mount(target, { prefix: path })         — `fastify.register(routes, { prefix: '/api' })`
 * Recognised by shape, so a framework that mounts the same way works for free.
 */
function matchMount(call: Node, verb: string): MountRegistration | null {
  if (!MOUNT_VERBS.has(verb.toLowerCase())) return null;
  const args = field(call, 'arguments');
  const argNodes = args ? namedChildren(args) : [];
  if (argNodes.length < 2) return null;
  const [a, b] = argNodes;
  if (!a || !b) return null;
  // Shape 1: a path then a router.
  if ((a.type === 'string' || a.type === 'template_string') && (b.type === 'identifier' || b.type === 'member_expression')) {
    const prefix = unquote(a.text);
    if (!prefix.startsWith('/')) return null;
    return { prefix, target: b.text, line: line(call) };
  }
  // Shape 2: a router then an options object carrying the prefix.
  if (a.type === 'identifier' && b.type === 'object') {
    const prefix = objectStringProperty(b, 'prefix');
    if (!prefix) return null;
    return { prefix, target: a.text, line: line(call) };
  }
  return null;
}

/** Read a string-valued property from an object literal. */
function objectStringProperty(obj: Node, key: string): string | undefined {
  for (const prop of namedChildren(obj)) {
    if (prop.type !== 'pair') continue;
    const k = field(prop, 'key')?.text.replace(/['"`]/g, '');
    if (k !== key) continue;
    const v = field(prop, 'value');
    if (v && (v.type === 'string' || v.type === 'template_string')) return unquote(v.text);
  }
  return undefined;
}

const MOUNT_VERBS = new Set(['use', 'register', 'mount', 'addroutes']);

interface RegistrationContext {
  /** Per-file counter so synthetic handler names stay unique. */
  next: () => number;
}

/**
 * Per-file registration state. The tree walk is synchronous, so module scope is
 * safe here and keeps the signature of every parse helper unchanged.
 */
let regCtx: RegistrationContext = newRegistrationContext();
const pendingHandlers: CodeSymbol[] = [];

function newRegistrationContext(): RegistrationContext {
  let n = 0;
  return { next: () => ++n };
}

function resetRegistrations(): void {
  regCtx = newRegistrationContext();
  pendingHandlers.length = 0;
}

interface RegistrationResult {
  registrations: RouteRegistration[];
  mounts: MountRegistration[];
  handlers: CodeSymbol[];
  handlerRanges: [number, number][];
}

/**
 * Turn an inline handler into a top-level symbol so it owns its own calls.
 *
 * HTTP handlers get a deliberately non-descriptive name (`route_3`): the use
 * case is then named from the route ("Create User") rather than from the
 * function. Topic-driven handlers are named after the topic instead.
 */
function liftInlineHandler(fnNode: Node, name: string, match: PatternMatch, ctx: RegistrationContext): CodeSymbol | null {
  const body = field(fnNode, 'body');
  if (!body) return null;
  const symName = match.pattern.kind === 'http' ? `route_${ctx.next()}` : `${camelFromTopic(name)}_${ctx.next()}`;
  const sym: CodeSymbol = {
    id: symName,
    name: symName,
    kind: 'function',
    line: line(fnNode),
    endLine: endLine(fnNode),
    exported: false,
    annotations: [],
    fields: [],
    params: parseParams(field(fnNode, 'parameters')),
    extends: [],
    implements: [],
    calls: collectCalls(body),
    typeRefs: collectTypeRefs(body),
    flags: { inlineHandler: true },
  };
  return sym;
}

/** "user.created" → "userCreated"; a cron expression carries no name, so → "job". */
function camelFromTopic(topic: string): string {
  if (!/[A-Za-z]/.test(topic)) return 'job';
  const parts = topic.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return 'job';
  const [head, ...rest] = parts;
  return head!.toLowerCase() + rest.map((r) => r[0]!.toUpperCase() + r.slice(1)).join('');
}

/** Calls in `body` that do not belong to a lifted inline handler. */
function callsOutside(body: Node, ranges: [number, number][]): CallSite[] {
  return collectCalls(body).filter((c) => !ranges.some(([a, b]) => c.line >= a && c.line <= b));
}
