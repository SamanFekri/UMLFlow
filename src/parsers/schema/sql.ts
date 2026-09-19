import type { AttributeDecl, CodeFile, EntityDecl } from '../../codemodel/types.js';
import { emptyCodeFile } from '../../codemodel/types.js';
import type { LanguageAdapter, ParseContext } from '../adapter.js';

/**
 * SQL DDL extractor. Handles the subset that matters for an ERD:
 * CREATE TABLE (columns, PRIMARY KEY, FOREIGN KEY, REFERENCES, UNIQUE, NOT NULL)
 * and ALTER TABLE ... ADD [CONSTRAINT] FOREIGN KEY. Dialect-tolerant
 * (PostgreSQL, MySQL, SQLite, SQL Server quoting).
 */
export class SqlAdapter implements LanguageAdapter {
  readonly id = 'sql';
  readonly displayName = 'SQL DDL';
  readonly version = 1;
  readonly extensions = ['.sql', '.ddl'];

  async parse(ctx: ParseContext): Promise<CodeFile> {
    const file = emptyCodeFile(ctx.path, this.id, ctx.hash, 'ok');
    try {
      file.entities = extractSqlEntities(ctx.text);
    } catch (err) {
      file.status = 'failed';
      file.message = (err as Error).message;
    }
    return file;
  }
}

const IDENT = String.raw`(?:"[^"]+"|` + '`[^`]+`' + String.raw`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;

export function cleanIdent(raw: string): string {
  const parts = raw.split('.').map((p) => p.trim().replace(/^["`[]|["`\]]$/g, ''));
  return parts[parts.length - 1]!;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/** Split a parenthesised body on top-level commas. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let inQuote: string | null = null;
  for (const ch of body) {
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function lineOf(text: string, index: number): number {
  let l = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') l++;
  return l;
}

export function extractSqlEntities(sqlText: string): EntityDecl[] {
  const sql = stripComments(sqlText);
  const entities = new Map<string, EntityDecl>();
  const createRe = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QUALIFIED})\s*\(`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(sql))) {
    const name = cleanIdent(m[1]!);
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
    }
    const body = sql.slice(start, i - 1);
    const entity: EntityDecl = { name, table: name, attributes: [], relations: [], line: lineOf(sql, m.index), origin: 'sql' };
    for (const part of splitTopLevel(body)) parseTableElement(part, entity);
    entities.set(name.toLowerCase(), entity);
    createRe.lastIndex = i;
  }
  const alterRe = new RegExp(
    String.raw`alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(${QUALIFIED})\s+add\s+(?:constraint\s+${IDENT}\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+(${QUALIFIED})\s*(?:\(([^)]+)\))?`,
    'gi',
  );
  while ((m = alterRe.exec(sql))) {
    const entity = entities.get(cleanIdent(m[1]!).toLowerCase());
    if (!entity) continue;
    addForeignKey(entity, m[2]!, m[3]!, m[4]);
  }
  return [...entities.values()];
}

function parseTableElement(part: string, entity: EntityDecl): void {
  const upper = part.toUpperCase();
  let m: RegExpMatchArray | null;
  if ((m = part.match(new RegExp(String.raw`^(?:constraint\s+${IDENT}\s+)?primary\s+key\s*\(([^)]+)\)`, 'i')))) {
    for (const col of m[1]!.split(',')) {
      const attr = findOrCreate(entity, cleanIdent(col));
      attr.primaryKey = true;
    }
    return;
  }
  if ((m = part.match(new RegExp(String.raw`^(?:constraint\s+${IDENT}\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+(${QUALIFIED})\s*(?:\(([^)]+)\))?`, 'i')))) {
    addForeignKey(entity, m[1]!, m[2]!, m[3]);
    return;
  }
  if ((m = part.match(new RegExp(String.raw`^(?:constraint\s+${IDENT}\s+)?unique\s*\(([^)]+)\)`, 'i')))) {
    for (const col of m[1]!.split(',')) findOrCreate(entity, cleanIdent(col)).unique = true;
    return;
  }
  if (/^(constraint|check|index|key|fulltext|spatial|exclude)\b/i.test(part)) return;
  // Column definition: name type [constraints]
  const colMatch = part.match(new RegExp(String.raw`^(${IDENT})\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?(?:\s*\[\])?(?:\s+(?:unsigned|varying|precision|with(?:out)?\s+time\s+zone))*)`, 'i'));
  if (!colMatch) return;
  const attr: AttributeDecl = { name: cleanIdent(colMatch[1]!), type: colMatch[2]!.replace(/\s+/g, ' ').trim() };
  if (/\bPRIMARY\s+KEY\b/.test(upper)) attr.primaryKey = true;
  if (/\bNOT\s+NULL\b/.test(upper) || attr.primaryKey) attr.nullable = false;
  else attr.nullable = true;
  if (/\bUNIQUE\b/.test(upper)) attr.unique = true;
  const ref = part.match(new RegExp(String.raw`references\s+(${QUALIFIED})\s*(?:\(([^)]+)\))?`, 'i'));
  if (ref) {
    attr.foreignKey = { entity: cleanIdent(ref[1]!), attribute: ref[2] ? cleanIdent(ref[2].split(',')[0]!) : undefined };
    entity.relations.push({ target: attr.foreignKey.entity, kind: 'many-to-one', field: attr.name });
  }
  entity.attributes.push(attr);
}

function addForeignKey(entity: EntityDecl, cols: string, target: string, targetCols?: string): void {
  const colNames = cols.split(',').map(cleanIdent);
  const refCols = targetCols ? targetCols.split(',').map(cleanIdent) : [];
  const targetName = cleanIdent(target);
  colNames.forEach((col, i) => {
    const attr = findOrCreate(entity, col);
    attr.foreignKey = { entity: targetName, attribute: refCols[i] };
  });
  entity.relations.push({ target: targetName, kind: 'many-to-one', field: colNames[0] });
}

function findOrCreate(entity: EntityDecl, name: string): AttributeDecl {
  let attr = entity.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (!attr) {
    attr = { name };
    entity.attributes.push(attr);
  }
  return attr;
}
