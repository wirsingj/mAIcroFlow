export type WorkflowStatus = 'active' | 'paused' | 'disabled';
export type WorkflowRunnerState = 'inactive' | 'armed' | 'running' | 'needs_review' | 'failed';

export type TriggerKind = 'hotkey' | 'timer' | 'screen-state' | 'screen-detection' | 'reference-image' | 'region-visible' | 'voice';
export type TriggerBooleanOperator = 'all' | 'any';
export type CaptureKind = 'full-screen' | 'active-window' | 'region';
export type CaptureSourceKind = 'cursor-display' | 'primary-display' | 'display-id' | 'window-title';
export type ExtractorKind = 'mock-regex' | 'ollama-vision';
export type ActionKind = 'append-csv' | 'xlsx' | 'clipboard' | 'webhook' | 'local-script' | 'keyboard-mouse';
export type WorkflowCapabilityKind = 'screen-capture' | 'local-vision' | 'spreadsheet-output' | 'clipboard-output' | 'voice-output' | 'keyboard-mouse-output';
export type PermissionCapability =
  | 'screen-region-capture'
  | 'screen-observation'
  | 'local-ai-analysis'
  | 'propose-actions'
  | 'browser-prompt'
  | 'command-help';
export type StoredPermissionApproval = 'always';

export type WorkflowNodeType = 'trigger' | 'capture' | 'extract' | 'validate' | 'review' | 'action';
export type WorkflowNodeCategory = 'trigger' | 'observe' | 'think' | 'guard' | 'act';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  category?: WorkflowNodeCategory;
  title: string;
  summary: string;
  config: Record<string, unknown>;
}

export interface TriggerCondition {
  id: string;
  kind: TriggerKind;
  summary: string;
  config: Record<string, unknown>;
}

export interface TriggerExpression {
  id: string;
  op: TriggerBooleanOperator;
  conditions: Array<TriggerCondition | TriggerExpression>;
}

export interface Workflow {
  schemaVersion?: number;
  id: string;
  name: string;
  status: WorkflowStatus;
  runnerState?: WorkflowRunnerState;
  autoAppend?: boolean;
  lastRunStatus?: string;
  lastSuccessfulAppend?: string;
  summaryInstructions?: string;
  trigger: {
    kind: TriggerKind;
    summary: string;
    logic?: TriggerExpression;
    hotkey?: string;
    detectionIntervalSeconds?: 1 | 2 | 5 | 10;
    detectionCooldownSeconds?: number;
    duplicateDetectionEnabled?: boolean;
    experimental?: boolean;
  };
  nodes: WorkflowNode[];
  lastRun?: string;
  lastResult?: string;
}

export interface AppSettings {
  ai: {
    provider: 'ollama';
    endpoint: string;
    preferredModel: string;
  };
  capture: {
    defaultMode: CaptureKind;
  };
  safety: {
    requireScriptConfirmation: boolean;
    autoTrustWorkflowSaving: boolean;
    capabilityApprovals: Partial<Record<PermissionCapability, StoredPermissionApproval>>;
  };
}

export interface ExtractionResult {
  fish_name: string;
  exp_gained: string;
  weight: string;
  class_tier: string;
  bait_used: string;
  confidence: number;
  notes: string;
  fields?: Record<string, StructuredFieldValue>;
  rawFields?: Record<string, string>;
}

export type StructuredFieldValue = string | number | boolean | null;

export interface StructuredExtraction {
  confidence: number;
  fields: Record<string, StructuredFieldValue>;
  rawFields?: Record<string, string>;
  notes?: string;
}

export interface ObservationField {
  value: StructuredFieldValue;
  confidence?: number;
  sourceRegion?: CaptureRegion;
  normalized?: StructuredFieldValue;
  raw?: string;
}

export interface StructuredObservation {
  observationId: string;
  schemaId?: string;
  createdAt: string;
  source: {
    kind: 'capture' | 'manual';
    captureId?: string;
    captureMode?: CaptureKind;
    sourceName?: string;
    sourceKind?: CaptureSourceKind;
    region?: CaptureRegion;
    retained: boolean;
  };
  fields: Record<string, ObservationField>;
  confidence: number;
  matchedReferences?: string[];
  warnings: string[];
  notes?: string;
}

export interface WorkflowRunTrace {
  runId: string;
  trigger: {
    source: 'manual' | 'hotkey' | 'detection';
    receivedAt: string;
  };
  observation?: StructuredObservation;
  validation?: {
    ok: boolean;
    issues: string[];
  };
  action?: {
    kind: ActionKind | 'unknown';
    outputPath?: string;
    status: 'skipped' | 'pending_review' | 'success' | 'failed';
  };
}

export interface CaptureMetadata {
  id: string;
  createdAt: string;
  mode: CaptureKind;
  path: string;
  sourceName: string;
  sourceKind?: CaptureSourceKind;
  region?: CaptureRegion;
  width: number;
  height: number;
}

export interface CaptureDisplaySource {
  id: string;
  label: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isPrimary: boolean;
}

export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowExampleImage {
  id: string;
  refName: string;
  label: string;
  path: string;
  addedAt: string;
  use: 'trigger-reference' | 'extraction-example';
  nodeId?: string;
  notes?: string;
}

export interface WorkflowCapabilityRequirement {
  kind: WorkflowCapabilityKind;
  label: string;
  reason: string;
  required: boolean;
  suggestedModel?: string;
  installHint?: string;
}

export interface SetupActionResult {
  ok: boolean;
  message: string;
}

export interface WorkflowRunPreview {
  runId: string;
  workflowId: string;
  workflowName: string;
  createdAt: string;
  screenshotPath: string;
  outputPath: string;
  extraction: ExtractionResult;
  structuredExtraction?: StructuredExtraction;
  observation?: StructuredObservation;
  trace?: WorkflowRunTrace;
  capture: CaptureMetadata;
  validationIssues?: string[];
}

export interface WorkflowRunResult {
  preview?: WorkflowRunPreview;
  appended?: boolean;
  ignored?: boolean;
  message?: string;
  outputPath?: string;
}

export type WorkflowRunStage = 'queued' | 'capture' | 'extract' | 'validate' | 'review' | 'action' | 'done' | 'failed' | 'ignored';
export type WorkflowRunProgressStatus = 'running' | 'complete' | 'blocked' | 'failed' | 'skipped';

export interface WorkflowRunProgress {
  runId: string;
  workflowId: string;
  stage: WorkflowRunStage;
  status: WorkflowRunProgressStatus;
  message: string;
  updatedAt: string;
  outputPath?: string;
  issues?: string[];
}

export interface CsvFishingRow extends ExtractionResult {
  timestamp: string;
  workflow_name: string;
  screenshot_path: string;
}

export interface MacroOutputRow {
  timestamp: string;
  workflow_name: string;
  confidence: number;
  notes: string;
  fields: Record<string, StructuredFieldValue>;
}

export interface AppLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface OllamaStatus {
  state: 'not_found' | 'installed_not_running' | 'running' | 'model_available';
  endpoint: string;
  selectedModel: string;
  models: string[];
  message: string;
}
