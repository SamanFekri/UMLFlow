import type { CodeFile } from '../codemodel/types.js';

export interface ParseContext {
  /** Repo-relative POSIX path. */
  path: string;
  text: string;
  hash: string;
  /** Whether a repo-relative path exists in the analysis universe (used for import resolution). */
  fileExists: (rel: string) => boolean;
}

/**
 * A language adapter turns one source file into the language-independent
 * Code Model. Adapters are the *only* language-specific code in UMLFlow.
 */
export interface LanguageAdapter {
  /** Stable id, e.g. "typescript". */
  id: string;
  displayName: string;
  /** Bump when extraction logic changes so cached code models are invalidated. */
  version: number;
  /** File extensions handled (with leading dot). */
  extensions: string[];
  /** Optional additional matcher for special filenames (e.g. "schema.prisma"). */
  matches?(relPath: string): boolean;
  parse(ctx: ParseContext): Promise<CodeFile>;
}
