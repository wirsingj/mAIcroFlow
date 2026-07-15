import type { WorkflowNode, WorkflowNodeType } from './types';
import { normalizeNodeCategory } from './nodeTaxonomy';

export type MacroNodeTemplateKind =
  | 'hotkey-trigger'
  | 'watch-screen'
  | 'screen-grab'
  | 'ai-extract'
  | 'validate-fields'
  | 'review-if-needed'
  | 'append-csv'
  | 'append-xlsx'
  | 'copy-clipboard'
  | 'keyboard-mouse-planned';

export interface MacroNodeTemplate {
  kind: MacroNodeTemplateKind;
  title: string;
  group: 'Trigger' | 'Observe' | 'Think' | 'Guard' | 'Act';
  description: string;
  implemented: boolean;
  creates?: WorkflowNodeType;
}

export const macroNodeTemplates: MacroNodeTemplate[] = [
  {
    kind: 'hotkey-trigger',
    title: 'Hotkey Trigger',
    group: 'Trigger',
    description: 'Start or test a flow from a user-configured key.',
    implemented: true,
    creates: 'trigger'
  },
  {
    kind: 'watch-screen',
    title: 'Watch Screen/Region',
    group: 'Trigger',
    description: 'Listen for a matching visible screen using local vision.',
    implemented: true,
    creates: 'trigger'
  },
  {
    kind: 'screen-grab',
    title: 'Screen Grab',
    group: 'Observe',
    description: 'Capture a display or explicit rectangle.',
    implemented: true,
    creates: 'capture'
  },
  {
    kind: 'ai-extract',
    title: 'AI Extract',
    group: 'Think',
    description: 'Ask local Ollama to return structured visible fields.',
    implemented: true,
    creates: 'extract'
  },
  {
    kind: 'validate-fields',
    title: 'Validate',
    group: 'Guard',
    description: 'Check required fields, numeric values, and confidence.',
    implemented: true,
    creates: 'validate'
  },
  {
    kind: 'review-if-needed',
    title: 'Review If Needed',
    group: 'Guard',
    description: 'Pause only when validation or safety policy requires it.',
    implemented: true,
    creates: 'review'
  },
  {
    kind: 'append-csv',
    title: 'CSV Output',
    group: 'Act',
    description: 'Append a row to a local CSV file.',
    implemented: true,
    creates: 'action'
  },
  {
    kind: 'append-xlsx',
    title: 'XLSX Output',
    group: 'Act',
    description: 'Append a row to a local XLSX workbook.',
    implemented: true,
    creates: 'action'
  },
  {
    kind: 'copy-clipboard',
    title: 'Clipboard Output',
    group: 'Act',
    description: 'Copy structured values to the system clipboard after review.',
    implemented: true,
    creates: 'action'
  },
  {
    kind: 'keyboard-mouse-planned',
    title: 'Disabled Key/Mouse Action',
    group: 'Act',
    description: 'Planned high-risk macro output; visible and policy-gated before execution.',
    implemented: false
  }
];

export function createMacroNodeFromTemplate(kind: MacroNodeTemplateKind, now = new Date()): WorkflowNode {
  const id = `${kind}-${now.getTime()}`;
  switch (kind) {
    case 'hotkey-trigger':
      return normalizeNodeCategory({
        id,
        type: 'trigger',
        title: 'Hotkey trigger',
        summary: 'Run this flow when the configured hotkey is pressed.',
        config: { kind: 'hotkey', hotkey: 'F12' }
      });
    case 'watch-screen':
      return normalizeNodeCategory({
        id,
        type: 'trigger',
        title: 'Watch for screen',
        summary: 'Run this flow when a matching visible screen appears.',
        config: {
          kind: 'screen-detection',
          detectionIntervalSeconds: 5,
          detectionCooldownSeconds: 10,
          duplicateDetectionEnabled: true,
          exampleRefs: []
        }
      });
    case 'screen-grab':
      return normalizeNodeCategory({
        id,
        type: 'capture',
        title: 'Screen grab',
        summary: 'Capture visible pixels from a selected display or rectangle.',
        config: { mode: 'full-screen', source: 'cursor-display' }
      });
    case 'ai-extract':
      return normalizeNodeCategory({
        id,
        type: 'extract',
        title: 'AI extract fields',
        summary: 'Use local AI to extract configured fields from the captured screen.',
        config: {
          kind: 'ollama-vision',
          fields: ['value'],
          prompt: 'Extract only the requested visible fields from the final live screenshot. Return strict JSON only.',
          exampleRefs: []
        }
      });
    case 'validate-fields':
      return normalizeNodeCategory({
        id,
        type: 'validate',
        title: 'Validate fields',
        summary: 'Check required fields, numeric fields, and confidence.',
        config: { requiredFields: [], numericFields: [], numericWhenPresent: [], confidenceMinimum: 0.35 }
      });
    case 'review-if-needed':
      return normalizeNodeCategory({
        id,
        type: 'review',
        title: 'Review if needed',
        summary: 'Stop for review only when validation or safety policy requires it.',
        config: { reviewOnValidationFailure: true, trustLaterDisabled: true }
      });
    case 'append-csv':
      return normalizeNodeCategory({
        id,
        type: 'action',
        title: 'Append CSV row',
        summary: 'Append structured values to a local CSV file.',
        config: {
          kind: 'append-csv',
          prompt: 'Add the extracted fields as a new row in the CSV file.',
          outputDirectory: '',
          fileName: 'workflow_output.csv'
        }
      });
    case 'append-xlsx':
      return normalizeNodeCategory({
        id,
        type: 'action',
        title: 'Append Excel row',
        summary: 'Append structured values to a local XLSX workbook.',
        config: {
          kind: 'xlsx',
          prompt: 'Add the extracted fields as a new row in the Excel workbook.',
          outputDirectory: '',
          fileName: 'workflow_output.xlsx'
        }
      });
    case 'copy-clipboard':
      return normalizeNodeCategory({
        id,
        type: 'action',
        title: 'Copy to clipboard',
        summary: 'Copy structured values to the clipboard after review.',
        config: {
          kind: 'clipboard',
          prompt: 'Copy the extracted fields to the clipboard.',
          outputDirectory: '',
          fileName: ''
        }
      });
    case 'keyboard-mouse-planned':
      throw new Error('Keyboard/mouse output is planned but not implemented in v0.');
  }
}
