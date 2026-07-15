import type { CaptureRegion, Workflow } from './types';
import { liveIntentionFields } from './liveIntention';
import { createMacroNodeFromTemplate } from './macroNodeTemplates';
import { CURRENT_WORKFLOW_SCHEMA_VERSION } from './workflowSchema';

export function createNewMacroWorkflow(now = new Date()): Workflow {
  const id = `workflow-${now.getTime()}`;
  const nodes = [createMacroNodeFromTemplate('watch-screen', new Date(now.getTime() + 1))];

  nodes[0] = {
    ...nodes[0],
    title: 'When this screen appears',
    summary: 'Add a reference screenshot here. This macro starts when the visible screen matches it, or when you press the configured hotkey while testing.',
    config: { ...nodes[0].config, hotkey: 'F12' }
  };

  return {
    schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION,
    id,
    name: 'New Macro',
    status: 'paused',
    runnerState: 'inactive',
    autoAppend: true,
    lastRunStatus: 'Draft',
    lastSuccessfulAppend: '',
    summaryInstructions: '',
    trigger: {
      kind: 'screen-detection',
      summary: 'Watch for matching screen every 5s',
      hotkey: 'F12',
      detectionIntervalSeconds: 5,
      detectionCooldownSeconds: 10,
      duplicateDetectionEnabled: true,
      experimental: true
    },
    nodes,
    lastRun: '',
    lastResult: 'Add the next macro steps, then Save and Run Test.'
  };
}

export const createScreenToCsvWorkflow = createNewMacroWorkflow;

export function createLiveIntentionWorkflow(
  selection: { displayId: string; region: CaptureRegion },
  now = new Date()
): Workflow {
  const id = `live-workflow-${now.getTime()}`;
  const trigger = createMacroNodeFromTemplate('watch-screen', new Date(now.getTime() + 1));
  const capture = createMacroNodeFromTemplate('screen-grab', new Date(now.getTime() + 2));
  const extract = createMacroNodeFromTemplate('ai-extract', new Date(now.getTime() + 3));
  const validate = createMacroNodeFromTemplate('validate-fields', new Date(now.getTime() + 4));
  const review = createMacroNodeFromTemplate('review-if-needed', new Date(now.getTime() + 5));
  const action = createMacroNodeFromTemplate('copy-clipboard', new Date(now.getTime() + 6));

  return {
    schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION,
    id,
    name: 'Live Intention Flow',
    status: 'paused',
    runnerState: 'inactive',
    autoAppend: false,
    lastRunStatus: 'Draft',
    lastSuccessfulAppend: '',
    summaryInstructions: 'Live intention capture draft. AI interpretation is proposed only; user review is required before output.',
    trigger: {
      kind: 'region-visible',
      summary: 'Watch the selected region every 5s',
      hotkey: 'F12',
      detectionIntervalSeconds: 5,
      detectionCooldownSeconds: 10,
      duplicateDetectionEnabled: true,
      experimental: true
    },
    nodes: [
      {
        ...trigger,
        title: 'Watch selected region',
        summary: 'Observe only the rectangle selected by the user; use F12 to test the draft.',
        config: {
          ...trigger.config,
          kind: 'region-visible',
          hotkey: 'F12',
          confidenceMinimum: 0.35
        }
      },
      {
        ...capture,
        title: 'Capture selected region',
        summary: 'Use the explicit rectangle selected during live setup.',
        config: {
          ...capture.config,
          mode: 'region',
          source: 'display-id',
          displayId: selection.displayId,
          region: selection.region
        }
      },
      {
        ...extract,
        title: 'Infer repeatable pattern',
        summary: 'Ask local AI to describe visible state, likely routine, guard condition, and suggested action.',
        config: {
          ...extract.config,
          fields: [...liveIntentionFields],
          fieldsText: liveIntentionFields.join(', '),
          prompt:
            'Analyze only the selected visible screen region. Infer the repeatable user intention as a proposed workflow, not a command to execute. Return strict JSON with visible_state, repeatable_pattern, guard_condition, and suggested_action. If uncertain, say what is missing instead of inventing hidden state.'
        }
      },
      {
        ...validate,
        title: 'Check proposal',
        summary: 'Require the proposed interpretation fields before any output.',
        config: {
          ...validate.config,
          requiredFields: ['visible_state', 'repeatable_pattern'],
          numericFields: [],
          numericWhenPresent: [],
          confidenceMinimum: 0.25
        }
      },
      {
        ...review,
        title: 'Review proposed macro',
        summary: 'A human must edit and approve the inferred interpretation before any action output.',
        config: {
          ...review.config,
          reviewOnValidationFailure: true,
          trustLaterDisabled: true
        }
      },
      {
        ...action,
        title: 'Copy reviewed proposal',
        summary: 'Copy the reviewed interpretation to the clipboard; no inferred action runs automatically.',
        config: {
          ...action.config,
          kind: 'clipboard',
          prompt: 'Copy the reviewed live-intention interpretation to the clipboard for inspection.'
        }
      }
    ],
    lastRun: '',
    lastResult: 'Region selected. Run Test to ask local AI for a proposed workflow, then review before saving or arming.'
  };
}
