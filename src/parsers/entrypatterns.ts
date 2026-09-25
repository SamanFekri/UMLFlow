/**
 * Framework-independent entry-point registration patterns.
 *
 * Most systems do not declare entry points with annotations. They *register*
 * them by calling a method with a name and a handler:
 *
 *   app.get('/users/:id', handler)      HTTP route
 *   bot.command('start', handler)       chat command
 *   bus.on('user.created', handler)     event subscription
 *   queue.process('resize', handler)    message/queue consumer
 *   cron.schedule('0 * * * *', handler) scheduled job
 *
 * These are the same shape — `<receiver>.<verb>(<name>, <handler>)` — so they
 * are recognised by that shape rather than by framework. A pattern is data: to
 * support a new framework, add a verb here, not a branch in the parser.
 *
 * The shape alone is weak evidence (`stream.on('data', cb)` matches too), so
 * only HTTP verbs are treated as deterministic; the rest are marked inferred
 * and can be corrected through the semantic question protocol.
 */

export type EntryKind = 'http' | 'event' | 'message' | 'scheduled' | 'cli';

export interface EntryPattern {
  /** Short id used as the provenance reason, e.g. "event subscription". */
  id: string;
  kind: EntryKind;
  /** Registration verbs, lowercased. */
  verbs: Set<string>;
  /** 'from-verb' uses the verb itself (GET/POST/…); otherwise a fixed label. */
  method?: 'from-verb' | string;
  /** Is the registration directly supported by code, or only inferred from shape? */
  confidence: 'deterministic' | 'inferred';
}

/** HTTP verbs are also used as a fast path by callers that only care about routes. */
export const HTTP_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']);

export const ENTRY_PATTERNS: EntryPattern[] = [
  {
    id: 'http route registration',
    kind: 'http',
    verbs: HTTP_VERBS,
    method: 'from-verb',
    confidence: 'deterministic',
  },
  {
    id: 'event subscription',
    kind: 'event',
    // `handle`/`addEventListener` cover message buses and DOM-style emitters.
    verbs: new Set(['on', 'once', 'addlistener', 'addeventlistener', 'subscribe', 'listen', 'handle']),
    confidence: 'inferred',
  },
  {
    id: 'message consumer registration',
    kind: 'message',
    verbs: new Set(['process', 'consume', 'worker', 'work', 'receive']),
    confidence: 'inferred',
  },
  {
    id: 'scheduled job registration',
    kind: 'scheduled',
    verbs: new Set(['schedule', 'cron', 'every', 'repeat']),
    confidence: 'inferred',
  },
  {
    id: 'command registration',
    kind: 'cli',
    // CLI frameworks and chat bots register commands the same way.
    verbs: new Set(['command', 'hears', 'action', 'cmd']),
    confidence: 'inferred',
  },
];

export interface PatternMatch {
  pattern: EntryPattern;
  /** HTTP verb for http patterns; undefined otherwise. */
  method?: string;
}

/** Find the pattern a registration verb belongs to, if any. */
export function matchEntryVerb(verb: string): PatternMatch | undefined {
  const v = verb.toLowerCase();
  for (const pattern of ENTRY_PATTERNS) {
    if (!pattern.verbs.has(v)) continue;
    return { pattern, ...(pattern.method === 'from-verb' ? { method: verb.toUpperCase() } : {}) };
  }
  return undefined;
}

/**
 * Receivers that look like a registrar. Used only to accept a registration
 * whose name argument is not path-shaped (`bot.command('start', …)`), so an
 * arbitrary `x.on('a', fn)` still needs a path-like or dotted topic name.
 */
export const REGISTRAR_LIKE = /^(app|router|server|api|fastify|express|route|routes|http|koa|hono|bot|client|bus|emitter|events|queue|worker|consumer|scheduler|cron|agenda|program|cli|socket|io|channel|r|v\d+)$/i;
