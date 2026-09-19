import type { CodeFile } from '../../codemodel/types.js';
import { emptyCodeFile } from '../../codemodel/types.js';
import type { LanguageAdapter, ParseContext } from '../adapter.js';

/**
 * Fallback for languages without a dedicated adapter. Records the file so
 * change detection and Claude-driven semantic analysis can reference it, but
 * never fabricates structural facts.
 */
export class FallbackAdapter implements LanguageAdapter {
  readonly id = 'unknown';
  readonly displayName = 'Unsupported language';
  readonly version = 1;
  readonly extensions: string[] = [];

  constructor(private readonly language: string) {}

  async parse(ctx: ParseContext): Promise<CodeFile> {
    return emptyCodeFile(ctx.path, this.language, ctx.hash, 'unsupported', `No parser for ${this.language}; structural facts are not extracted from this file.`);
  }
}
