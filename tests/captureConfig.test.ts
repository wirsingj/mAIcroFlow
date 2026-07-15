import { describe, expect, it } from 'vitest';
import type { Workflow } from '../src/shared/types';
import { captureOptionsFromWorkflow } from '../src/main/services/captureConfig';

describe('capture configuration safety', () => {
  it('requires an explicit supported capture source', () => {
    expect(() =>
      captureOptionsFromWorkflow(workflowWithCaptureConfig({ mode: 'full-screen' }))
    ).toThrow(/Unsupported capture source/);
  });

  it('keeps specific monitor capture explicit', () => {
    expect(
      captureOptionsFromWorkflow(workflowWithCaptureConfig({ mode: 'full-screen', source: 'display-id', displayId: '123' }))
    ).toEqual({ source: 'display-id', displayId: '123' });
  });

  it('fails closed when a specific monitor is missing its display id', () => {
    expect(() =>
      captureOptionsFromWorkflow(workflowWithCaptureConfig({ mode: 'full-screen', source: 'display-id' }))
    ).toThrow(/displayId/);
  });

  it('fails closed for planned window capture until it is implemented', () => {
    expect(() =>
      captureOptionsFromWorkflow(workflowWithCaptureConfig({ mode: 'full-screen', source: 'window-title', windowTitle: 'Target' }))
    ).toThrow(/Unsupported capture source/);
  });

  it('loads explicit rectangle capture configuration', () => {
    expect(
      captureOptionsFromWorkflow(
        workflowWithCaptureConfig({
          mode: 'region',
          source: 'primary-display',
          region: { x: 10, y: 20, width: 300, height: 200 }
        })
      )
    ).toEqual({
      source: 'primary-display',
      region: { x: 10, y: 20, width: 300, height: 200 }
    });
  });

  it('fails closed when rectangle capture has no usable rectangle', () => {
    expect(() =>
      captureOptionsFromWorkflow(workflowWithCaptureConfig({ mode: 'region', source: 'primary-display' }))
    ).toThrow(/rectangle/);
  });
});

function workflowWithCaptureConfig(config: Record<string, unknown>): Workflow {
  return {
    id: 'capture-test',
    name: 'Capture Test',
    status: 'active',
    trigger: { kind: 'hotkey', summary: 'F7' },
    nodes: [
      { id: 't', type: 'trigger', title: 'Trigger', summary: 'F7', config: {} },
      { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config },
      { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
      { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
      { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
      { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: {} }
    ]
  };
}
