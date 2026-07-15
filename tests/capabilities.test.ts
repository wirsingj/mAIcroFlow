import { describe, expect, it } from 'vitest';
import type { Workflow } from '../src/shared/types';
import { workflowCapabilityRequirements } from '../src/shared/capabilities';

describe('workflow capability requirements', () => {
  it('explains local vision needs for watch and extraction workflows', () => {
    const requirements = workflowCapabilityRequirements(baseWorkflow());

    expect(requirements).toContainEqual(expect.objectContaining({ kind: 'screen-capture' }));
    expect(requirements).toContainEqual(expect.objectContaining({ kind: 'local-vision', suggestedModel: 'llava:7b' }));
    expect(requirements).toContainEqual(expect.objectContaining({ kind: 'spreadsheet-output' }));
  });

  it('detects future voice output needs without installing anything silently', () => {
    const workflow = baseWorkflow();
    workflow.nodes.push({
      id: 'voice',
      type: 'action',
      title: 'Voice',
      summary: 'Speak a generated line',
      config: { kind: 'voice-output' }
    });

    expect(workflowCapabilityRequirements(workflow)).toContainEqual(expect.objectContaining({ kind: 'voice-output' }));
  });
});

function baseWorkflow(): Workflow {
  return {
    id: 'capability-demo',
    name: 'Capability Demo',
    status: 'active',
    trigger: {
      kind: 'screen-detection',
      summary: 'Watch screen'
    },
    nodes: [
      { id: 't', type: 'trigger', title: 'Trigger', summary: 'Watch', config: {} },
      { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: { source: 'cursor-display' } },
      { id: 'e', type: 'extract', title: 'Extract', summary: 'Vision', config: { kind: 'ollama-vision' } },
      { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
      { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
      { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: { kind: 'append-csv' } }
    ]
  };
}
