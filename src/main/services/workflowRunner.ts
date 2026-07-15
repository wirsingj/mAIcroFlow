import { app } from 'electron';
import { isAbsolute, join } from 'node:path';
import type {
  ActionKind,
  CaptureMetadata,
  ExtractionResult,
  Workflow,
  WorkflowRunPreview,
  WorkflowRunProgress,
  WorkflowRunProgressStatus,
  WorkflowRunStage,
  WorkflowRunResult,
  WorkflowRunTrace
} from '../../shared/types';
import { workflowRunReadinessIssues } from '../../shared/workflowReadiness';
import { captureFullScreen, captureOptionsFromWorkflow, deleteCaptureArtifact } from './capture';
import { extractFishingResult, normalizeExtraction } from './extractor';
import { extractFishingWithGoCore } from './goCore';
import { extractScreenshotWithOllamaVision } from './ollama';
import { loadWorkflows, saveWorkflows } from './persistence';
import { armedStateFor, canStartManualRun, canStartRun, markWorkflowState } from './runnerState';
import { logRun } from './runLog';
import { firstUsefulFieldLabel, includesLegacyFishingFields, toStructuredExtraction, toStructuredObservation } from './structuredExtraction';
import { executeWorkflowAction, validateWorkflowExtraction } from './workflowHandlers';
import { lintWorkflow } from '../../shared/workflowLint';

export interface ExecuteWorkflowOptions {
  source: 'manual' | 'hotkey' | 'detection';
  manualText?: string;
  forceReview?: boolean;
  focusOnReview?: boolean;
  capture?: CaptureMetadata;
}

export interface WorkflowRunnerEvents {
  onPreviewReady: (preview: WorkflowRunPreview, focus: boolean) => void;
  onAutoRunComplete: (workflowId: string) => void;
  onProgress: (progress: WorkflowRunProgress) => void;
}

export class WorkflowRunner {
  private readonly pendingRuns = new Map<string, WorkflowRunPreview>();

  constructor(private readonly events: WorkflowRunnerEvents) {}

  runWorkflow(workflowId: string, manualText = ''): Promise<WorkflowRunResult> {
    return this.executeWorkflow(workflowId, {
      source: 'manual',
      manualText,
      focusOnReview: true
    });
  }

  async executeWorkflow(workflowId: string, options: ExecuteWorkflowOptions): Promise<WorkflowRunResult> {
    const workflows = await loadWorkflows();
    const workflow = workflows.find((item) => item.id === workflowId);
    const runId = `run-${Date.now()}`;
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} was not found.`);
    }
    if (options.source !== 'manual' && workflow.status !== 'active') {
      throw new Error(`Workflow "${workflow.name}" is ${workflow.status}. Resume it before running.`);
    }
    const canStart = options.source === 'manual' ? canStartManualRun(workflow) : canStartRun(workflow);
    if (!canStart) {
      this.emitProgress(runId, workflowId, 'ignored', 'skipped', 'Workflow is already busy or awaiting review.');
      await logRun(runId, 'warn', 'trigger', 'Ignored trigger because workflow is already busy or awaiting review', {
        workflowId,
        state: workflow.runnerState
      });
      return { ignored: true, message: 'Workflow is already busy or awaiting review.' };
    }

    const readinessIssues = workflowRunReadinessIssues(workflow);
    if (readinessIssues.length > 0) {
      this.emitProgress(runId, workflowId, 'ignored', 'blocked', 'Macro is not ready to run.', { issues: readinessIssues });
      await logRun(runId, 'warn', 'workflow', 'Run blocked because macro is incomplete', {
        workflowId,
        issues: readinessIssues
      });
      await saveWorkflows(markWorkflowState(workflows, workflowId, {
        runnerState: armedStateFor(workflow),
        lastRunStatus: 'not ready',
        lastResult: readinessIssues.join(' ')
      }));
      return { ignored: true, message: readinessIssues.join(' ') };
    }

    const blockingDiagnostics = lintWorkflow(workflow).filter((diagnostic) => diagnostic.severity === 'error');
    if (blockingDiagnostics.length > 0) {
      const issues = blockingDiagnostics.map((diagnostic) => diagnostic.message);
      this.emitProgress(runId, workflowId, 'ignored', 'blocked', 'Macro is blocked by configuration errors.', { issues });
      await logRun(runId, 'warn', 'workflow', 'Run blocked by workflow diagnostics', {
        workflowId,
        issues
      });
      await saveWorkflows(markWorkflowState(workflows, workflowId, {
        runnerState: armedStateFor(workflow),
        lastRunStatus: 'blocked',
        lastResult: issues.join(' ')
      }));
      return { ignored: true, message: issues.join(' ') };
    }

    this.emitProgress(runId, workflowId, 'queued', 'running', `Starting "${workflow.name}".`);
    await saveWorkflows(markWorkflowState(workflows, workflowId, {
      runnerState: 'running',
      lastRunStatus: 'running',
      lastRun: new Date().toISOString()
    }));

    try {
      await logRun(runId, 'info', 'trigger', `Trigger received from ${options.source}`, { workflowId });
      const trace: WorkflowRunTrace = {
        runId,
        trigger: {
          source: options.source,
          receivedAt: new Date().toISOString()
        }
      };
      this.emitProgress(runId, workflowId, 'capture', 'running', 'Capturing visible screen pixels.');
      const capture = options.capture ?? (await captureFullScreen(captureOptionsFromWorkflow(workflow)));
      this.emitProgress(runId, workflowId, 'capture', 'complete', 'Screen captured.');
      await logRun(runId, 'info', 'capture', 'run_capture_created', {
        workflowId,
        path: capture.path,
        mode: capture.mode,
        sourceName: capture.sourceName,
        sourceKind: capture.sourceKind,
        region: capture.region
      });

      this.emitProgress(runId, workflowId, 'extract', 'running', 'Reading the capture with local vision.');
      await logRun(runId, 'info', 'extractor', 'Extraction started', { workflowId });
      const extraction = await this.extractWorkflowData(workflow, capture.path, options.manualText ?? '', runId);
      this.emitProgress(runId, workflowId, 'extract', 'complete', extraction.notes.includes('Deterministic fallback') ? 'Used fallback extraction.' : 'Fields extracted.');
      const observation = toStructuredObservation(extraction, capture, runId);
      trace.observation = observation;
      await logRun(runId, 'info', 'extractor', 'Extraction completed', {
        workflowId,
        confidence: extraction.confidence,
        observation
      });
      const captureDeleted = await deleteCaptureArtifact(capture.path);
      await logRun(runId, captureDeleted ? 'info' : 'warn', 'capture', captureDeleted ? 'run_capture_deleted' : 'run_capture_delete_failed', {
        workflowId,
        path: capture.path
      });

      const validation = validateWorkflowExtraction(workflow, extraction);
      this.emitProgress(
        runId,
        workflowId,
        'validate',
        validation.ok ? 'complete' : 'blocked',
        validation.ok ? 'Validation passed.' : 'Validation needs review.',
        { issues: validation.issues }
      );
      trace.validation = {
        ok: validation.ok,
        issues: validation.issues
      };
      await logRun(runId, validation.ok ? 'info' : 'warn', 'validation', validation.ok ? 'Validation passed' : 'Validation failed', {
        workflowId,
        issues: validation.issues
      });

      const outputPath = resolveWorkflowOutputPath(workflow);
      trace.action = {
        kind: actionKindForWorkflow(workflow),
        outputPath,
        status: !validation.ok || !workflow.autoAppend || options.forceReview ? 'pending_review' : 'success'
      };
      const preview: WorkflowRunPreview = {
        runId,
        workflowId,
        workflowName: workflow.name,
        createdAt: new Date().toISOString(),
        screenshotPath: 'deleted_after_extraction',
        outputPath,
        extraction: validation.result,
        structuredExtraction: toStructuredExtraction(validation.result),
        observation,
        trace,
        capture,
        validationIssues: validation.issues
      };

      if (!validation.ok || !workflow.autoAppend || options.forceReview) {
        this.emitProgress(
          runId,
          workflowId,
          'review',
          'blocked',
          validation.ok ? 'Waiting for review before writing output.' : 'Review required before output.',
          { outputPath, issues: validation.issues }
        );
        this.pendingRuns.set(runId, preview);
        await saveWorkflows(markWorkflowState(await loadWorkflows(), workflowId, {
          runnerState: 'needs_review',
          lastRunStatus: validation.ok ? 'review required' : 'needs_review',
          lastResult: validation.ok
            ? `Awaiting review (${Math.round(validation.result.confidence * 100)}% confidence)`
            : `Needs review: ${validation.issues.join(' ')}`
        }));
        await logRun(runId, 'info', 'workflow', validation.ok ? 'Review required' : 'Marked needs_review', {
          workflowId,
          autoAppend: Boolean(workflow.autoAppend)
        });
        this.events.onPreviewReady(preview, Boolean(options.focusOnReview));
        return { preview };
      }

      this.emitProgress(runId, workflowId, 'action', 'running', actionProgressMessage(outputPath, 'running'), { outputPath });
      await logRun(runId, 'info', 'action', 'Auto-action enabled; running configured output action', { workflowId, outputPath });
      await this.appendValidatedRun(preview, validation.result);
      this.emitProgress(runId, workflowId, 'action', 'complete', actionProgressMessage(outputPath, 'complete'), { outputPath });
      await saveWorkflows(markWorkflowState(await loadWorkflows(), workflowId, {
        runnerState: armedStateFor(workflow),
        lastRunStatus: actionStatusLabel(outputPath),
        lastSuccessfulAppend: new Date().toISOString(),
        lastResult: actionResultLabel(outputPath, validation.result)
      }));
      await logRun(runId, 'info', 'workflow', 'Workflow re-armed', { workflowId });
      this.emitProgress(runId, workflowId, 'done', 'complete', 'Run complete.', { outputPath });
      this.events.onAutoRunComplete(workflowId);
      return { appended: true, outputPath };
    } catch (error) {
      this.emitProgress(runId, workflowId, 'failed', 'failed', error instanceof Error ? error.message : String(error));
      await saveWorkflows(markWorkflowState(await loadWorkflows(), workflowId, {
        runnerState: 'failed',
        lastRunStatus: 'failed',
        lastResult: error instanceof Error ? error.message : String(error)
      }));
      await logRun(runId, 'error', 'workflow', 'Workflow run failed', {
        workflowId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async confirmWorkflowRun(runId: string, extraction: ExtractionResult): Promise<void> {
    const preview = this.pendingRuns.get(runId);
    if (!preview) {
      throw new Error('This run is no longer pending.');
    }

    const validation = validateWorkflowExtraction({ id: preview.workflowId } as Workflow, extraction);
    await logRun(runId, validation.ok ? 'info' : 'warn', 'validation', validation.ok ? 'Validation passed' : 'Validation failed', {
      workflowId: preview.workflowId,
      issues: validation.issues
    });
    if (!validation.ok) {
      throw new Error(`Validation failed: ${validation.issues.join(' ')}`);
    }

    await this.appendValidatedRun(preview, validation.result);
    this.emitProgress(runId, preview.workflowId, 'action', 'complete', actionProgressMessage(preview.outputPath, 'reviewed'), { outputPath: preview.outputPath });
    this.pendingRuns.delete(runId);

    const now = new Date().toISOString();
    const workflows = await loadWorkflows();
    const workflow = workflows.find((item) => item.id === preview.workflowId);
    await saveWorkflows(markWorkflowState(workflows, preview.workflowId, {
      runnerState: workflow ? armedStateFor(workflow) : 'inactive',
      lastRunStatus: actionStatusLabel(preview.outputPath),
      lastSuccessfulAppend: now,
      lastRun: now,
      lastResult: actionResultLabel(preview.outputPath, validation.result)
    }));
    await logRun(runId, 'info', 'workflow', 'Workflow re-armed', { workflowId: preview.workflowId });
    this.emitProgress(runId, preview.workflowId, 'done', 'complete', 'Review complete.', { outputPath: preview.outputPath });
  }

  async cancelWorkflowRun(runId: string): Promise<void> {
    const preview = this.pendingRuns.get(runId);
    this.pendingRuns.delete(runId);
    if (preview) {
      const workflows = await loadWorkflows();
      const workflow = workflows.find((item) => item.id === preview.workflowId);
      await saveWorkflows(markWorkflowState(workflows, preview.workflowId, {
        runnerState: workflow ? armedStateFor(workflow) : 'inactive',
        lastRunStatus: 'review canceled',
        lastResult: 'Review canceled'
      }));
      await logRun(runId, 'info', 'workflow', 'Canceled pending workflow run; workflow re-armed', {
        workflowId: preview.workflowId
      });
      this.emitProgress(runId, preview.workflowId, 'review', 'skipped', 'Review canceled. Nothing was written.');
    }
  }

  private async extractWorkflowData(
    workflow: Workflow,
    screenshotPath: string,
    hints: string,
    runId: string
  ): Promise<ExtractionResult> {
    try {
      const aiExtraction = await extractScreenshotWithOllamaVision(screenshotPath, workflow, hints);
      if (aiExtraction) {
        await logRun(runId, 'info', 'extractor', 'Extracted data with local Ollama vision', {
          workflowId: workflow.id,
          model: aiExtraction.model
        });
        return aiExtraction.result;
      }
      await logRun(runId, 'warn', 'extractor', 'Local Ollama vision did not return usable structured data; using deterministic fallback', {
        workflowId: workflow.id
      });
    } catch (error) {
      await logRun(runId, 'warn', 'extractor', 'Local Ollama vision extraction failed; using deterministic fallback', {
        workflowId: workflow.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return fallbackExtractionForWorkflow(workflow, hints);
  }

  private async appendValidatedRun(preview: WorkflowRunPreview, extraction: ExtractionResult): Promise<void> {
    const workflows = await loadWorkflows();
    const workflow = workflows.find((item) => item.id === preview.workflowId);
    const actionResult = await executeWorkflowAction(workflow, preview, extraction);
    await logRun(preview.runId, 'info', 'action', actionResult.message ?? 'Output append result: success', {
      workflowId: preview.workflowId,
      outputPath: preview.outputPath
    });
    if (actionResult.summaryUpdated) {
      await logRun(preview.runId, 'info', 'action', 'Summary block updated', {
        workflowId: preview.workflowId,
        outputPath: preview.outputPath
      });
    }
  }

  private emitProgress(
    runId: string,
    workflowId: string,
    stage: WorkflowRunStage,
    status: WorkflowRunProgressStatus,
    message: string,
    extras: Pick<WorkflowRunProgress, 'outputPath' | 'issues'> = {}
  ): void {
    this.events.onProgress({
      runId,
      workflowId,
      stage,
      status,
      message,
      updatedAt: new Date().toISOString(),
      ...extras
    });
  }
}

export function resolveWorkflowOutputPath(workflow: Workflow): string {
  const actionNode = workflow.nodes.find((node) => node.type === 'action');
  const config = actionNode?.config ?? {};
  const directPath = stringConfig(config.path);
  if (directPath) {
    return isAbsolute(directPath) ? directPath : join(process.cwd(), directPath);
  }

  const actionKind = stringConfig(config.kind);
  if (actionKind === 'clipboard') {
    return 'clipboard';
  }

  const outputDirectory = stringConfig(config.outputDirectory) || join(app.getPath('documents'), 'mAIcroFlow', 'output');
  const defaultExtension = actionKind === 'xlsx' ? '.xlsx' : '.csv';
  const fileName = sanitizeFileName(stringConfig(config.fileName) || `${workflow.name}${defaultExtension}`, defaultExtension);
  return join(outputDirectory, fileName);
}

async function fallbackExtractionForWorkflow(workflow: Workflow, hints: string): Promise<ExtractionResult> {
  const fields = requestedExtractionFields(workflow);
  const legacyFishingRequested = includesLegacyFishingFields(fields);

  if (legacyFishingRequested) {
    const fallback = (await extractFishingWithGoCore(hints)) ?? extractFishingResult(hints);
    return {
      ...fallback,
      notes:
        'Local Ollama vision was unavailable, missing a vision-capable model, or returned unusable JSON. Deterministic fallback produced this editable preview.'
    };
  }

  const fieldMap = Object.fromEntries(fields.map((field) => [field, '']));
  return normalizeExtraction({
    fields: fieldMap,
    rawFields: fieldMap,
    confidence: 0,
    notes:
      'Local Ollama vision was unavailable, missing a vision-capable model, or returned unusable JSON. No generic deterministic extractor is configured for this macro yet.'
  });
}

function requestedExtractionFields(workflow: Workflow): string[] {
  const extractNode = workflow.nodes.find((node) => node.type === 'extract');
  const rawFields = extractNode?.config.fields;
  if (Array.isArray(rawFields)) {
    return rawFields.map((field) => String(field).trim()).filter(Boolean);
  }
  if (typeof rawFields === 'string') {
    return rawFields
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
  }
  return ['value'];
}

function stringConfig(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actionKindForWorkflow(workflow: Workflow): ActionKind | 'unknown' {
  const rawKind = workflow.nodes.find((node) => node.type === 'action')?.config.kind;
  if (typeof rawKind === 'string') {
    return rawKind as ActionKind;
  }
  return 'unknown';
}

function actionProgressMessage(outputPath: string, state: 'running' | 'complete' | 'reviewed'): string {
  if (outputPath === 'clipboard') {
    return state === 'running' ? 'Copying structured fields to clipboard.' : 'Structured fields copied to clipboard.';
  }
  return state === 'running' ? 'Writing output row.' : state === 'reviewed' ? 'Reviewed row written.' : 'Output row written.';
}

function actionStatusLabel(outputPath: string): string {
  return outputPath === 'clipboard' ? 'copied' : 'appended';
}

function actionResultLabel(outputPath: string, extraction: ExtractionResult): string {
  const label = firstUsefulFieldLabel(extraction);
  return outputPath === 'clipboard' ? `Copied ${label}` : `Saved ${label}`;
}

function sanitizeFileName(value: string, defaultExtension = '.csv'): string {
  const sanitized = value.replace(/[<>:"/\\|?*]+/g, '_').trim();
  return /\.[a-z0-9]+$/i.test(sanitized) ? sanitized : `${sanitized || 'workflow_output'}${defaultExtension}`;
}
