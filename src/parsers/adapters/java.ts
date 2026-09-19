import type { Annotation, CallSite, CodeFile, CodeSymbol, Field, Param } from '../../codemodel/types.js';
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
  type Node,
} from '../treesitter/runtime.js';

/**
 * Java adapter. Understands packages/imports, classes, interfaces, records,
 * enums, annotations (Spring/JPA/Jakarta), field and constructor injection.
 */
export class JavaAdapter implements LanguageAdapter {
  readonly id = 'java';
  readonly displayName = 'Java';
  readonly version = 1;
  readonly extensions = ['.java'];

  async parse(ctx: ParseContext): Promise<CodeFile> {
    const file = emptyCodeFile(ctx.path, this.id, ctx.hash, 'ok');
    let tree;
    try {
      tree = await parseWith('java', ctx.text);
    } catch (err) {
      file.status = 'failed';
      file.message = (err as Error).message;
      return file;
    }
    try {
      const root = tree.rootNode;
      if (root.hasError) file.status = 'partial';
      for (const node of namedChildren(root)) {
        if (node.type === 'package_declaration') {
          file.module = namedChildren(node)[0]?.text;
        } else if (node.type === 'import_declaration') {
          const id = firstChildOfType(node, 'scoped_identifier', 'identifier');
          const wildcard = namedChildren(node).some((c) => c.type === 'asterisk');
          const source = id?.text ?? '';
          const last = source.split('.').pop() ?? source;
          const imp = { source, names: wildcard ? ['*'] : [last], line: line(node), resolvedFile: resolveImport(ctx, source, wildcard) };
          if (!imp.resolvedFile) delete (imp as { resolvedFile?: string }).resolvedFile;
          file.imports.push(imp);
        } else if (isTypeDecl(node)) {
          file.symbols.push(...parseType(node, ctx));
        }
      }
    } finally {
      tree.delete();
    }
    return file;
  }
}

function isTypeDecl(node: Node): boolean {
  return ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'annotation_type_declaration'].includes(node.type);
}

function resolveImport(ctx: ParseContext, source: string, wildcard: boolean): string | undefined {
  if (!source) return undefined;
  const rel = source.split('.').join('/');
  const candidates: string[] = [];
  const roots = ['', 'src/main/java/', 'src/', 'app/src/main/java/', 'src/test/java/'];
  for (const root of roots) candidates.push(wildcard ? `${root}${rel}` : `${root}${rel}.java`);
  return candidates.find((c) => ctx.fileExists(c));
}

function parseAnnotations(modifiers: Node | null): Annotation[] {
  if (!modifiers) return [];
  const out: Annotation[] = [];
  for (const m of namedChildren(modifiers)) {
    if (m.type === 'marker_annotation') out.push({ name: field(m, 'name')?.text ?? namedChildren(m)[0]?.text ?? '', args: [], line: line(m) });
    else if (m.type === 'annotation') {
      const ann: Annotation = { name: field(m, 'name')?.text ?? namedChildren(m)[0]?.text ?? '', args: [], line: line(m) };
      const args = field(m, 'arguments') ?? firstChildOfType(m, 'annotation_argument_list');
      if (args) {
        for (const a of namedChildren(args)) {
          if (a.type === 'element_value_pair') {
            ann.named ??= {};
            ann.named[field(a, 'key')?.text ?? ''] = literal(field(a, 'value'));
          } else ann.args.push(literal(a));
        }
      }
      out.push(ann);
    }
  }
  return out;
}

function literal(node: Node | null): string {
  if (!node) return '';
  if (node.type === 'string_literal') return unquote(node.text);
  if (node.type === 'element_value_array_initializer') {
    return namedChildren(node).map(literal).join(',');
  }
  return argText(node);
}

function visibility(modifiers: Node | null): Field['visibility'] {
  const t = modifiers?.text ?? '';
  if (/\bprivate\b/.test(t)) return 'private';
  if (/\bprotected\b/.test(t)) return 'protected';
  if (/\bpublic\b/.test(t)) return 'public';
  return 'package';
}

function parseType(node: Node, ctx: ParseContext): CodeSymbol[] {
  const name = field(node, 'name')?.text ?? 'Anonymous';
  const modifiers = firstChildOfType(node, 'modifiers');
  const kind: CodeSymbol['kind'] = node.type === 'interface_declaration' ? 'interface' : node.type === 'enum_declaration' ? 'enum' : 'class';
  const sym: CodeSymbol = {
    id: name,
    name,
    kind,
    line: line(node),
    endLine: endLine(node),
    exported: visibility(modifiers) !== 'private',
    annotations: parseAnnotations(modifiers),
    fields: [],
    params: [],
    extends: [],
    implements: [],
    calls: [],
    typeRefs: [],
    flags: {},
  };
  if (node.type === 'record_declaration') sym.flags!.record = true;
  const superclass = field(node, 'superclass') ?? firstChildOfType(node, 'superclass');
  if (superclass) {
    const t = simplifyType(namedChildren(superclass)[0]?.text ?? superclass.text.replace(/^extends\s+/, ''));
    if (t) sym.extends.push(t);
  }
  const interfaces = field(node, 'interfaces') ?? firstChildOfType(node, 'super_interfaces', 'extends_interfaces');
  if (interfaces) {
    const list = firstChildOfType(interfaces, 'type_list') ?? interfaces;
    for (const t of namedChildren(list)) {
      const s = simplifyType(t.text);
      if (s) (node.type === 'interface_declaration' ? sym.extends : sym.implements).push(s);
      // Spring Data repositories: JpaRepository<Order, Long> → remember entity type.
      const generic = t.text.match(/^(?:Jpa|Crud|Paging|Mongo|Reactive|R2dbc|Elasticsearch)\w*Repository\s*<\s*([A-Za-z0-9_]+)/);
      if (generic) sym.flags!.repositoryEntity = generic[1]!;
    }
  }
  // Record components → fields.
  const recordParams = field(node, 'parameters');
  if (recordParams) {
    for (const p of childrenOfType(recordParams, 'formal_parameter')) {
      sym.fields.push({ name: field(p, 'name')?.text ?? '', type: simplifyType(field(p, 'type')?.text), annotations: parseAnnotations(firstChildOfType(p, 'modifiers')), line: line(p) });
    }
  }
  const out: CodeSymbol[] = [sym];
  const body = field(node, 'body');
  if (!body) return out;
  for (const member of namedChildren(body)) {
    if (member.type === 'field_declaration') {
      const mods = firstChildOfType(member, 'modifiers');
      const info = typeInfo(field(member, 'type')?.text);
      for (const d of childrenOfType(member, 'variable_declarator')) {
        sym.fields.push({ name: field(d, 'name')?.text ?? '', ...info, annotations: parseAnnotations(mods), line: line(member), visibility: visibility(mods) });
      }
    } else if (member.type === 'constructor_declaration') {
      const params = parseParams(field(member, 'parameters'));
      for (const p of params) {
        if (looksLikeTypeName(p.type) && !sym.fields.some((f) => f.name === p.name)) {
          sym.fields.push({ name: p.name, type: p.type, annotations: p.annotations, line: line(member) });
        }
      }
      const body = field(member, 'body');
      if (body) sym.calls.push(...collectCalls(body));
    } else if (member.type === 'method_declaration') {
      const mods = firstChildOfType(member, 'modifiers');
      const mname = field(member, 'name')?.text ?? '';
      const method: CodeSymbol = {
        id: `${name}.${mname}`,
        name: mname,
        kind: 'method',
        parent: name,
        line: line(member),
        endLine: endLine(member),
        exported: visibility(mods) === 'public' || kind === 'interface',
        annotations: parseAnnotations(mods),
        fields: [],
        params: parseParams(field(member, 'parameters')),
        returnType: simplifyType(field(member, 'type')?.text),
        extends: [],
        implements: [],
        calls: [],
        flags: { visibility: visibility(mods) ?? 'package' },
      };
      if (/\bstatic\b/.test(mods?.text ?? '')) method.flags!.static = true;
      const body = field(member, 'body');
      if (body) {
        method.calls = collectCalls(body);
        method.typeRefs = collectTypeRefs(body);
      }
      out.push(method);
    } else if (isTypeDecl(member)) {
      out.push(...parseType(member, ctx));
    }
  }
  return out;
}

function parseParams(params: Node | null): Param[] {
  if (!params) return [];
  return childrenOfType(params, 'formal_parameter', 'spread_parameter').map((p) => ({
    name: field(p, 'name')?.text ?? firstChildOfType(p, 'identifier')?.text ?? '',
    type: simplifyType(field(p, 'type')?.text ?? namedChildren(p).find((c) => c.type.endsWith('type') || c.type === 'type_identifier')?.text),
    annotations: parseAnnotations(firstChildOfType(p, 'modifiers')),
  }));
}

export function collectCalls(root: Node): CallSite[] {
  const calls: CallSite[] = [];
  walk(root, (n) => {
    if (n.type === 'class_body' && n.parent?.type === 'object_creation_expression') return false;
    if (n.type !== 'method_invocation') return;
    const nameNode = field(n, 'name');
    if (!nameNode) return;
    const obj = field(n, 'object');
    const args = field(n, 'arguments');
    const site: CallSite = { receiver: obj ? normalizeReceiver(obj) : undefined, name: nameNode.text, line: line(n), argCount: args ? namedChildren(args).length : 0 };
    if (obj && isChained(obj)) site.chained = true;
    calls.push(site);
  });
  return calls;
}

function isChained(obj: Node): boolean {
  return obj.type === 'method_invocation' || descendants(obj, 'method_invocation').length > 0;
}

function normalizeReceiver(obj: Node): string {
  let node: Node | null = obj;
  while (node && node.type === 'method_invocation') node = field(node, 'object');
  if (!node) return obj.text.replace(/\s+/g, '');
  if (node.type === 'object_creation_expression') return `new ${simplifyType(field(node, 'type')?.text) ?? ''}`;
  return node.text.replace(/\s+/g, '');
}

function collectTypeRefs(root: Node): string[] {
  const refs = new Set<string>();
  walk(root, (n) => {
    if (n.type === 'object_creation_expression') {
      const t = simplifyType(field(n, 'type')?.text);
      if (looksLikeTypeName(t)) refs.add(t);
    }
  });
  return [...refs];
}
