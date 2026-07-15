import type { WorkflowNode, WorkflowNodeCategory, WorkflowNodeType } from './types';

export interface WorkflowNodeCategoryInfo {
  category: WorkflowNodeCategory;
  label: string;
  intent: string;
}

const nodeCategoryByType: Record<WorkflowNodeType, WorkflowNodeCategoryInfo> = {
  trigger: {
    category: 'trigger',
    label: 'Trigger',
    intent: 'Decides when a workflow should start.'
  },
  capture: {
    category: 'observe',
    label: 'Observe',
    intent: 'Reads user-visible pixels through normal OS capture APIs.'
  },
  extract: {
    category: 'think',
    label: 'Think',
    intent: 'Uses deterministic parsing or local AI to interpret captured context.'
  },
  validate: {
    category: 'guard',
    label: 'Guard',
    intent: 'Checks structured results before any output action can run.'
  },
  review: {
    category: 'guard',
    label: 'Guard',
    intent: 'Lets the user inspect or correct results when policy or validation requires it.'
  },
  action: {
    category: 'act',
    label: 'Act',
    intent: 'Performs explicit user-configured output through normal OS or file APIs.'
  }
};

export function categoryForNodeType(type: WorkflowNodeType): WorkflowNodeCategory {
  return nodeCategoryByType[type].category;
}

export function describeNodeCategory(node: WorkflowNode): WorkflowNodeCategoryInfo {
  return nodeCategoryByType[node.type];
}

export function normalizeNodeCategory(node: WorkflowNode): WorkflowNode {
  return {
    ...node,
    category: categoryForNodeType(node.type)
  };
}
