import type { CallSite, CodeFile, CodeSymbol, Field, Param, RouteRegistration } from '../../codemodel/types.js';
import { emptyCodeFile } from '../../codemodel/types.js';
import type { LanguageAdapter, ParseContext } from '../adapter.js';
import {
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

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'Get', 'Post', 'Put', 'Delete', 'Patch', 'Handle', 'HandleFunc', 'Any']);

/**
 * Go adapter. Understands packages/imports, structs (fields = dependencies),
 * interfaces, functions, methods with receivers, and router registrations
 * (net/http, gin, chi, echo, gorilla style).
 */
export class GoAdapter implements LanguageAdapter {
  readonly id = 'go';
  readonly displayName = 'Go';
  readonly version = 1;
  readonly extensions = ['.go'];

  async parse(ctx: ParseContext): Promise<CodeFile> {
    const file = emptyCodeFile(ctx.path, this.id, ctx.hash, 'ok');
    let tree;
    try {
      tree = await parseWith('go', ctx.text);
    } catch (err) {
      file.status = 'failed';
      file.message = (err as Error).message;
      return file;
    }
    try {
      const root = tree.rootNode;
      if (root.hasError) file.status = 'partial';
      for (const node of namedChildren(root)) {
        switch (node.type) {
          case 'package_clause':
            file.module = namedChildren(node)[0]?.text;
            break;
          case 'import_declaration':
            for (const spec of node.descendantsOfType('import_spec')) {
              if (!spec) continue;
              const pathNode = field(spec, 'path');
              const alias = field(spec, 'name')?.text;
              const source = pathNode ? unquote(pathNode.text) : '';
              const last = source.split('/').pop() ?? source;
              const imp = { source, names: [alias ?? last], line: line(spec), resolvedFile: resolveImport(ctx, source) };
              if (!imp.resolvedFile) delete (imp as { resolvedFile?: string }).resolvedFile;
              file.imports.push(imp);
            }
            break;
          case 'type_declaration':
            for (const spec of childrenOfType(node, 'type_spec')) file.symbols.push(...parseTypeSpec(spec));
            break;
          case 'function_declaration':
            file.symbols.push(parseFunction(node, undefined));
            break;
          case 'method_declaration': {
            const recv = field(node, 'receiver');
            const recvType = recv ? simplifyType(childrenOfType(recv, 'parameter_declaration')[0]?.childForFieldName('type')?.text) : undefined;
            file.symbols.push(parseFunction(node, recvType));
            break;
          }
          default:
            break;
        }
      }
    } finally {
      tree.delete();
    }
    return file;
  }
}

function resolveImport(ctx: ParseContext, source: string): string | undefined {
  // Module-relative import paths: try to find a directory that matches the tail of the import path.
  const parts = source.split('/');
  for (let i = 0; i < parts.length; i++) {
    const dir = parts.slice(i).join('/');
    if (ctx.fileExists(dir)) return dir;
  }
  return undefined;
}

function parseTypeSpec(spec: Node): CodeSymbol[] {
  const name = field(spec, 'name')?.text ?? 'Anonymous';
  const typeNode = field(spec, 'type');
  const kind: CodeSymbol['kind'] = typeNode?.type === 'interface_type' ? 'interface' : typeNode?.type === 'struct_type' ? 'struct' : 'type';
  const sym: CodeSymbol = {
    id: name,
    name,
    kind,
    line: line(spec),
    endLine: endLine(spec),
    exported: /^[A-Z]/.test(name),
    annotations: [],
    fields: [],
    params: [],
    extends: [],
    implements: [],
    calls: [],
  };
  if (typeNode?.type === 'struct_type') {
    const list = firstChildOfType(typeNode, 'field_declaration_list');
    if (list) {
      for (const f of childrenOfType(list, 'field_declaration')) {
        const t = field(f, 'type');
        const names = childrenOfType(f, 'field_identifier');
        const tag = field(f, 'tag')?.text;
        const typeName = simplifyType(t?.text);
        if (names.length === 0 && typeName) {
          // Embedded struct → extends.
          sym.extends.push(typeName);
          continue;
        }
        for (const n of names) {
          const fld: Field = { name: n.text, type: typeName, annotations: [], line: line(f), visibility: /^[A-Z]/.test(n.text) ? 'public' : 'private' };
          if (tag) fld.annotations.push({ name: 'tag', args: [unquote(tag)], line: line(f) });
          sym.fields.push(fld);
        }
      }
    }
  } else if (typeNode?.type === 'interface_type') {
    for (const m of childrenOfType(typeNode, 'method_elem', 'method_spec')) {
      const n = field(m, 'name')?.text ?? firstChildOfType(m, 'field_identifier')?.text;
      if (n) sym.fields.push({ name: n + '()', annotations: [], line: line(m) });
    }
  }
  return [sym];
}

function parseFunction(node: Node, receiver: string | undefined): CodeSymbol {
  const name = field(node, 'name')?.text ?? 'anonymous';
  const sym: CodeSymbol = {
    id: receiver ? `${receiver}.${name}` : name,
    name,
    kind: receiver ? 'method' : 'function',
    parent: receiver,
    line: line(node),
    endLine: endLine(node),
    exported: /^[A-Z]/.test(name),
    annotations: [],
    fields: [],
    params: parseParams(field(node, 'parameters')),
    returnType: simplifyType(field(node, 'result')?.text),
    extends: [],
    implements: [],
    calls: [],
  };
  const body = field(node, 'body');
  if (body) {
    sym.calls = collectCalls(body);
    sym.typeRefs = collectTypeRefs(body);
    sym.routes = collectRoutes(body);
  }
  return sym;
}

function parseParams(params: Node | null): Param[] {
  if (!params) return [];
  const out: Param[] = [];
  for (const p of childrenOfType(params, 'parameter_declaration', 'variadic_parameter_declaration')) {
    const type = simplifyType(field(p, 'type')?.text);
    const names = childrenOfType(p, 'identifier');
    if (names.length === 0) out.push({ name: '', type, annotations: [] });
    for (const n of names) out.push({ name: n.text, type, annotations: [] });
  }
  return out;
}

export function collectCalls(root: Node): CallSite[] {
  const calls: CallSite[] = [];
  walk(root, (n) => {
    if (n.type === 'func_literal') return; // keep walking into closures (handlers often are closures)
    if (n.type !== 'call_expression') return;
    const fn = field(n, 'function');
    if (!fn) return;
    const args = field(n, 'arguments');
    const argCount = args ? namedChildren(args).length : 0;
    if (fn.type === 'selector_expression') {
      const operand = field(fn, 'operand');
      const fieldNode = field(fn, 'field');
      if (!fieldNode) return;
      const site: CallSite = { receiver: operand ? normalizeReceiver(operand) : undefined, name: fieldNode.text, line: line(n), argCount };
      if (operand && isChained(operand)) site.chained = true;
      calls.push(site);
    } else if (fn.type === 'identifier') {
      calls.push({ name: fn.text, line: line(n), argCount });
    }
  });
  return calls;
}

function isChained(obj: Node): boolean {
  return obj.type === 'call_expression' || descendants(obj, 'call_expression').length > 0;
}

function normalizeReceiver(obj: Node): string {
  let node: Node | null = obj;
  while (node && (node.type === 'call_expression' || node.type === 'parenthesized_expression' || node.type === 'unary_expression')) {
    if (node.type === 'call_expression') {
      node = field(node, 'function');
      if (node?.type === 'selector_expression') node = field(node, 'operand');
    } else node = namedChildren(node)[0] ?? null;
  }
  return (node ?? obj).text.replace(/\s+/g, '').replace(/^&/, '');
}

function collectTypeRefs(root: Node): string[] {
  const refs = new Set<string>();
  walk(root, (n) => {
    if (n.type === 'composite_literal') {
      const t = simplifyType(field(n, 'type')?.text);
      if (looksLikeTypeName(t)) refs.add(t);
    }
  });
  return [...refs];
}

function collectRoutes(root: Node): RouteRegistration[] {
  const routes: RouteRegistration[] = [];
  walk(root, (n) => {
    if (n.type !== 'call_expression') return;
    const fn = field(n, 'function');
    if (!fn || fn.type !== 'selector_expression') return;
    const method = field(fn, 'field')?.text ?? '';
    if (!HTTP_METHODS.has(method)) return;
    const args = field(n, 'arguments');
    const argNodes = args ? namedChildren(args) : [];
    const first = argNodes[0];
    if (!first || (first.type !== 'interpreted_string_literal' && first.type !== 'raw_string_literal')) return;
    const p = unquote(first.text);
    if (!p.startsWith('/')) return;
    const last = argNodes[argNodes.length - 1];
    const handler = last && last !== first && (last.type === 'identifier' || last.type === 'selector_expression') ? last.text : undefined;
    const httpMethod = method === 'HandleFunc' || method === 'Handle' || method === 'Any' ? 'ANY' : method.toUpperCase();
    routes.push({ method: httpMethod, path: p, handler, line: line(n) });
  });
  return routes;
}
