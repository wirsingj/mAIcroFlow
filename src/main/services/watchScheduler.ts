import type { CaptureMetadata, WorkflowRunResult } from '../../shared/types';
import { captureOptionsFromWorkflow, captureWatchSample } from './capture';
import { log } from './logger';
import { detectWorkflowTriggerScreen } from './ollama';
import { loadWorkflows } from './persistence';
import { cooldownAllowsRun } from './runnerState';
import { logRun } from './runLog';
import {
  deleteWatchSample,
  applyDetectionConfidenceGate,
  handleWatchDetectionOutcome,
  hashSampleFile,
  isWorkflowWatchable,
  workflowDetectionConfidenceMinimum,
  WatchArmBaselines,
  RecentSampleHashes,
  WatchTickLock
} from './watchMode';

export type ExecuteWorkflowFromWatch = (workflowId: string, capture?: CaptureMetadata) => Promise<WorkflowRunResult>;

const watchSampleTtlMs = 60_000;

export class WatchScheduler {
  private readonly detectionTimers = new Map<string, NodeJS.Timeout>();
  private readonly watchLocks = new WatchTickLock();
  private readonly recentWatchHashes = new RecentSampleHashes();
  private readonly armBaselines = new WatchArmBaselines();

  constructor(private readonly executeWorkflow: ExecuteWorkflowFromWatch) {}

  refresh(workflows: Awaited<ReturnType<typeof loadWorkflows>>): void {
    this.stopAll();
    const watchableWorkflows = workflows.filter(isWorkflowWatchable);
    this.armBaselines.resetFor(watchableWorkflows.map((workflow) => workflow.id));

    for (const workflow of watchableWorkflows) {
      const intervalSeconds = workflow.trigger.detectionIntervalSeconds ?? 5;
      const timer = setInterval(() => {
        void this.runDetectionTick(workflow.id).catch((error) =>
          log({
            level: 'error',
            scope: 'detection',
            message: 'Detection tick failed',
            details: { workflowId: workflow.id, error: error instanceof Error ? error.message : String(error) }
          })
        );
      }, intervalSeconds * 1000);
      this.detectionTimers.set(workflow.id, timer);
      setTimeout(() => {
        if (this.detectionTimers.get(workflow.id) === timer) {
          void this.runDetectionTick(workflow.id).catch((error) =>
            log({
              level: 'error',
              scope: 'detection',
              message: 'Initial detection tick failed',
              details: { workflowId: workflow.id, error: error instanceof Error ? error.message : String(error) }
            })
          );
        }
      }, 500);
    }
  }

  stopAll(): void {
    for (const timer of this.detectionTimers.values()) {
      clearInterval(timer);
    }
    this.detectionTimers.clear();
  }

  async runDetectionTick(workflowId: string): Promise<void> {
    const workflows = await loadWorkflows();
    const workflow = workflows.find((item) => item.id === workflowId);
    if (!workflow || !isWorkflowWatchable(workflow)) {
      return;
    }
    const cooldown = workflow.trigger.detectionCooldownSeconds ?? 10;
    if (!cooldownAllowsRun(workflow.lastSuccessfulAppend, cooldown)) {
      return;
    }
    if (!this.watchLocks.tryStart(workflowId)) {
      await logRun(`detect-${Date.now()}`, 'warn', 'detection', 'watch_tick_skipped_detection_in_progress', { workflowId });
      return;
    }

    const runId = `detect-${Date.now()}`;
    let samplePath = '';
    let ttlTimer: NodeJS.Timeout | null = null;
    try {
      const sample = await captureWatchSample(captureOptionsFromWorkflow(workflow));
      samplePath = sample.path;
      ttlTimer = setTimeout(() => {
        void deleteWatchSample(sample.path);
      }, watchSampleTtlMs);
      await logRun(runId, 'info', 'watch', 'sample_created', {
        workflowId,
        path: sample.path,
        sourceName: sample.sourceName,
        sourceKind: sample.sourceKind,
        region: sample.region,
        ttl_ms: watchSampleTtlMs
      });

      const sampleHash = await hashSampleFile(sample.path);
      const baselineDecision = this.armBaselines.compare(workflowId, sampleHash);
      if (baselineDecision !== 'changed') {
        await deleteWatchSample(sample.path);
        await logRun(runId, 'info', 'watch', baselineDecision, {
          workflowId,
          hash: sampleHash,
          reason:
            baselineDecision === 'baseline_recorded'
              ? 'Watch mode records the current screen after arming and waits for a later screen change.'
              : 'Current screen still matches the arm-time baseline.'
        });
        await logRun(runId, 'info', 'watch', 'sample_deleted', { workflowId, path: sample.path });
        return;
      }

      if (workflow.trigger.duplicateDetectionEnabled !== false && this.recentWatchHashes.has(workflowId, sampleHash)) {
        await deleteWatchSample(sample.path);
        await logRun(runId, 'info', 'watch', 'duplicate_sample_skipped', { workflowId, hash: sampleHash });
        await logRun(runId, 'info', 'watch', 'sample_deleted', { workflowId, path: sample.path });
        return;
      }

      const rawDetection = await detectWorkflowTriggerScreen(sample.path, workflow);
      const confidenceGate = applyDetectionConfidenceGate(rawDetection, workflowDetectionConfidenceMinimum(workflow));
      const detection = confidenceGate.detection;
      await logRun(runId, 'info', 'detection', detection.match ? 'detection_match' : 'detection_no_match', {
        workflowId,
        reason: detection.reason,
        confidence: detection.confidence,
        confidenceBlocked: confidenceGate.blocked,
        matchedReferences: detection.matchedReferences,
        configuredReferences: detection.configuredReferences,
        loadedReferences: detection.loadedReferences,
        missingReferences: detection.missingReferences,
        referenceScores: detection.referenceScores,
        sampleMode: sample.mode,
        sampleWidth: sample.width,
        sampleHeight: sample.height,
        region: sample.region
      });

      const outcome = await handleWatchDetectionOutcome(sample.path, detection, async () => {
        this.recentWatchHashes.remember(workflowId, sampleHash);
        await logRun(runId, 'info', 'watch', 'matched_sample_used_for_run', { workflowId, samplePath: sample.path });
        await this.executeWorkflow(workflowId, sample);
      });

      if (!detection.match) {
        await logRun(runId, 'info', 'watch', 'detection_no_match_deleted', { workflowId, path: sample.path });
      } else {
        await logRun(runId, 'info', 'watch', 'sample_deleted', { workflowId, path: sample.path });
      }

      if (!outcome.sampleDeleted) {
        await logRun(runId, 'warn', 'watch', 'sample_delete_failed', { workflowId, path: sample.path });
      }
    } finally {
      if (ttlTimer) {
        clearTimeout(ttlTimer);
      }
      if (samplePath) {
        await deleteWatchSample(samplePath);
      }
      this.watchLocks.finish(workflowId);
    }
  }
}
