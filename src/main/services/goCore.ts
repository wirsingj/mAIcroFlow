import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtractionResult } from '../../shared/types';
import { repoRoot } from './paths';

export async function extractFishingWithGoCore(manualText: string): Promise<ExtractionResult | null> {
  return runGoCore<ExtractionResult>(['extract-fishing'], manualText);
}

async function runGoCore<T>(args: string[], input: string): Promise<T | null> {
  const root = repoRoot();
  if (!existsSync(join(root, 'go.mod'))) {
    return null;
  }

  return new Promise((resolve) => {
    const child = spawn('go', ['run', './cmd/maicroflow-core', '--', ...args], {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch {
        resolve(null);
      }
    });

    child.stdin.end(input);
  });
}
