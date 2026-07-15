import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppSettings, Workflow } from '../../shared/types';
import { validateWorkflows } from '../../shared/workflowSchema';
import { defaultSettings } from './defaults';
import { dataPath } from './paths';

export async function ensureDataFiles(): Promise<void> {
  await mkdir(dataPath('captures'), { recursive: true });
  await mkdir(dataPath('examples'), { recursive: true });
  await ensureJson(dataPath('workflows.json'), []);
  await ensureJson(dataPath('settings.json'), defaultSettings);
}

export async function loadWorkflows(): Promise<Workflow[]> {
  await ensureDataFiles();
  const raw = await readFile(dataPath('workflows.json'), 'utf8');
  return validateWorkflows(JSON.parse(raw));
}

export async function saveWorkflows(workflows: Workflow[]): Promise<void> {
  await writeJson(dataPath('workflows.json'), validateWorkflows(workflows));
}

export async function loadSettings(): Promise<AppSettings> {
  await ensureDataFiles();
  const raw = await readFile(dataPath('settings.json'), 'utf8');
  const parsed = JSON.parse(raw) as Partial<AppSettings>;
  return {
    ...defaultSettings,
    ...parsed,
    ai: { ...defaultSettings.ai, ...parsed.ai },
    capture: { ...defaultSettings.capture, ...parsed.capture },
    safety: { ...defaultSettings.safety, ...parsed.safety }
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJson(dataPath('settings.json'), settings);
}

async function ensureJson(path: string, fallback: unknown): Promise<void> {
  try {
    await readFile(path, 'utf8');
  } catch {
    await writeJson(path, fallback);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
