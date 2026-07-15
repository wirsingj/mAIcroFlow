import type { TriggerKind, Workflow, WorkflowNodeType, WorkflowStatus } from './types';
import { normalizeNodeCategory } from './nodeTaxonomy';

export const CURRENT_WORKFLOW_SCHEMA_VERSION = 1;
type WorkflowMigration = (value: Record<string, unknown>) => Record<string, unknown>;

const workflowMigrations: Record<number, WorkflowMigration> = {
  0: (value) => ({ ...value, schemaVersion: 1 })
};

const workflowStatuses: WorkflowStatus[] = ['active', 'paused', 'disabled'];
const triggerKinds: TriggerKind[] = [
  'hotkey',
  'timer',
  'screen-state',
  'screen-detection',
  'reference-image',
  'region-visible',
  'voice'
];
const nodeTypes: WorkflowNodeType[] = ['trigger', 'capture', 'extract', 'validate', 'review', 'action'];

export function validateWorkflow(value: unknown): Workflow {
  if (!isObject(value)) {
    throw new Error('Workflow must be an object.');
  }

  const workflow = migrateWorkflowValue(value) as Workflow;
  workflow.schemaVersion = readWorkflowSchemaVersion(workflow as unknown as Record<string, unknown>);
  requireString(workflow.id, 'workflow.id');
  requireString(workflow.name, 'workflow.name');

  if (!workflowStatuses.includes(workflow.status)) {
    throw new Error(`workflow.status must be one of ${workflowStatuses.join(', ')}.`);
  }

  if (!isObject(workflow.trigger)) {
    throw new Error('workflow.trigger must be an object.');
  }
  if (!triggerKinds.includes(workflow.trigger.kind)) {
    throw new Error(`workflow.trigger.kind must be one of ${triggerKinds.join(', ')}.`);
  }
  requireString(workflow.trigger.summary, 'workflow.trigger.summary');
  if (workflow.trigger.logic !== undefined) {
    validateTriggerExpression(workflow.trigger.logic, 'workflow.trigger.logic');
  }

  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    throw new Error('workflow.nodes must be a non-empty array.');
  }

  for (const node of workflow.nodes) {
    if (!isObject(node)) {
      throw new Error('workflow.nodes entries must be objects.');
    }
    requireString(node.id, 'workflow.nodes[].id');
    requireString(node.title, 'workflow.nodes[].title');
    requireString(node.summary, 'workflow.nodes[].summary');
    node.type = normalizeNodeType(node.type);
    if (!nodeTypes.includes(node.type)) {
      throw new Error(`workflow.nodes[].type must be one of ${nodeTypes.join(', ')}.`);
    }
    if (!isObject(node.config)) {
      throw new Error('workflow.nodes[].config must be an object.');
    }
    Object.assign(node, normalizeNodeCategory(node));
  }

  return workflow;
}

export function migrateWorkflowValue(value: unknown): unknown {
  if (!isObject(value)) {
    return value;
  }

  let version = readWorkflowSchemaVersion(value);
  let migrated = { ...value };
  while (version < CURRENT_WORKFLOW_SCHEMA_VERSION) {
    const migrate = workflowMigrations[version];
    if (!migrate) {
      throw new Error(`No workflow migration is available from schemaVersion ${version}.`);
    }
    migrated = migrate(migrated);
    version = readWorkflowSchemaVersion(migrated);
  }
  return migrated;
}

export function validateWorkflows(value: unknown): Workflow[] {
  if (!Array.isArray(value)) {
    throw new Error('Workflows file must contain an array.');
  }
  return value.map(validateWorkflow);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
}

function normalizeNodeType(value: unknown): WorkflowNodeType {
  if (value === 'confirm') {
    return 'review';
  }
  return value as WorkflowNodeType;
}

function readWorkflowSchemaVersion(value: Record<string, unknown>): number {
  if (value.schemaVersion === undefined || value.schemaVersion === null) {
    return 0;
  }

  const version = Number(value.schemaVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('workflow.schemaVersion must be a positive integer.');
  }
  if (version > CURRENT_WORKFLOW_SCHEMA_VERSION) {
    throw new Error(`workflow.schemaVersion ${version} is newer than this app supports.`);
  }
  return version;
}

function validateTriggerExpression(value: unknown, name: string): void {
  if (!isObject(value)) {
    throw new Error(`${name} must be an object.`);
  }

  requireString(value.id, `${name}.id`);
  if (value.op !== 'all' && value.op !== 'any') {
    throw new Error(`${name}.op must be all or any.`);
  }

  if (!Array.isArray(value.conditions) || value.conditions.length === 0) {
    throw new Error(`${name}.conditions must be a non-empty array.`);
  }

  for (const [index, condition] of value.conditions.entries()) {
    const conditionName = `${name}.conditions[${index}]`;
    if (!isObject(condition)) {
      throw new Error(`${conditionName} must be an object.`);
    }

    if ('op' in condition) {
      validateTriggerExpression(condition, conditionName);
      continue;
    }

    requireString(condition.id, `${conditionName}.id`);
    requireString(condition.summary, `${conditionName}.summary`);
    if (!triggerKinds.includes(condition.kind as TriggerKind)) {
      throw new Error(`${conditionName}.kind must be one of ${triggerKinds.join(', ')}.`);
    }
    if (!isObject(condition.config)) {
      throw new Error(`${conditionName}.config must be an object.`);
    }
  }
}
