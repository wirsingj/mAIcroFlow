import type { Workflow, WorkflowNodeType } from './types';

const runnableRequirements: Array<{ type: WorkflowNodeType; label: string }> = [
  { type: 'trigger', label: 'a trigger step' },
  { type: 'capture', label: 'a Screen Grab step' },
  { type: 'extract', label: 'an AI Extract step' },
  { type: 'action', label: 'a CSV/XLSX Output step' }
];

export function workflowRunReadinessIssues(workflow: Workflow): string[] {
  const nodeTypes = new Set(workflow.nodes.map((node) => node.type));
  const issues = runnableRequirements
    .filter((requirement) => !nodeTypes.has(requirement.type))
    .map((requirement) => `Add ${requirement.label}.`);

  if (isVisualTriggerKind(workflow.trigger.kind)) {
    const triggerNode = workflow.nodes.find((node) => node.type === 'trigger');
    const refs = triggerNode?.config.exampleRefs;
    if (workflow.trigger.kind !== 'region-visible' && (!Array.isArray(refs) || refs.length === 0)) {
      issues.push('Add a trigger screenshot to the When step.');
    }

    if (workflow.trigger.kind === 'region-visible') {
      const captureNode = workflow.nodes.find((node) => node.type === 'capture');
      if (captureNode?.config.mode !== 'region' || !hasPositiveCaptureRegion(captureNode.config.region)) {
        issues.push('Set a capture rectangle for the region-visible trigger.');
      }
    }
  }

  return issues;
}

export function isVisualTriggerKind(kind: Workflow['trigger']['kind']): boolean {
  return kind === 'screen-detection' || kind === 'reference-image' || kind === 'region-visible';
}

export function workflowCanRun(workflow: Workflow): boolean {
  return workflowRunReadinessIssues(workflow).length === 0;
}

export function normalizeWorkflowLifecycleForSave(workflow: Workflow): Workflow {
  if (!workflowCanRun(workflow)) {
    return {
      ...workflow,
      status: 'paused',
      runnerState: 'inactive',
      lastRunStatus: workflow.lastRunStatus === 'running' ? 'draft' : workflow.lastRunStatus
    };
  }

  return {
    ...workflow,
    runnerState: workflow.status === 'active' ? 'armed' : 'inactive'
  };
}

function hasPositiveCaptureRegion(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const region = value as Record<string, unknown>;
  const width = Number(region.width);
  const height = Number(region.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}
