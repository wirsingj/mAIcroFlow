import type { TriggerCondition, TriggerExpression, Workflow, WorkflowNode } from './types';
import { isVisualTriggerKind } from './workflowReadiness';

export type WorkflowDiagnosticSeverity = 'error' | 'warning';

export interface WorkflowDiagnostic {
  severity: WorkflowDiagnosticSeverity;
  code: string;
  message: string;
  nodeId?: string;
}

const validSingleKeys = new Set([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'SPACE',
  'TAB',
  'ENTER',
  'ESC',
  'ESCAPE',
  'BACKSPACE',
  'DELETE',
  'INSERT',
  'HOME',
  'END',
  'PAGEUP',
  'PAGEDOWN',
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT'
]);

const validModifiers = new Set(['CTRL', 'CONTROL', 'COMMANDORCONTROL', 'CMDORCTRL', 'ALT', 'SHIFT', 'SUPER', 'META']);
const promptActionPattern =
  /\b(click|press|type|run|execute|open|launch|delete|move|copy|paste|submit|send|download|install|write\s+(?:to|a|the)?\s*file|save\s+(?:to|a|the)?\s*file|append\s+(?:to|a|the)?\s*file)\b/i;
const highRiskActionPromptPattern = /\b(click|press|type|submit|send\s+keys?|mouse|keyboard|run\s+(?:script|program|command)|execute|webhook|http|api call)\b/i;
const sensitiveTargetPattern = /\b(nsa|classified|password manager|credential store|bank account|medical record|private key|secret key)\b/i;
const forbiddenOutputPattern = /(?:^|[\\/])(windows|system32|syswow64|program files|program files \(x86\))(?:[\\/]|$)/i;
const reservedFileChars = /[<>:"/\\|?*]/;

export function lintWorkflow(workflow: Workflow): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];

  lintTrigger(workflow, diagnostics);
  for (const node of workflow.nodes) {
    lintNode(node, diagnostics);
  }

  const actionNode = workflow.nodes.find((node) => node.type === 'action');
  if (workflow.autoAppend && actionNode?.config.kind === 'keyboard-mouse') {
    diagnostics.push({
      severity: 'error',
      code: 'unsafe_auto_input',
      nodeId: actionNode.id,
      message: 'Keyboard/mouse output cannot run automatically until an explicit safety policy supports that exact action.'
    });
  }

  return diagnostics;
}

export function workflowHasBlockingDiagnostics(workflow: Workflow): boolean {
  return lintWorkflow(workflow).some((diagnostic) => diagnostic.severity === 'error');
}

function lintTrigger(workflow: Workflow, diagnostics: WorkflowDiagnostic[]): void {
  if (workflow.trigger.kind === 'hotkey') {
    lintHotkey(workflow.trigger.hotkey, 'workflow.trigger.hotkey', diagnostics);
  }

  if (workflow.trigger.logic) {
    lintTriggerExpression(workflow.trigger.logic, diagnostics);
  }

  lintTextForImpossibleLogic(workflow.trigger.summary, 'workflow.trigger.summary', diagnostics);
  lintTextForSensitiveTargets(workflow.trigger.summary, 'workflow.trigger.summary', diagnostics);

  if (workflow.trigger.kind === 'region-visible') {
    const captureNode = workflow.nodes.find((node) => node.type === 'capture');
    if (captureNode && captureNode.config.mode !== 'region') {
      diagnostics.push({
        severity: 'error',
        code: 'region_visible_requires_capture_region',
        nodeId: captureNode.id,
        message: 'Region-visible triggers require the Screen Grab step to use a rectangle capture.'
      });
    }
  }

  if (isVisualTriggerKind(workflow.trigger.kind)) {
    const triggerNode = workflow.nodes.find((node) => node.type === 'trigger');
    const refs = triggerNode?.config.exampleRefs;
    if (triggerNode && (!Array.isArray(refs) || refs.length === 0)) {
      diagnostics.push({
        severity: 'warning',
        code: 'missing_trigger_reference',
        nodeId: triggerNode.id,
        message: 'Visual triggers work best with at least one trigger reference screenshot.'
      });
    }
  }
}

function lintTriggerExpression(expression: TriggerExpression, diagnostics: WorkflowDiagnostic[]): void {
  if (!expression.conditions.length) {
    diagnostics.push({
      severity: 'error',
      code: 'empty_trigger_logic',
      message: `Trigger group "${expression.id}" has no conditions.`
    });
  }

  for (const condition of expression.conditions) {
    if ('op' in condition) {
      lintTriggerExpression(condition, diagnostics);
      continue;
    }
    lintTriggerCondition(condition, diagnostics);
  }
}

function lintTriggerCondition(condition: TriggerCondition, diagnostics: WorkflowDiagnostic[]): void {
  if (condition.kind === 'hotkey') {
    lintHotkey(stringValue(condition.config.hotkey), `trigger condition "${condition.id}"`, diagnostics);
  }

  lintTextForImpossibleLogic(condition.summary, `trigger condition "${condition.id}"`, diagnostics);
  lintTextForSensitiveTargets(condition.summary, `trigger condition "${condition.id}"`, diagnostics);

  const prompt = stringValue(condition.config.prompt);
  if (prompt) {
    lintPromptBoundary(prompt, `trigger condition "${condition.id}"`, diagnostics);
    lintTextForImpossibleLogic(prompt, `trigger condition "${condition.id}" prompt`, diagnostics);
    lintTextForSensitiveTargets(prompt, `trigger condition "${condition.id}" prompt`, diagnostics);
  }
}

function lintNode(node: WorkflowNode, diagnostics: WorkflowDiagnostic[]): void {
  lintTextForImpossibleLogic(node.summary, node.title, diagnostics, node.id);
  lintTextForSensitiveTargets(node.summary, node.title, diagnostics, node.id);

  if (node.type === 'trigger') {
    lintHotkey(stringValue(node.config.hotkey), node.title, diagnostics, node.id);
    lintRatio(node.config.confidenceMinimum, node.title, 'confidence minimum', 'invalid_confidence_minimum', diagnostics, node.id);
    lintRatio(
      node.config.referenceSimilarityMinimum,
      node.title,
      'reference similarity minimum',
      'invalid_reference_similarity_minimum',
      diagnostics,
      node.id
    );
  }

  if (node.type === 'extract') {
    const prompt = stringValue(node.config.prompt) ?? '';
    if (!prompt.trim()) {
      diagnostics.push({
        severity: 'warning',
        code: 'missing_extraction_prompt',
        nodeId: node.id,
        message: 'Extraction node has no prompt. The model may not know which visible values to return.'
      });
    }
    lintPromptBoundary(prompt, node.title, diagnostics, node.id);
  }

  if (node.type === 'capture') {
    lintCaptureNode(node, diagnostics);
  }

  if (node.type === 'action') {
    lintActionNode(node, diagnostics);
  }
}

function lintRatio(
  value: unknown,
  label: string,
  fieldLabel: string,
  code: string,
  diagnostics: WorkflowDiagnostic[],
  nodeId?: string
): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 1) {
    diagnostics.push({
      severity: 'error',
      code,
      nodeId,
      message: `${label} ${fieldLabel} must be a number between 0 and 1.`
    });
  }
}

function lintCaptureNode(node: WorkflowNode, diagnostics: WorkflowDiagnostic[]): void {
  const source = stringValue(node.config.source) ?? '';
  if (!source) {
    diagnostics.push({
      severity: 'error',
      code: 'missing_capture_source',
      nodeId: node.id,
      message: 'Capture node must choose an explicit visible capture source.'
    });
  }

  if (source === 'window-title') {
    diagnostics.push({
      severity: 'error',
      code: 'unimplemented_capture_source',
      nodeId: node.id,
      message: 'App/window capture is planned but not implemented yet.'
    });
  }

  if (source === 'display-id' && !stringValue(node.config.displayId)) {
    diagnostics.push({
      severity: 'error',
      code: 'missing_display_id',
      nodeId: node.id,
      message: 'Specific-monitor capture requires a selected monitor.'
    });
  }

  if (node.config.mode === 'region') {
    const region = node.config.region;
    if (!region || typeof region !== 'object' || Array.isArray(region)) {
      diagnostics.push({
        severity: 'error',
        code: 'missing_capture_region',
        nodeId: node.id,
        message: 'Rectangle capture requires explicit x, y, width, and height values.'
      });
    } else {
      const rawRegion = region as Record<string, unknown>;
      const width = Number(rawRegion.width);
      const height = Number(rawRegion.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        diagnostics.push({
          severity: 'error',
          code: 'invalid_capture_region',
          nodeId: node.id,
          message: 'Rectangle capture width and height must be positive numbers.'
        });
      }
    }
  }
}

function lintActionNode(node: WorkflowNode, diagnostics: WorkflowDiagnostic[]): void {
  const kind = stringValue(node.config.kind) ?? '';
  const prompt = stringValue(node.config.prompt) ?? '';

  if (kind === 'append-csv' || kind === 'xlsx') {
    lintFileOutputNode(node, kind, diagnostics);
  }

  if ((kind === 'append-csv' || kind === 'xlsx') && highRiskActionPromptPattern.test(prompt)) {
    diagnostics.push({
      severity: 'warning',
      code: 'action_prompt_output_mismatch',
      nodeId: node.id,
      message: 'This action writes a file, but its instruction mentions input, commands, webhooks, or another output type. Choose a matching action node when that output is implemented.'
    });
  }

  if (kind === 'keyboard-mouse') {
    diagnostics.push({
      severity: 'warning',
      code: 'high_risk_input_action',
      nodeId: node.id,
      message: 'Keyboard/mouse output is a high-risk macro action and should stay explicit, visible, and policy-gated.'
    });
  }
}

function lintFileOutputNode(node: WorkflowNode, kind: 'append-csv' | 'xlsx', diagnostics: WorkflowDiagnostic[]): void {
  const outputDirectory = stringValue(node.config.outputDirectory) ?? '';
  const fileName = stringValue(node.config.fileName) ?? '';
  const expectedExtension = kind === 'xlsx' ? '.xlsx' : '.csv';
  const label = kind === 'xlsx' ? 'Excel workbook action' : 'Append CSV action';

  if (!outputDirectory.trim()) {
    diagnostics.push({
      severity: 'warning',
      code: 'missing_output_directory',
      nodeId: node.id,
      message: `${label} is using the default output folder (Documents\\mAIcroFlow\\output). Set one if you want a custom location.`
    });
  } else if (isProtectedOutputPath(outputDirectory)) {
    diagnostics.push({
      severity: 'warning',
      code: 'protected_output_directory',
      nodeId: node.id,
      message: 'Output folder appears to be a protected system location and may fail due to permissions.'
    });
  }

  if (!fileName.trim()) {
    diagnostics.push({
      severity: 'error',
      code: 'missing_output_file',
      nodeId: node.id,
      message: `${label} needs a file name.`
    });
  } else {
    if (reservedFileChars.test(fileName)) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid_output_file',
        nodeId: node.id,
        message: 'Output file name contains path separators or reserved characters.'
      });
    }
    if (!fileName.toLowerCase().endsWith(expectedExtension)) {
      diagnostics.push({
        severity: 'warning',
        code: 'unexpected_output_extension',
        nodeId: node.id,
        message: `${label} should normally write to a ${expectedExtension} file.`
      });
    }
  }
}

function lintHotkey(value: string | undefined, label: string, diagnostics: WorkflowDiagnostic[], nodeId?: string): void {
  if (value === undefined || value.trim() === '') {
    return;
  }

  if (!isValidHotkey(value)) {
    diagnostics.push({
      severity: 'error',
      code: 'invalid_hotkey',
      nodeId,
      message: `${label} has an invalid hotkey: "${value}".`
    });
  }
}

function lintPromptBoundary(prompt: string, label: string, diagnostics: WorkflowDiagnostic[], nodeId?: string): void {
  if (!prompt) {
    return;
  }

  if (promptActionPattern.test(prompt)) {
    diagnostics.push({
      severity: 'warning',
      code: 'prompt_action_boundary',
      nodeId,
      message: `${label} prompt appears to ask the model to perform an action. Prompts can interpret visible content; workflow action nodes perform outputs.`
    });
  }
}

function lintTextForImpossibleLogic(text: string, label: string, diagnostics: WorkflowDiagnostic[], nodeId?: string): void {
  for (const match of text.matchAll(/\b(-?\d+(?:\.\d+)?)\s*(>=|<=|>|<|==|=)\s*(-?\d+(?:\.\d+)?)\b/g)) {
    const left = Number(match[1]);
    const operator = match[2];
    const right = Number(match[3]);
    if (!evaluateComparison(left, operator, right)) {
      diagnostics.push({
        severity: 'warning',
        code: 'impossible_condition',
        nodeId,
        message: `${label} contains a condition that is always false: "${match[0]}".`
      });
    }
  }
}

function lintTextForSensitiveTargets(text: string, label: string, diagnostics: WorkflowDiagnostic[], nodeId?: string): void {
  const match = text.match(sensitiveTargetPattern);
  if (!match) {
    return;
  }

  diagnostics.push({
    severity: 'warning',
    code: 'sensitive_target',
    nodeId,
    message: `${label} mentions a sensitive target "${match[0]}". Confirm the workflow is user-owned, permitted, and uses visible pixels only.`
  });
}

function isValidHotkey(value: string): boolean {
  const parts = value
    .split('+')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

  if (!parts.length || parts.length > 5) {
    return false;
  }

  const key = parts.at(-1);
  const modifiers = parts.slice(0, -1);
  if (!key) {
    return false;
  }

  if (modifiers.some((modifier) => !validModifiers.has(modifier))) {
    return false;
  }

  return validSingleKeys.has(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key);
}

function evaluateComparison(left: number, operator: string, right: number): boolean {
  switch (operator) {
    case '>':
      return left > right;
    case '<':
      return left < right;
    case '>=':
      return left >= right;
    case '<=':
      return left <= right;
    case '=':
    case '==':
      return left === right;
    default:
      return true;
  }
}

function isProtectedOutputPath(path: string): boolean {
  return forbiddenOutputPattern.test(path) || /^[a-z]:[\\/]?$/i.test(path.trim());
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
