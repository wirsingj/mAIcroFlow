import { describe, expect, it } from 'vitest';
import { applyLiveIntentionProposalToWorkflow, hasLiveIntentionFields, liveIntentionDraftDiff } from '../src/shared/liveIntention';
import { createMacroNodeFromTemplate } from '../src/shared/macroNodeTemplates';
import type { Workflow } from '../src/shared/types';
import { normalizeWorkflowLifecycleForSave, workflowCanRun, workflowRunReadinessIssues } from '../src/shared/workflowReadiness';
import { createLiveIntentionWorkflow, createNewMacroWorkflow, createScreenToCsvWorkflow } from '../src/shared/workflowTemplates';

describe('workflow run readiness', () => {
  it('blocks execution for incomplete imported or legacy drafts', () => {
    const workflow: Workflow = {
      ...createNewMacroWorkflow(new Date('2026-05-11T12:00:00Z')),
      nodes: [createMacroNodeFromTemplate('watch-screen', new Date('2026-05-11T12:00:01Z'))]
    };

    expect(workflow.nodes.map((node) => node.type)).toEqual(['trigger']);
    expect(workflowCanRun(workflow)).toBe(false);
    expect(workflowRunReadinessIssues(workflow)).toEqual([
      'Add a Screen Grab step.',
      'Add an AI Extract step.',
      'Add a CSV/XLSX Output step.',
      'Add a trigger screenshot to the When step.'
    ]);
  });

  it('marks a linear trigger-capture-extract-output macro as runnable', () => {
    const workflow: Workflow = {
      ...createScreenToCsvWorkflow(new Date('2026-05-11T12:00:00Z')),
      nodes: [
        watchScreenWithRef(),
        createMacroNodeFromTemplate('screen-grab', new Date('2026-05-11T12:00:02Z')),
        createMacroNodeFromTemplate('ai-extract', new Date('2026-05-11T12:00:03Z')),
        createMacroNodeFromTemplate('append-csv', new Date('2026-05-11T12:00:04Z'))
      ]
    };

    expect(workflowRunReadinessIssues(workflow)).toEqual([]);
    expect(workflowCanRun(workflow)).toBe(true);
  });

  it('allows reference-image triggers when a trigger reference is configured', () => {
    const workflow: Workflow = {
      ...createScreenToCsvWorkflow(new Date('2026-05-11T12:00:00Z')),
      trigger: {
        kind: 'reference-image',
        summary: 'Watch for reference image'
      },
      nodes: [
        watchScreenWithRef(),
        createMacroNodeFromTemplate('screen-grab', new Date('2026-05-11T12:00:02Z')),
        createMacroNodeFromTemplate('ai-extract', new Date('2026-05-11T12:00:03Z')),
        createMacroNodeFromTemplate('append-csv', new Date('2026-05-11T12:00:04Z'))
      ]
    };

    expect(workflowRunReadinessIssues(workflow)).toEqual([]);
  });

  it('requires a rectangle capture for region-visible triggers', () => {
    const workflow: Workflow = {
      ...createScreenToCsvWorkflow(new Date('2026-05-11T12:00:00Z')),
      trigger: {
        kind: 'region-visible',
        summary: 'Watch for visible region'
      },
      nodes: [
        watchScreenWithRef(),
        createMacroNodeFromTemplate('screen-grab', new Date('2026-05-11T12:00:02Z')),
        createMacroNodeFromTemplate('ai-extract', new Date('2026-05-11T12:00:03Z')),
        createMacroNodeFromTemplate('append-csv', new Date('2026-05-11T12:00:04Z'))
      ]
    };

    expect(workflowRunReadinessIssues(workflow)).toContain('Set a capture rectangle for the region-visible trigger.');
    expect(
      workflowRunReadinessIssues({
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.type === 'capture'
            ? { ...node, config: { ...node.config, mode: 'region', region: { x: 0, y: 0, width: 100, height: 100 } } }
            : node
        )
      })
    ).toEqual([]);
  });

  it('does not let incomplete imported or legacy drafts persist as active or armed', () => {
    const workflow: Workflow = {
      ...createNewMacroWorkflow(new Date('2026-05-11T12:00:00Z')),
      status: 'active',
      runnerState: 'armed',
      nodes: [createMacroNodeFromTemplate('watch-screen', new Date('2026-05-11T12:00:01Z'))]
    };

    const normalized = normalizeWorkflowLifecycleForSave(workflow);

    expect(normalized.status).toBe('paused');
    expect(normalized.runnerState).toBe('inactive');
  });

  it('arms runnable workflows only when their status is active', () => {
    const workflow: Workflow = {
      ...createScreenToCsvWorkflow(new Date('2026-05-11T12:00:00Z')),
      status: 'active',
      nodes: [
        watchScreenWithRef(),
        createMacroNodeFromTemplate('screen-grab', new Date('2026-05-11T12:00:02Z')),
        createMacroNodeFromTemplate('ai-extract', new Date('2026-05-11T12:00:03Z')),
        createMacroNodeFromTemplate('append-csv', new Date('2026-05-11T12:00:04Z'))
      ]
    };

    expect(normalizeWorkflowLifecycleForSave(workflow).runnerState).toBe('armed');
    expect(normalizeWorkflowLifecycleForSave({ ...workflow, status: 'paused' }).runnerState).toBe('inactive');
  });

  it('creates a review-first live intention workflow from an explicit region', () => {
    const workflow = createLiveIntentionWorkflow(
      { displayId: 'display-1', region: { x: 10, y: 20, width: 300, height: 180 } },
      new Date('2026-05-11T12:00:00Z')
    );

    expect(workflow.name).toBe('Live Intention Flow');
    expect(workflow.autoAppend).toBe(false);
    expect(workflow.trigger.kind).toBe('region-visible');
    expect(workflow.nodes.map((node) => node.type)).toEqual(['trigger', 'capture', 'extract', 'validate', 'review', 'action']);
    expect(workflow.nodes.find((node) => node.type === 'capture')?.config).toEqual(
      expect.objectContaining({
        mode: 'region',
        source: 'display-id',
        displayId: 'display-1',
        region: { x: 10, y: 20, width: 300, height: 180 }
      })
    );
    expect(workflow.nodes.find((node) => node.type === 'extract')?.config.fields).toEqual([
      'visible_state',
      'repeatable_pattern',
      'guard_condition',
      'suggested_action'
    ]);
    expect(
      hasLiveIntentionFields({
        visible_state: 'dialog visible',
        repeatable_pattern: 'wait for ready state',
        guard_condition: 'button remains enabled',
        suggested_action: 'click approved button'
      })
    ).toBe(true);
    expect(workflow.nodes.find((node) => node.type === 'action')?.config.kind).toBe('clipboard');
    expect(workflowRunReadinessIssues(workflow)).toEqual([]);
  });

  it('applies a reviewed live intention proposal without arming or auto-running actions', () => {
    const workflow = createLiveIntentionWorkflow(
      { displayId: 'display-1', region: { x: 10, y: 20, width: 300, height: 180 } },
      new Date('2026-05-11T12:00:00Z')
    );

    const next = applyLiveIntentionProposalToWorkflow(workflow, {
      visibleState: 'A ready button is visible',
      repeatablePattern: 'When the ready button appears, the user checks the value beside it',
      guardCondition: 'Only when the ready button is visible and no warning is present',
      suggestedAction: 'Click the ready button'
    });

    expect(next.status).toBe('paused');
    expect(next.runnerState).toBe('inactive');
    expect(next.autoAppend).toBe(false);
    expect(next.summaryInstructions).toContain('Suggested action: Click the ready button');
    expect(next.nodes.find((node) => node.type === 'action')?.config).toEqual(
      expect.objectContaining({
        kind: 'clipboard',
        proposedAction: 'Click the ready button'
      })
    );
  });

  it('shows node-level draft changes before applying a live intention proposal', () => {
    const workflow = createLiveIntentionWorkflow(
      { displayId: 'display-1', region: { x: 10, y: 20, width: 300, height: 180 } },
      new Date('2026-05-11T12:00:00Z')
    );

    const diff = liveIntentionDraftDiff(workflow, {
      visibleState: 'A ready button is visible',
      repeatablePattern: 'When ready appears, collect the nearby value',
      guardCondition: 'Ready button visible and warning absent',
      suggestedAction: 'Click the ready button'
    });

    expect(diff.map((item) => item.nodeType)).toEqual(expect.arrayContaining(['trigger', 'extract', 'review', 'action']));
    expect(diff.find((item) => item.nodeType === 'action')?.changes).toContainEqual(
      expect.objectContaining({
        label: 'Action metadata',
        after: 'Click the ready button'
      })
    );
  });
});

function watchScreenWithRef() {
  const node = createMacroNodeFromTemplate('watch-screen', new Date('2026-05-11T12:00:01Z'));
  return {
    ...node,
    config: {
      ...node.config,
      exampleRefs: [
        {
          id: 'ref-1',
          refName: '#ref1',
          label: 'Trigger screen',
          path: 'C:\\temp\\ref.png',
          addedAt: '2026-05-11T12:00:00Z',
          use: 'trigger-reference' as const
        }
      ]
    }
  };
}
