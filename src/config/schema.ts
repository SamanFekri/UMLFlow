/**
 * Project configuration schema (`.umlflow/config.yaml`).
 *
 * The configuration is user-owned. UMLFlow only writes to it in two places:
 * `diagrams.<name>.inferredScope` (owned by UMLFlow, overridable by `scope`)
 * and when adding a new diagram definition through `generate`.
 */

import path from 'node:path';
import { UmlflowError } from '../core/errors.js';

export const CONFIG_VERSION = 1;

export type HookMode = 'update' | 'check' | 'off';
export type OutputFormat = 'md' | 'mmd';

/** Built-in diagram types. Additional types can be registered by generators. */
export type DiagramType = 'usecase' | 'sequence' | 'erd' | (string & {});

export interface AnalysisConfig {
  /** Glob patterns (repo-relative). Empty means the whole repository. */
  include: string[];
  /** Glob patterns to exclude in addition to built-in ignores (node_modules, build output, …). */
  exclude: string[];
  /** Restrict to language ids (e.g. "typescript", "python"). Empty means auto-detect all supported. */
  languages: string[];
  /** Skip files larger than this (bytes). */
  maxFileSize: number;
  /** Default maximum call depth when walking flows for sequence diagrams. */
  maxCallDepth: number;
}

export interface OutputConfig {
  /** Directory for generated diagrams, repo-relative. */
  dir: string;
  format: OutputFormat;
  /**
   * Extra plain-Mermaid mirror of every diagram, repo-relative, laid out as
   * `<dir>/<type>/<name>.mmd` (e.g. `umlflow/sequence/checkout-flow.mmd`).
   * Derived output for tools that want the bare diagram — set to null to disable.
   */
  mermaidDir: string | null;
  /**
   * Append "?" / "??" to inferred / unknown labels inside diagrams.
   * Off by default: names must stay clean and stable. Uncertainty is reported
   * in the diagram's analysis notes and by `umlflow validate` instead.
   */
  uncertaintyMarkers: boolean;
}

export interface GitConfig {
  hooks: Record<string, HookMode>;
}

export interface DiagramScope {
  /** Path globs to include. */
  include?: string[];
  /** Path globs to exclude. */
  exclude?: string[];
  /** Explicit entry operations, e.g. "AuthController.login" or "POST /login". */
  entryPoints?: string[];
  /** Explicit component names to include. */
  components?: string[];
  /** Explicit entity names to include (ERD). */
  entities?: string[];
  /** Maximum call depth for flows (sequence). */
  depth?: number;
}

/**
 * Scope inferred by UMLFlow from a natural-language query. Owned by UMLFlow.
 * `entryPoints`/`entities` pin the diagram; `files`/`components` record what the
 * inference touched (informational — flows may reach code added later).
 */
export interface InferredScope {
  query?: string;
  files?: string[];
  components?: string[];
  entryPoints?: string[];
  entities?: string[];
  /** ISO timestamp of the inference. */
  inferredAt?: string;
}

export interface ExplicitRelationship {
  from: string;
  to: string;
  label?: string;
  /** For ERD: one-to-one | one-to-many | many-to-one | many-to-many. For sequence: message label. */
  kind?: string;
}

export interface DiagramOverrides {
  /** Display label per component/entity/actor/use-case id. */
  labels?: Record<string, string>;
  /** Alias several ids to one participant/entity (e.g. merge OrderRepo & OrderRepository). */
  aliases?: Record<string, string>;
  /** Ids to hide from this diagram. */
  exclude?: string[];
  /** Extra relationships/messages that code analysis cannot see. */
  relationships?: ExplicitRelationship[];
  /** Operation id or use case → actor name. */
  actors?: Record<string, string>;
  /** Group name → member ids (rendered as subgraphs / boxes). */
  groups?: Record<string, string[]>;
  /** Extra renderer-specific lines appended inside the diagram (advanced). */
  raw?: string[];
  /** Renderer styling lines (e.g. Mermaid classDef). */
  style?: string[];
  /** Free-text instructions used by Claude when interpreting this diagram. */
  instructions?: string;
}

export interface DiagramDefinition {
  type: DiagramType;
  description?: string;
  scope?: DiagramScope;
  inferredScope?: InferredScope;
  overrides?: DiagramOverrides;
  /** Renderer id. Defaults to config.renderer. */
  renderer?: string;
}

export interface UmlflowConfig {
  version: number;
  analysis: AnalysisConfig;
  output: OutputConfig;
  renderer: string;
  git: GitConfig;
  diagrams: Record<string, DiagramDefinition>;
}

export const DEFAULT_CONFIG: UmlflowConfig = {
  version: CONFIG_VERSION,
  analysis: {
    include: [],
    exclude: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test/**', '**/tests/**', '**/*.d.ts'],
    languages: [],
    maxFileSize: 1_000_000,
    maxCallDepth: 6,
  },
  output: {
    dir: '.umlflow/diagrams',
    format: 'md',
    mermaidDir: 'umlflow',
    uncertaintyMarkers: false,
  },
  renderer: 'mermaid',
  git: {
    hooks: {
      'pre-commit': 'check',
    },
  },
  diagrams: {},
};

export const KNOWN_DIAGRAM_TYPES: DiagramType[] = ['usecase', 'sequence', 'erd'];
export const HOOK_MODES: HookMode[] = ['update', 'check', 'off'];
export const SUPPORTED_HOOKS = ['pre-commit', 'pre-push', 'post-merge', 'post-checkout'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strArray(v: unknown, path: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new UmlflowError(`Config: ${path} must be a list of strings`);
  }
  return v as string[];
}

/** Merge a parsed YAML object with defaults and validate it. Throws UmlflowError on problems. */
export function normalizeConfig(raw: unknown): UmlflowConfig {
  if (raw === null || raw === undefined) raw = {};
  if (!isRecord(raw)) throw new UmlflowError('Config: top level must be a mapping');

  const analysisRaw = isRecord(raw.analysis) ? raw.analysis : {};
  const outputRaw = isRecord(raw.output) ? raw.output : {};
  const gitRaw = isRecord(raw.git) ? raw.git : {};
  const hooksRaw = isRecord(gitRaw.hooks) ? gitRaw.hooks : {};
  const diagramsRaw = isRecord(raw.diagrams) ? raw.diagrams : {};

  const hooks: Record<string, HookMode> = { ...DEFAULT_CONFIG.git.hooks };
  for (const [hook, mode] of Object.entries(hooksRaw)) {
    if (!SUPPORTED_HOOKS.includes(hook)) throw new UmlflowError(`Config: unsupported git hook "${hook}"`);
    if (typeof mode !== 'string' || !HOOK_MODES.includes(mode as HookMode)) {
      throw new UmlflowError(`Config: git.hooks.${hook} must be one of ${HOOK_MODES.join(', ')}`);
    }
    hooks[hook] = mode as HookMode;
  }

  const format = outputRaw.format ?? DEFAULT_CONFIG.output.format;
  if (format !== 'md' && format !== 'mmd') throw new UmlflowError('Config: output.format must be "md" or "mmd"');

  const mermaidDirRaw = outputRaw.mermaidDir;
  if (mermaidDirRaw !== undefined && mermaidDirRaw !== null && typeof mermaidDirRaw !== 'string') {
    throw new UmlflowError('Config: output.mermaidDir must be a directory path or null');
  }
  if (typeof mermaidDirRaw === 'string' && (path.isAbsolute(mermaidDirRaw) || mermaidDirRaw.split(/[\\/]/).includes('..'))) {
    throw new UmlflowError('Config: output.mermaidDir must be a relative path inside the repository');
  }
  const mermaidDir = mermaidDirRaw === undefined ? DEFAULT_CONFIG.output.mermaidDir : mermaidDirRaw === '' ? null : mermaidDirRaw;

  const markersRaw = outputRaw.uncertaintyMarkers;
  if (markersRaw !== undefined && typeof markersRaw !== 'boolean') throw new UmlflowError('Config: output.uncertaintyMarkers must be true or false');
  const uncertaintyMarkers = markersRaw ?? DEFAULT_CONFIG.output.uncertaintyMarkers;

  const diagrams: Record<string, DiagramDefinition> = {};
  for (const [name, defRaw] of Object.entries(diagramsRaw)) {
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
      throw new UmlflowError(`Config: diagram name "${name}" must contain only letters, digits, "-" or "_"`);
    }
    diagrams[name] = normalizeDiagramDefinition(name, defRaw);
  }

  return {
    version: typeof raw.version === 'number' ? raw.version : CONFIG_VERSION,
    analysis: {
      include: strArray(analysisRaw.include, 'analysis.include'),
      exclude: analysisRaw.exclude === undefined ? [...DEFAULT_CONFIG.analysis.exclude] : strArray(analysisRaw.exclude, 'analysis.exclude'),
      languages: strArray(analysisRaw.languages, 'analysis.languages'),
      maxFileSize: typeof analysisRaw.maxFileSize === 'number' ? analysisRaw.maxFileSize : DEFAULT_CONFIG.analysis.maxFileSize,
      maxCallDepth: typeof analysisRaw.maxCallDepth === 'number' ? analysisRaw.maxCallDepth : DEFAULT_CONFIG.analysis.maxCallDepth,
    },
    output: {
      dir: typeof outputRaw.dir === 'string' ? outputRaw.dir : DEFAULT_CONFIG.output.dir,
      format,
      mermaidDir,
      uncertaintyMarkers,
    },
    renderer: typeof raw.renderer === 'string' ? raw.renderer : DEFAULT_CONFIG.renderer,
    git: { hooks },
    diagrams,
  };
}

export function normalizeDiagramDefinition(name: string, defRaw: unknown): DiagramDefinition {
  if (!isRecord(defRaw)) throw new UmlflowError(`Config: diagrams.${name} must be a mapping`);
  if (typeof defRaw.type !== 'string' || defRaw.type.length === 0) {
    throw new UmlflowError(`Config: diagrams.${name}.type is required`);
  }
  const def: DiagramDefinition = { type: defRaw.type };
  if (typeof defRaw.description === 'string') def.description = defRaw.description;
  if (typeof defRaw.renderer === 'string') def.renderer = defRaw.renderer;
  if (defRaw.scope !== undefined) {
    if (!isRecord(defRaw.scope)) throw new UmlflowError(`Config: diagrams.${name}.scope must be a mapping`);
    const s = defRaw.scope;
    def.scope = {
      include: s.include === undefined ? undefined : strArray(s.include, `diagrams.${name}.scope.include`),
      exclude: s.exclude === undefined ? undefined : strArray(s.exclude, `diagrams.${name}.scope.exclude`),
      entryPoints: s.entryPoints === undefined ? undefined : strArray(s.entryPoints, `diagrams.${name}.scope.entryPoints`),
      components: s.components === undefined ? undefined : strArray(s.components, `diagrams.${name}.scope.components`),
      entities: s.entities === undefined ? undefined : strArray(s.entities, `diagrams.${name}.scope.entities`),
      depth: typeof s.depth === 'number' ? s.depth : undefined,
    };
  }
  if (isRecord(defRaw.inferredScope)) {
    const s = defRaw.inferredScope;
    def.inferredScope = {
      query: typeof s.query === 'string' ? s.query : undefined,
      files: s.files === undefined ? undefined : strArray(s.files, `diagrams.${name}.inferredScope.files`),
      components: s.components === undefined ? undefined : strArray(s.components, `diagrams.${name}.inferredScope.components`),
      entryPoints: s.entryPoints === undefined ? undefined : strArray(s.entryPoints, `diagrams.${name}.inferredScope.entryPoints`),
      entities: s.entities === undefined ? undefined : strArray(s.entities, `diagrams.${name}.inferredScope.entities`),
      inferredAt: typeof s.inferredAt === 'string' ? s.inferredAt : undefined,
    };
  }
  if (defRaw.overrides !== undefined) {
    if (!isRecord(defRaw.overrides)) throw new UmlflowError(`Config: diagrams.${name}.overrides must be a mapping`);
    const o = defRaw.overrides;
    const overrides: DiagramOverrides = {};
    if (isRecord(o.labels)) overrides.labels = stringMap(o.labels);
    if (isRecord(o.aliases)) overrides.aliases = stringMap(o.aliases);
    if (o.exclude !== undefined) overrides.exclude = strArray(o.exclude, `diagrams.${name}.overrides.exclude`);
    if (isRecord(o.actors)) overrides.actors = stringMap(o.actors);
    if (o.raw !== undefined) overrides.raw = strArray(o.raw, `diagrams.${name}.overrides.raw`);
    if (o.style !== undefined) overrides.style = strArray(o.style, `diagrams.${name}.overrides.style`);
    if (typeof o.instructions === 'string') overrides.instructions = o.instructions;
    if (isRecord(o.groups)) {
      overrides.groups = {};
      for (const [g, members] of Object.entries(o.groups)) {
        overrides.groups[g] = strArray(members, `diagrams.${name}.overrides.groups.${g}`);
      }
    }
    if (Array.isArray(o.relationships)) {
      overrides.relationships = o.relationships.map((r, i) => {
        if (!isRecord(r) || typeof r.from !== 'string' || typeof r.to !== 'string') {
          throw new UmlflowError(`Config: diagrams.${name}.overrides.relationships[${i}] needs "from" and "to"`);
        }
        return {
          from: r.from,
          to: r.to,
          label: typeof r.label === 'string' ? r.label : undefined,
          kind: typeof r.kind === 'string' ? r.kind : undefined,
        };
      });
    }
    def.overrides = overrides;
  }
  return def;
}

function stringMap(v: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  return out;
}
