import { describe, expect, it } from 'vitest';
import type { Workflow } from '../src/shared/types';
import { normalizeHotkey, SAFETY_PAUSE_HOTKEY, workflowHotkeys, workflowUsesHotkey } from '../src/main/services/hotkeys';

describe('workflow hotkey helpers', () => {
  it('normalizes common Electron accelerator aliases', () => {
    expect(normalizeHotkey('Ctrl + Shift + f7')).toBe('CommandOrControl+Shift+F7');
    expect(normalizeHotkey('Control+PageUp')).toBe('CommandOrControl+PageUp');
    expect(normalizeHotkey('esc')).toBe('Esc');
  });

  it('rejects malformed hotkeys before dynamic registration', () => {
    expect(normalizeHotkey('Ctrl+Control+F7')).toBeNull();
    expect(normalizeHotkey('Ctrl+NotAKey')).toBeNull();
    expect(normalizeHotkey('F7+Ctrl')).toBeNull();
  });

  it('collects unique active workflow hotkeys', () => {
    expect(
      workflowHotkeys([
        workflowWithHotkey('active-a', 'F12', 'active'),
        workflowWithHotkey('active-b', 'f12', 'active'),
        workflowWithHotkey('paused', 'F9', 'paused')
      ])
    ).toEqual(['F12']);
  });

  it('skips malformed active workflow hotkeys', () => {
    expect(
      workflowHotkeys([
        workflowWithHotkey('valid', 'F8', 'active'),
        workflowWithHotkey('invalid', 'Ctrl+Control+F7', 'active')
      ])
    ).toEqual(['F8']);
  });

  it('does not expose the global safety pause chord as a workflow hotkey', () => {
    expect(workflowHotkeys([workflowWithHotkey('unsafe', SAFETY_PAUSE_HOTKEY, 'active')])).toEqual([]);
  });

  it('matches workflow and trigger-node hotkeys case-insensitively', () => {
    const workflow = workflowWithHotkey('macro', 'Ctrl+F8', 'active');
    workflow.nodes[0] = {
      ...workflow.nodes[0],
      config: {
        hotkey: 'Alt+F9'
      }
    };

    expect(workflowUsesHotkey(workflow, 'Control+F8')).toBe(true);
    expect(workflowUsesHotkey(workflow, 'alt+f9')).toBe(true);
    expect(workflowUsesHotkey(workflow, 'F12')).toBe(false);
  });
});

function workflowWithHotkey(id: string, hotkey: string, status: Workflow['status']): Workflow {
  return {
    id,
    name: id,
    status,
    runnerState: status === 'active' ? 'armed' : 'inactive',
    trigger: { kind: 'hotkey', summary: hotkey, hotkey },
    nodes: [
      { id: 't', type: 'trigger', title: 'Trigger', summary: hotkey, config: {} },
      { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: { source: 'cursor-display' } },
      { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
      { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
      { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
      { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: { kind: 'append-csv', fileName: 'out.csv' } }
    ]
  };
}
