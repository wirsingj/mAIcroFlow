import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppLogEntry } from '../../shared/types';
import { dataPath } from './paths';

const maxUiLogLines = 250;

export async function log(entry: Omit<AppLogEntry, 'timestamp'>): Promise<void> {
  const fullEntry: AppLogEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };

  const logPath = dataPath('app.log');
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(fullEntry)}\n`, 'utf8');
}

export async function readLogs(): Promise<AppLogEntry[]> {
  try {
    const content = await readFile(dataPath('app.log'), 'utf8');
    return content
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxUiLogLines)
      .map((line) => JSON.parse(line) as AppLogEntry)
      .reverse();
  } catch {
    return [];
  }
}
