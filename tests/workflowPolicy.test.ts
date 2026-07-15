import { describe, expect, it } from 'vitest';
import type { Workflow } from '../src/shared/types';
import { validateWorkflowSafety } from '../src/main/services/workflowPolicy';
import { validateWorkflowExtraction } from '../src/main/services/workflowHandlers';

function workflowWithAction(kind: string, autoAppend = true): Workflow {
  return {
    id: 'demo',
    name: 'Demo',
    status: 'active',
    runnerState: 'armed',
    autoAppend,
    trigger: { kind: 'hotkey', summary: 'F12', hotkey: 'F12' },
    nodes: [
      { id: 't', type: 'trigger', title: 'Trigger', summary: 'F12', config: {} },
      { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: { source: 'cursor-display' } },
      { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
      { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
      { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
      {
        id: 'a',
        type: 'action',
        title: 'Action',
        summary: kind,
        config: { kind, outputDirectory: 'C:\\Users\\wirsi\\Desktop\\output', fileName: 'stats.csv' }
      }
    ]
  };
}

describe('workflow safety and handler boundaries', () => {
  it('rejects unsafe auto-action settings', () => {
    const result = validateWorkflowSafety(workflowWithAction('local-script'));

    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/cannot run automatically|requires review/);
  });

  it('allows low-risk CSV auto-append when explicitly enabled', () => {
    expect(validateWorkflowSafety(workflowWithAction('append-csv')).ok).toBe(true);
  });

  it('requires review before copying extracted values to the clipboard', () => {
    expect(validateWorkflowSafety(workflowWithAction('clipboard')).ok).toBe(false);
    expect(validateWorkflowSafety(workflowWithAction('clipboard', false)).ok).toBe(true);
  });

  it('rejects unknown action kinds', () => {
    const result = validateWorkflowSafety(workflowWithAction('mystery-action', false));

    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/Unknown action kind/);
  });

  it('keeps demo-specific validation behind the workflow handler boundary', () => {
    const result = validateWorkflowExtraction(workflowWithAction('append-csv'), {
      fish_name: 'Blue-striped Grouper',
      exp_gained: '19',
      weight: '847 g',
      class_tier: 'B',
      bait_used: '',
      confidence: 0.9,
      notes: ''
    });

    expect(result.ok).toBe(true);
    expect(result.result.fish_name).toBe('Blue-striped Grouper');
  });

  it('validates generic extracted fields without requiring demo-specific names', () => {
    const workflow = workflowWithAction('append-csv');
    workflow.nodes = workflow.nodes.map((node) =>
      node.type === 'validate'
        ? { ...node, config: { requiredFields: ['age'], numericFields: ['age'] } }
        : node
    );

    const result = validateWorkflowExtraction(workflow, {
      fish_name: '',
      exp_gained: '',
      weight: '',
      class_tier: '',
      bait_used: '',
      confidence: 0.9,
      notes: '',
      fields: {
        age: 42,
        label: 'visible row'
      }
    });

    expect(result.ok).toBe(true);
    expect(result.result.fields?.age).toBe(42);
  });

  it('blocks generic output when required extracted fields are missing', () => {
    const workflow = workflowWithAction('append-csv');
    workflow.nodes = workflow.nodes.map((node) =>
      node.type === 'validate'
        ? { ...node, config: { requiredFields: ['age'] } }
        : node
    );

    const result = validateWorkflowExtraction(workflow, {
      fish_name: '',
      exp_gained: '',
      weight: '',
      class_tier: '',
      bait_used: '',
      confidence: 0.9,
      notes: '',
      fields: {
        label: 'visible row'
      }
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain('age is required.');
  });
});
