import { log } from './logger';

export async function logRun(
  runId: string,
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await log({ level, scope, message, details: { run_id: runId, ...details } });
}
