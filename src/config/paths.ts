import path from 'node:path';

/** Well-known locations inside a project. All absolute. */
export interface ProjectPaths {
  root: string;
  umlflowDir: string;
  configFile: string;
  semanticsFile: string;
  cacheDir: string;
  indexFile: string;
  modelFile: string;
  diagramStateFile: string;
  syncBaselineFile: string;
}

export const UMLFLOW_DIR = '.umlflow';

export function projectPaths(root: string): ProjectPaths {
  const umlflowDir = path.join(root, UMLFLOW_DIR);
  const cacheDir = path.join(umlflowDir, 'cache');
  return {
    root,
    umlflowDir,
    configFile: path.join(umlflowDir, 'config.yaml'),
    semanticsFile: path.join(umlflowDir, 'semantics.yaml'),
    cacheDir,
    indexFile: path.join(cacheDir, 'index.json'),
    modelFile: path.join(cacheDir, 'model.json'),
    diagramStateFile: path.join(cacheDir, 'diagrams.json'),
    syncBaselineFile: path.join(cacheDir, 'sync.json'),
  };
}
