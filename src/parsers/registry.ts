import path from 'node:path';
import type { LanguageAdapter } from './adapter.js';
import { TypeScriptAdapter } from './adapters/typescript.js';
import { PythonAdapter } from './adapters/python.js';
import { JavaAdapter } from './adapters/java.js';
import { GoAdapter } from './adapters/go.js';
import { SqlAdapter } from './schema/sql.js';
import { PrismaAdapter } from './schema/prisma.js';
import { FallbackAdapter } from './adapters/fallback.js';

/** Extensions we recognise as source code even without a dedicated adapter (kept for reporting). */
const KNOWN_LANGUAGES: Record<string, string> = {
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.scala': 'scala',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.clj': 'clojure',
  '.hs': 'haskell',
  '.lua': 'lua',
  '.pl': 'perl',
  '.r': 'r',
  '.m': 'objc',
};

export class ParserRegistry {
  private readonly adapters: LanguageAdapter[] = [];
  private readonly byExt = new Map<string, LanguageAdapter>();

  register(adapter: LanguageAdapter): this {
    this.adapters.push(adapter);
    for (const ext of adapter.extensions) this.byExt.set(ext.toLowerCase(), adapter);
    return this;
  }

  list(): LanguageAdapter[] {
    return [...this.adapters];
  }

  /** Version string covering every adapter; changes invalidate cached code models. */
  version(): string {
    return this.adapters.map((a) => `${a.id}@${a.version}`).join(',');
  }

  /** Language id for a file, or null if it is not source we care about. */
  detectLanguage(relPath: string): string | null {
    for (const a of this.adapters) if (a.matches?.(relPath)) return a.id;
    const ext = path.posix.extname(relPath).toLowerCase();
    const adapter = this.byExt.get(ext);
    if (adapter) return adapter.id;
    return KNOWN_LANGUAGES[ext] ?? null;
  }

  /** True when the file has a dedicated adapter. */
  hasAdapter(relPath: string): boolean {
    for (const a of this.adapters) if (a.matches?.(relPath)) return true;
    return this.byExt.has(path.posix.extname(relPath).toLowerCase());
  }

  /** Adapter for a file; falls back to a non-fabricating adapter for known-but-unsupported languages. */
  adapterFor(relPath: string, allowedLanguages: string[] = []): LanguageAdapter | null {
    const language = this.detectLanguage(relPath);
    if (!language) return null;
    if (allowedLanguages.length > 0 && !allowedLanguages.includes(language)) return null;
    for (const a of this.adapters) if (a.matches?.(relPath)) return a;
    const adapter = this.byExt.get(path.posix.extname(relPath).toLowerCase());
    return adapter ?? new FallbackAdapter(language);
  }
}

export function createDefaultRegistry(): ParserRegistry {
  return new ParserRegistry()
    .register(new TypeScriptAdapter('typescript'))
    .register(new TypeScriptAdapter('javascript'))
    .register(new PythonAdapter())
    .register(new JavaAdapter())
    .register(new GoAdapter())
    .register(new SqlAdapter())
    .register(new PrismaAdapter());
}
