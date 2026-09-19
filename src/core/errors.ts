/** Error thrown for expected, user-facing failures. The CLI prints the message without a stack. */
export class UmlflowError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(message: string, options: { code?: string; hint?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'UmlflowError';
    this.code = options.code ?? 'UMLFLOW_ERROR';
    this.hint = options.hint;
  }
}

export class NotInitializedError extends UmlflowError {
  constructor(root: string) {
    super(`UMLFlow is not initialized in ${root}`, {
      code: 'NOT_INITIALIZED',
      hint: 'Run `umlflow init` first.',
    });
  }
}

export class CacheCorruptError extends UmlflowError {
  constructor(file: string, cause: unknown) {
    super(`UMLFlow cache file is unreadable: ${file}`, {
      code: 'CACHE_CORRUPT',
      hint: 'The cache is disposable; it will be rebuilt automatically or run `umlflow rebuild-index`.',
      cause,
    });
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
