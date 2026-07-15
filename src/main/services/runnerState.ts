import type { Workflow, WorkflowRunnerState } from '../../shared/types';

const allowedTransitions: Record<WorkflowRunnerState, WorkflowRunnerState[]> = {
  inactive: ['armed'],
  armed: ['inactive', 'running', 'failed'],
  running: ['armed', 'needs_review', 'failed'],
  needs_review: ['armed', 'failed'],
  failed: ['armed', 'inactive']
};

export function armedStateFor(workflow: Workflow): WorkflowRunnerState {
  return workflow.status === 'active' ? 'armed' : 'inactive';
}

export function canStartRun(workflow: Workflow): boolean {
  return workflow.status === 'active' && (workflow.runnerState ?? armedStateFor(workflow)) === 'armed';
}

export function canStartManualRun(workflow: Workflow): boolean {
  const state = workflow.runnerState ?? armedStateFor(workflow);
  return state !== 'running' && state !== 'needs_review';
}

export function markWorkflowState(
  workflows: Workflow[],
  workflowId: string,
  patch: Partial<Workflow>
): Workflow[] {
  return workflows.map((workflow) => (workflow.id === workflowId ? { ...workflow, ...patch } : workflow));
}

export function transitionRunnerState(workflow: Workflow, nextState: WorkflowRunnerState): Workflow {
  const currentState = workflow.runnerState ?? armedStateFor(workflow);
  if (currentState === nextState) {
    return { ...workflow, runnerState: nextState };
  }
  if (!allowedTransitions[currentState].includes(nextState)) {
    throw new Error(`Invalid workflow state transition: ${currentState} -> ${nextState}.`);
  }
  return { ...workflow, runnerState: nextState };
}

export function cooldownAllowsRun(lastSuccessfulAppend: string | undefined, cooldownSeconds: number, now = Date.now()): boolean {
  if (!lastSuccessfulAppend) {
    return true;
  }
  const last = new Date(lastSuccessfulAppend).getTime();
  if (!Number.isFinite(last)) {
    return true;
  }
  return now - last >= cooldownSeconds * 1000;
}
