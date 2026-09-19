import { readJson, writeJson, removeFile, exists } from '../core/fs.js';
import { CacheCorruptError } from '../core/errors.js';
import type { ProjectPaths } from '../config/paths.js';
import type { CodeFile } from '../codemodel/types.js';
import type { SystemModel } from '../model/types.js';

export const INDEX_VERSION = 1;

export interface FileIndex {
  version: number;
  /** Version of the parser stack; a mismatch invalidates cached code models. */
  parserVersion: string;
  files: Record<string, CodeFile>;
  updatedAt: string;
}

/** Per-diagram record of what went into the last generation. */
export interface DiagramState {
  type: string;
  /** Repo-relative files whose facts contributed. */
  files: string[];
  /** System Model ids (components, entities, operations) that contributed. */
  modelIds: string[];
  /** Fingerprint of the diagram IR (after overrides). */
  fingerprint: string;
  /** Fingerprint of the diagram definition used. */
  definitionHash: string;
  /** Fingerprint of the semantics store at generation time. */
  semanticsHash: string;
  /** Fingerprint of the rendered output written to disk. */
  outputHash: string;
  generatedAt: string;
}

export interface DiagramStateFile {
  version: number;
  diagrams: Record<string, DiagramState>;
}

export interface CacheHealth {
  present: boolean;
  corrupt: boolean;
  problems: string[];
}

/**
 * Local disposable cache under `.umlflow/cache`. Never contains source text.
 * Any unreadable file is treated as missing so the pipeline can rebuild.
 */
export class IndexStore {
  constructor(readonly paths: ProjectPaths, readonly parserVersion: string) {}

  async health(): Promise<CacheHealth> {
    const problems: string[] = [];
    let present = false;
    for (const file of [this.paths.indexFile, this.paths.modelFile, this.paths.diagramStateFile]) {
      if (!(await exists(file))) continue;
      present = true;
      try {
        await readJson(file);
      } catch (err) {
        problems.push(`${file}: ${(err as Error).message}`);
      }
    }
    return { present, corrupt: problems.length > 0, problems };
  }

  /** Returns the file index or null when missing, corrupt or from an incompatible version. */
  async loadIndex(): Promise<{ index: FileIndex | null; reason?: string }> {
    let data: FileIndex | null;
    try {
      data = await readJson<FileIndex>(this.paths.indexFile);
    } catch (err) {
      return { index: null, reason: new CacheCorruptError(this.paths.indexFile, err).message };
    }
    if (!data) return { index: null, reason: 'missing' };
    if (data.version !== INDEX_VERSION) return { index: null, reason: `index version ${data.version} != ${INDEX_VERSION}` };
    if (data.parserVersion !== this.parserVersion) return { index: null, reason: 'parser version changed' };
    if (!data.files || typeof data.files !== 'object') return { index: null, reason: 'index malformed' };
    return { index: data };
  }

  async saveIndex(files: Record<string, CodeFile>): Promise<void> {
    const index: FileIndex = {
      version: INDEX_VERSION,
      parserVersion: this.parserVersion,
      files,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(this.paths.indexFile, index);
  }

  async loadModel(): Promise<SystemModel | null> {
    try {
      return await readJson<SystemModel>(this.paths.modelFile);
    } catch {
      return null;
    }
  }

  async saveModel(model: SystemModel): Promise<void> {
    await writeJson(this.paths.modelFile, model);
  }

  async loadDiagramState(): Promise<Record<string, DiagramState>> {
    try {
      const data = await readJson<DiagramStateFile>(this.paths.diagramStateFile);
      if (!data || data.version !== INDEX_VERSION || typeof data.diagrams !== 'object') return {};
      return data.diagrams;
    } catch {
      return {};
    }
  }

  async saveDiagramState(diagrams: Record<string, DiagramState>): Promise<void> {
    await writeJson(this.paths.diagramStateFile, { version: INDEX_VERSION, diagrams });
  }

  /**
   * File hashes as of the last synchronisation (`update`/`generate`). Kept apart
   * from the parse cache so that read-only commands (`check`, `status`, `diff`)
   * can refresh the cache without moving the baseline that `update` diffs against.
   */
  async loadSyncBaseline(): Promise<Record<string, string> | null> {
    try {
      const data = await readJson<{ version: number; hashes: Record<string, string> }>(this.paths.syncBaselineFile);
      if (!data || data.version !== INDEX_VERSION || typeof data.hashes !== 'object') return null;
      return data.hashes;
    } catch {
      return null;
    }
  }

  async saveSyncBaseline(hashes: Record<string, string>): Promise<void> {
    await writeJson(this.paths.syncBaselineFile, { version: INDEX_VERSION, hashes });
  }

  async clear(): Promise<void> {
    await removeFile(this.paths.indexFile);
    await removeFile(this.paths.modelFile);
    await removeFile(this.paths.diagramStateFile);
    await removeFile(this.paths.syncBaselineFile);
  }
}
