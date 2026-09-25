import path from 'node:path';
import { readTextOrNull } from './fs.js';

/**
 * .gitignore support.
 *
 * Generated and vendored code is the main source of noise in an architecture
 * model, and a repository already declares what that is. Rather than maintain a
 * second list, UMLFlow reads `.gitignore` files and turns their patterns into
 * the same glob form `analysis.exclude` uses.
 *
 * This is a pragmatic subset of the gitignore specification: comments, blank
 * lines, negations (`!`), anchored patterns (`/build`), directory patterns
 * (`dist/`) and plain patterns (`*.min.js`). Nested .gitignore files are read
 * relative to their own directory. `git check-ignore` semantics around
 * re-inclusion inside an ignored directory are not reproduced.
 */

export interface GitignoreRules {
  /** Glob patterns to ignore, repo-relative. */
  patterns: string[];
  /** Patterns re-included with `!`, which win over `patterns`. */
  negated: string[];
  /** Files the rules were read from. */
  sources: string[];
}

export function emptyGitignoreRules(): GitignoreRules {
  return { patterns: [], negated: [], sources: [] };
}

/** Translate one .gitignore line into a repo-relative glob, or null to skip it. */
export function gitignoreLineToGlob(line: string, dir: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  let body = trimmed.replace(/^!/, '');
  // A trailing slash means "directory"; match everything under it.
  const isDir = body.endsWith('/');
  if (isDir) body = body.slice(0, -1);
  // A leading slash anchors to the .gitignore's own directory.
  const anchored = body.startsWith('/');
  if (anchored) body = body.slice(1);
  if (!body) return null;
  const prefix = dir ? `${dir}/` : '';
  // An unanchored pattern with no slash matches at any depth.
  const base = anchored || body.includes('/') ? `${prefix}${body}` : `${prefix}**/${body}`;
  return isDir ? `${base}/**` : base;
}

/** Read `.gitignore` at the repository root and in the given subdirectories. */
export async function loadGitignore(root: string, dirs: string[] = ['']): Promise<GitignoreRules> {
  const rules = emptyGitignoreRules();
  for (const dir of dirs) {
    const file = path.join(root, dir, '.gitignore');
    const text = await readTextOrNull(file);
    if (text === null) continue;
    rules.sources.push(dir ? `${dir}/.gitignore` : '.gitignore');
    for (const line of text.split('\n')) {
      const glob = gitignoreLineToGlob(line, dir);
      if (!glob) continue;
      if (line.trim().startsWith('!')) rules.negated.push(glob);
      else rules.patterns.push(glob);
      // A bare directory pattern should also exclude the directory entry itself.
      if (glob.endsWith('/**')) {
        const self = glob.slice(0, -3);
        if (line.trim().startsWith('!')) rules.negated.push(self);
        else rules.patterns.push(self);
      }
    }
  }
  return rules;
}
