import type { ActionKind, Workflow } from '../../shared/types';
import { lintWorkflow } from '../../shared/workflowLint';

const autoAppendAllowedActions = new Set<ActionKind>(['append-csv', 'xlsx']);
const highRiskActions = new Set<ActionKind>(['local-script', 'keyboard-mouse']);
const knownActionKinds = new Set<ActionKind>(['append-csv', 'xlsx', 'clipboard', 'webhook', 'local-script', 'keyboard-mouse']);

export interface WorkflowSafetyResult {
  ok: boolean;
  issues: string[];
}

export function validateWorkflowSafety(workflow: Workflow): WorkflowSafetyResult {
  const issues: string[] = [];
  const actionKind = getActionKind(workflow);

  if (!knownActionKinds.has(actionKind)) {
    issues.push(`Unknown action kind "${actionKind}".`);
  }

  if (workflow.autoAppend && !autoAppendAllowedActions.has(actionKind)) {
    issues.push(`Auto-append is only allowed for low-risk actions. "${actionKind}" requires review.`);
  }

  if (workflow.autoAppend && highRiskActions.has(actionKind)) {
    issues.push(`High-risk action "${actionKind}" cannot run automatically in v0.`);
  }

  for (const diagnostic of lintWorkflow(workflow)) {
    if (diagnostic.severity === 'error') {
      issues.push(`${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function assertWorkflowsSafe(workflows: Workflow[]): void {
  const issues = workflows.flatMap((workflow) =>
    validateWorkflowSafety(workflow).issues.map((issue) => `${workflow.name}: ${issue}`)
  );
  if (issues.length) {
    throw new Error(issues.join(' '));
  }
}

export function getActionKind(workflow: Workflow): ActionKind {
  const actionNode = workflow.nodes.find((node) => node.type === 'action');
  const rawKind = actionNode?.config.kind;
  return typeof rawKind === 'string' ? (rawKind as ActionKind) : 'append-csv';
}
