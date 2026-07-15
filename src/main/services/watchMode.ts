import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import type { Workflow } from '../../shared/types';
import { isVisualTriggerKind, workflowCanRun } from '../../shared/workflowReadiness';
import { workflowHasBlockingDiagnostics } from '../../shared/workflowLint';
import type { DetectionResult } from './ollama';

export interface WatchDetectionOutcome {
  matched: boolean;
  sampleDeleted: boolean;
}

export interface DetectionGateResult {
  detection: DetectionResult;
  blocked: boolean;
}

export class RecentSampleHashes {
  private readonly hashes = new Map<string, Map<string, number>>();

  constructor(private readonly retentionMs = 3 * 60 * 1000) {}

  has(workflowId: string, hash: string, now = Date.now()): boolean {
    this.prune(workflowId, now);
    return this.hashes.get(workflowId)?.has(hash) ?? false;
  }

  remember(workflowId: string, hash: string, now = Date.now()): void {
    this.prune(workflowId, now);
    const workflowHashes = this.hashes.get(workflowId) ?? new Map<string, number>();
    workflowHashes.set(hash, now);
    this.hashes.set(workflowId, workflowHashes);
  }

  private prune(workflowId: string, now: number): void {
    const workflowHashes = this.hashes.get(workflowId);
    if (!workflowHashes) {
      return;
    }
    for (const [hash, timestamp] of workflowHashes.entries()) {
      if (now - timestamp > this.retentionMs) {
        workflowHashes.delete(hash);
      }
    }
  }
}

export class WatchTickLock {
  private readonly running = new Set<string>();

  tryStart(workflowId: string): boolean {
    if (this.running.has(workflowId)) {
      return false;
    }
    this.running.add(workflowId);
    return true;
  }

  finish(workflowId: string): void {
    this.running.delete(workflowId);
  }
}

export type WatchBaselineDecision = 'baseline_recorded' | 'baseline_unchanged' | 'changed';

export class WatchArmBaselines {
  private readonly baselineHashes = new Map<string, string>();

  resetFor(workflowIds: Iterable<string>): void {
    const ids = new Set(workflowIds);
    for (const workflowId of this.baselineHashes.keys()) {
      if (!ids.has(workflowId)) {
        this.baselineHashes.delete(workflowId);
      }
    }
    for (const workflowId of ids) {
      this.baselineHashes.delete(workflowId);
    }
  }

  compare(workflowId: string, hash: string): WatchBaselineDecision {
    const baselineHash = this.baselineHashes.get(workflowId);
    if (!baselineHash) {
      this.baselineHashes.set(workflowId, hash);
      return 'baseline_recorded';
    }
    if (baselineHash === hash) {
      return 'baseline_unchanged';
    }
    this.baselineHashes.delete(workflowId);
    return 'changed';
  }
}

export function isWorkflowWatchable(workflow: Workflow): boolean {
  return (
    workflow.status === 'active' &&
    workflow.runnerState === 'armed' &&
    isVisualTriggerKind(workflow.trigger.kind) &&
    workflowCanRun(workflow) &&
    !workflowHasBlockingDiagnostics(workflow)
  );
}

export function workflowDetectionConfidenceMinimum(workflow: Workflow): number | undefined {
  const triggerNode = workflow.nodes.find((node) => node.type === 'trigger');
  const value = triggerNode?.config.confidenceMinimum;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, numberValue));
}

export function applyDetectionConfidenceGate(
  detection: DetectionResult,
  confidenceMinimum: number | undefined
): DetectionGateResult {
  if (!detection.match || confidenceMinimum === undefined || detection.confidence >= confidenceMinimum) {
    return { detection, blocked: false };
  }

  return {
    blocked: true,
    detection: {
      ...detection,
      match: false,
      reason: `${detection.reason} Confidence ${Math.round(detection.confidence * 100)}% is below the ${Math.round(confidenceMinimum * 100)}% trigger minimum.`
    }
  };
}

export async function hashSampleFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function deleteWatchSample(path: string): Promise<boolean> {
  try {
    await rm(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function handleWatchDetectionOutcome(
  samplePath: string,
  detection: DetectionResult,
  onMatch: () => Promise<void>
): Promise<WatchDetectionOutcome> {
  if (detection.match) {
    await onMatch();
    const sampleDeleted = await deleteWatchSample(samplePath);
    return { matched: true, sampleDeleted };
  }

  const sampleDeleted = await deleteWatchSample(samplePath);
  return { matched: false, sampleDeleted };
}
