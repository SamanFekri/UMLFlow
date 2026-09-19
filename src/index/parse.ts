import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { CodeFile } from '../codemodel/types.js';
import type { ParserRegistry } from '../parsers/registry.js';
import { emptyCodeFile } from '../codemodel/types.js';

export interface ParseRequest {
  path: string;
  hash: string;
}

/**
 * Parse the given files (only those!) into Code Files. `universe` is the full
 * list of analysable files so adapters can resolve imports without touching
 * the file system.
 */
export async function parseFiles(
  root: string,
  requests: ParseRequest[],
  universe: Iterable<string>,
  registry: ParserRegistry,
  allowedLanguages: string[] = [],
): Promise<Record<string, CodeFile>> {
  const known = new Set(universe);
  const dirs = new Set<string>();
  for (const f of known) {
    let d = path.posix.dirname(f);
    while (d && d !== '.' && !dirs.has(d)) {
      dirs.add(d);
      d = path.posix.dirname(d);
    }
  }
  const fileExists = (rel: string): boolean => known.has(rel) || dirs.has(rel);
  const out: Record<string, CodeFile> = {};
  for (const req of requests) {
    const adapter = registry.adapterFor(req.path, allowedLanguages);
    if (!adapter) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(root, req.path), 'utf8');
    } catch (err) {
      out[req.path] = emptyCodeFile(req.path, adapter.id, req.hash, 'failed', (err as Error).message);
      continue;
    }
    try {
      out[req.path] = await adapter.parse({ path: req.path, text, hash: req.hash, fileExists });
    } catch (err) {
      out[req.path] = emptyCodeFile(req.path, adapter.id, req.hash, 'failed', (err as Error).message);
    }
  }
  return out;
}
