import { app } from 'electron';
import { join } from 'node:path';

export function repoRoot(): string {
  if (app?.isPackaged) {
    return app.getPath('userData');
  }
  return process.cwd();
}

export function dataPath(...parts: string[]): string {
  return join(repoRoot(), 'data', ...parts);
}
