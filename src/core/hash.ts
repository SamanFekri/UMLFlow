import { createHash } from 'node:crypto';

/** SHA-256 hex digest. Used for file contents and structural fingerprints. */
export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Short (16 hex chars) digest suitable for fingerprints stored in state files. */
export function shortHash(input: string | Buffer): string {
  return sha256(input).slice(0, 16);
}

/** Deterministic JSON serialisation (sorted keys) so fingerprints are stable. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function fingerprint(value: unknown): string {
  return shortHash(stableStringify(value));
}
