import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CURRENT_WORKFLOW_SCHEMA_VERSION, migrateWorkflowValue, validateWorkflows } from '../src/shared/workflowSchema';
import { createLiveIntentionWorkflow, createScreenToCsvWorkflow } from '../src/shared/workflowTemplates';

describe('workflow schema', () => {
  it('loads a complete v0 workflow node chain', () => {
    const workflows = validateWorkflows([
      {
        id: 'demo',
        name: 'Demo',
        status: 'active',
        trigger: { kind: 'hotkey', summary: 'F12' },
        nodes: [
          { id: 't', type: 'trigger', title: 'Trigger', summary: 'F12', config: {} },
          { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: {} },
          { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
          { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
          { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
          { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
        ]
      }
    ]);

    expect(workflows[0].id).toBe('demo');
    expect(workflows[0].schemaVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
  });

  it('rejects malformed or newer workflow schema versions', () => {
    const base = completeWorkflow('demo');

    expect(() => validateWorkflows([{ ...base, schemaVersion: 0 }])).toThrow(/schemaVersion/);
    expect(() => validateWorkflows([{ ...base, schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION + 1 }])).toThrow(/newer/);
  });

  it('migrates legacy missing-version workflow values to v1', () => {
    expect(migrateWorkflowValue(completeWorkflow('legacy'))).toEqual(expect.objectContaining({ schemaVersion: 1 }));
    expect(validateWorkflows([{ ...completeWorkflow('string-version'), schemaVersion: '1' }])[0].schemaVersion).toBe(1);
  });

  it('allows partially built workflows while users add nodes', () => {
    const [workflow] = validateWorkflows([
      {
        id: 'draft',
        name: 'Draft',
        status: 'paused',
        trigger: { kind: 'hotkey', summary: 'F12' },
        nodes: [
          { id: 't', type: 'trigger', title: 'Trigger', summary: 'F12', config: {} }
        ]
      }
    ]);

    expect(workflow.nodes.map((node) => node.type)).toEqual(['trigger']);
  });

  it('normalizes legacy confirm nodes to review nodes', () => {
    const [workflow] = validateWorkflows([
      {
        id: 'legacy',
        name: 'Legacy',
        status: 'active',
        trigger: { kind: 'hotkey', summary: 'F12' },
        nodes: [
          { id: 't', type: 'trigger', title: 'Trigger', summary: 'F12', config: {} },
          { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: {} },
          { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
          { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
          { id: 'r', type: 'confirm', title: 'Confirm', summary: 'Preview', config: {} },
          { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
        ]
      }
    ]);

    expect(workflow.nodes.find((node) => node.id === 'r')?.type).toBe('review');
  });

  it('rejects unknown trigger kinds and nodes without config objects', () => {
    const base = {
      id: 'demo',
      name: 'Demo',
      status: 'active',
      trigger: { kind: 'hotkey', summary: 'F12' },
      nodes: [
        { id: 't', type: 'trigger', title: 'Trigger', summary: 'F12', config: {} },
        { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: {} },
        { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
        { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
        { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
        { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
      ]
    };

    expect(() => validateWorkflows([{ ...base, trigger: { kind: 'magic', summary: 'nope' } }])).toThrow(/trigger.kind/);
    expect(() =>
      validateWorkflows([
        {
          ...base,
          nodes: base.nodes.map((node) => (node.id === 'a' ? { ...node, config: undefined } : node))
        }
      ])
    ).toThrow(/config/);
  });

  it('accepts visual trigger vocabulary', () => {
    for (const kind of ['reference-image', 'region-visible']) {
      const [workflow] = validateWorkflows([
        {
          id: `demo-${kind}`,
          name: 'Demo',
          status: 'active',
          trigger: { kind, summary: kind },
          nodes: [
            { id: 't', type: 'trigger', title: 'Trigger', summary: kind, config: {} },
            { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: {} },
            { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
            { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
            { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
            { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
          ]
        }
      ]);

      expect(workflow.trigger.kind).toBe(kind);
    }
  });

  it('accepts explicit any/all composite trigger definitions', () => {
    const [workflow] = validateWorkflows([
      {
        id: 'combo-demo',
        name: 'Combo Demo',
        status: 'active',
        trigger: {
          kind: 'screen-detection',
          summary: 'Watch screen and hotkey fallback',
          logic: {
            id: 'root',
            op: 'any',
            conditions: [
              {
                id: 'manual',
                kind: 'hotkey',
                summary: 'F7 pressed',
                config: { hotkey: 'F7' }
              },
              {
                id: 'visual-and-model',
                op: 'all',
                conditions: [
                  {
                    id: 'visual',
                    kind: 'reference-image',
                    summary: 'Target result screen visible',
                    config: { confidenceMinimum: 0.75 }
                  },
                  {
                    id: 'model',
                    kind: 'screen-detection',
                    summary: 'Local model agrees this is the requested stat screen',
                    config: { prompt: 'Return strict JSON match true or false.' }
                  }
                ]
              }
            ]
          }
        },
        nodes: [
          { id: 't', type: 'trigger', title: 'Trigger', summary: 'Combo', config: {} },
          { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: {} },
          { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
          { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
          { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
          { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
        ]
      }
    ]);

    expect(workflow.trigger.logic?.op).toBe('any');
  });

  it('rejects malformed composite trigger definitions', () => {
    expect(() =>
      validateWorkflows([
        {
          id: 'bad-combo',
          name: 'Bad Combo',
          status: 'active',
          trigger: {
            kind: 'screen-detection',
            summary: 'Bad logic',
            logic: {
              id: 'root',
              op: 'xor',
              conditions: []
            }
          },
          nodes: [
            { id: 't', type: 'trigger', title: 'Trigger', summary: 'Combo', config: {} },
            { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: {} },
            { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
            { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
            { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
            { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
          ]
        }
      ])
    ).toThrow(/op/);
  });

  it('loads persisted workflow data when local app state exists', () => {
    const file = readFileSync(new URL('../data/workflows.json', import.meta.url), 'utf8');
    const workflows = validateWorkflows(JSON.parse(file));

    expect(Array.isArray(workflows)).toBe(true);
    for (const workflow of workflows) {
      expect(workflow.nodes.length).toBeGreaterThan(0);
      expect(workflow.nodes[0].type).toBe('trigger');
    }
  });

  it('creates a creator-driven macro with only the first trigger step', () => {
    const [workflow] = validateWorkflows([createScreenToCsvWorkflow(new Date('2026-05-11T12:00:00Z'))]);

    expect(workflow.name).toBe('New Macro');
    expect(workflow.status).toBe('paused');
    expect(workflow.schemaVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
    expect(workflow.runnerState).toBe('inactive');
    expect(workflow.autoAppend).toBe(true);
    expect(workflow.trigger.kind).toBe('screen-detection');
    expect(workflow.lastResult).toContain('Save and Run Test');
    expect(workflow.nodes.map((node) => node.category)).toEqual(['trigger']);
    expect(workflow.nodes[0].title).toBe('When this screen appears');
  });

  it('validates a live intention workflow draft without treating proposed actions as executable actions', () => {
    const [workflow] = validateWorkflows([
      createLiveIntentionWorkflow(
        { displayId: 'display-1', region: { x: 10, y: 20, width: 300, height: 180 } },
        new Date('2026-05-11T12:00:00Z')
      )
    ]);

    expect(workflow.schemaVersion).toBe(CURRENT_WORKFLOW_SCHEMA_VERSION);
    expect(workflow.autoAppend).toBe(false);
    expect(workflow.nodes.find((node) => node.type === 'extract')?.summary).toContain('suggested action');
    expect(workflow.nodes.find((node) => node.type === 'action')?.config.kind).toBe('clipboard');
  });
});

function completeWorkflow(id: string) {
  return {
    id,
    name: 'Demo',
    status: 'active',
    trigger: { kind: 'hotkey', summary: 'F12' },
    nodes: [
      { id: 't', type: 'trigger', title: 'Trigger', summary: 'F12', config: {} },
      { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: {} },
      { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
      { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
      { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
      { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
    ]
  };
}
