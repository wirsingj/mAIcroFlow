import type { Workflow, WorkflowCapabilityRequirement } from './types';

export function workflowCapabilityRequirements(workflow?: Workflow): WorkflowCapabilityRequirement[] {
  if (!workflow) {
    return [];
  }

  const requirements = new Map<string, WorkflowCapabilityRequirement>();
  const add = (requirement: WorkflowCapabilityRequirement): void => {
    requirements.set(requirement.kind, requirement);
  };

  add({
    kind: 'screen-capture',
    label: 'Screen capture',
    reason: 'The workflow observes visible screen pixels through a capture node or watch trigger.',
    required: true
  });

  if (workflow.trigger.kind === 'screen-detection' || workflow.trigger.kind === 'reference-image' || workflow.trigger.kind === 'region-visible') {
    add({
      kind: 'local-vision',
      label: 'Local vision model',
      reason: 'The trigger needs a local model to decide whether the target screen is visible.',
      required: true,
      suggestedModel: 'llava:7b',
      installHint: 'Install Ollama, then pull a local vision model.'
    });
  }

  for (const node of workflow.nodes) {
    if (node.type === 'extract' && node.config.kind === 'ollama-vision') {
      add({
        kind: 'local-vision',
        label: 'Local vision model',
        reason: 'The extraction node needs a local model to read visible fields from screenshots.',
        required: true,
        suggestedModel: 'llava:7b',
        installHint: 'Install Ollama, then pull a local vision model.'
      });
    }

    if (node.type === 'action') {
      if (node.config.kind === 'append-csv' || node.config.kind === 'xlsx') {
        add({
          kind: 'spreadsheet-output',
          label: 'Spreadsheet/file output',
          reason: 'The action writes workflow results to a user-selected local output file.',
          required: true
        });
      }
      if (node.config.kind === 'clipboard') {
        add({
          kind: 'clipboard-output',
          label: 'Clipboard output',
          reason: 'The action copies a workflow result to the OS clipboard.',
          required: true
        });
      }
      if (node.config.kind === 'keyboard-mouse') {
        add({
          kind: 'keyboard-mouse-output',
          label: 'Keyboard/mouse macro output',
          reason: 'The action emits explicit OS input configured in the workflow.',
          required: true
        });
      }
    }

    if (node.config.kind === 'voice-output' || node.config.kind === 'tts') {
      add({
        kind: 'voice-output',
        label: 'Voice/audio output',
        reason: 'The node needs a local voice or audio output capability.',
        required: true,
        suggestedModel: 'local TTS model',
        installHint: 'Voice output support is planned; this workflow should show setup before arming.'
      });
    }
  }

  return Array.from(requirements.values());
}
