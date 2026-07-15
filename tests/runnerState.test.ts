import { describe, expect, it } from 'vitest';
import type { Workflow } from '../src/shared/types';
import { armedStateFor, canStartRun, cooldownAllowsRun, markWorkflowState, transitionRunnerState } from '../src/main/services/runnerState';

const workflow: Workflow = {
  id: 'demo',
  name: 'Demo',
  status: 'active',
  runnerState: 'armed',
  trigger: { kind: 'hotkey', summary: 'F12', hotkey: 'F12' },
  nodes: [
    { id: 't', type: 'trigger', title: 'Trigger', summary: 'F12', config: {} },
    { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: {} },
    { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
    { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
    { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
    { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
  ]
};

describe('runner state', () => {
  it('active workflow stays armed after successful run state patch', () => {
    const [patched] = markWorkflowState([workflow], 'demo', { runnerState: 'armed', lastRunStatus: 'appended' });

    expect(patched.runnerState).toBe('armed');
    expect(armedStateFor(patched)).toBe('armed');
  });

  it('prevents overlapping run corruption while running or awaiting review', () => {
    expect(canStartRun({ ...workflow, runnerState: 'armed' })).toBe(true);
    expect(canStartRun({ ...workflow, runnerState: 'running' })).toBe(false);
    expect(canStartRun({ ...workflow, runnerState: 'needs_review' })).toBe(false);
    expect(canStartRun({ ...workflow, runnerState: 'failed' })).toBe(false);
  });

  it('keeps runner transitions explicit', () => {
    expect(transitionRunnerState(workflow, 'running').runnerState).toBe('running');
    expect(() => transitionRunnerState({ ...workflow, runnerState: 'needs_review' }, 'running')).toThrow(/Invalid/);
  });

  it('detection mode respects cooldown after successful append', () => {
    const now = new Date('2026-05-11T12:00:10Z').getTime();

    expect(cooldownAllowsRun('2026-05-11T12:00:05Z', 10, now)).toBe(false);
    expect(cooldownAllowsRun('2026-05-11T12:00:00Z', 10, now)).toBe(true);
  });
});
