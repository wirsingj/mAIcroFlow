import type { Workflow } from '../../shared/types';

export const SAFETY_PAUSE_HOTKEY = 'CommandOrControl+Alt+Shift+P';

const modifierLabels: Record<string, string> = {
  CTRL: 'CommandOrControl',
  CONTROL: 'CommandOrControl',
  COMMANDORCONTROL: 'CommandOrControl',
  CMDORCTRL: 'CommandOrControl',
  ALT: 'Alt',
  SHIFT: 'Shift',
  SUPER: 'Super',
  META: 'Super'
};

const keyLabels: Record<string, string> = {
  ESC: 'Esc',
  ESCAPE: 'Esc',
  PAGEUP: 'PageUp',
  PAGEDOWN: 'PageDown',
  BACKSPACE: 'Backspace',
  DELETE: 'Delete',
  INSERT: 'Insert',
  ENTER: 'Enter',
  SPACE: 'Space',
  TAB: 'Tab',
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  HOME: 'Home',
  END: 'End'
};

export function workflowHotkeys(workflows: Workflow[]): string[] {
  const hotkeys = new Set<string>();
  for (const workflow of workflows) {
    if (workflow.status !== 'active') {
      continue;
    }
    for (const hotkey of workflowConfiguredHotkeys(workflow)) {
      const normalized = normalizeHotkey(hotkey);
      if (normalized && normalized !== SAFETY_PAUSE_HOTKEY) {
        hotkeys.add(normalized);
      }
    }
  }
  return [...hotkeys];
}

export function workflowUsesHotkey(workflow: Workflow, hotkey: string): boolean {
  const normalized = normalizeHotkey(hotkey);
  if (!normalized) {
    return false;
  }
  return workflowConfiguredHotkeys(workflow).some((candidate) => normalizeHotkey(candidate) === normalized);
}

export function normalizeHotkey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length || parts.length > 5) {
    return null;
  }

  const key = normalizeKeyPart(parts.at(-1) ?? '');
  if (!key) {
    return null;
  }

  const modifiers: string[] = [];
  const seenModifiers = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const modifier = normalizeModifierPart(part);
    if (!modifier || seenModifiers.has(modifier)) {
      return null;
    }
    seenModifiers.add(modifier);
    modifiers.push(modifier);
  }

  return [...modifiers, key].join('+');
}

function workflowConfiguredHotkeys(workflow: Workflow): string[] {
  const values = [workflow.trigger.hotkey];
  for (const node of workflow.nodes) {
    if (node.type === 'trigger') {
      values.push(typeof node.config.hotkey === 'string' ? node.config.hotkey : undefined);
    }
  }
  return values.filter((value): value is string => Boolean(value?.trim()));
}

function normalizeModifierPart(value: string): string | null {
  return modifierLabels[value.trim().toUpperCase()] ?? null;
}

function normalizeKeyPart(value: string): string | null {
  const upper = value.trim().toUpperCase();
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(upper)) {
    return upper;
  }
  if (/^[A-Z0-9]$/.test(upper)) {
    return upper;
  }
  return keyLabels[upper] ?? null;
}
