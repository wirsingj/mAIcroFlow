import type { StructuredFieldValue, Workflow } from './types';

export const liveIntentionFields = [
  'visible_state',
  'repeatable_pattern',
  'guard_condition',
  'suggested_action'
] as const;

export type LiveIntentionField = (typeof liveIntentionFields)[number];

export const liveIntentionFieldLabels: Record<LiveIntentionField, string> = {
  visible_state: 'Visible state',
  repeatable_pattern: 'Repeatable pattern',
  guard_condition: 'Guard condition',
  suggested_action: 'Suggested action'
};

export const liveIntentionFieldDescriptions: Record<LiveIntentionField, string> = {
  visible_state: 'What the selected region visibly shows right now.',
  repeatable_pattern: 'The routine the app thinks may repeat from this visible state.',
  guard_condition: 'The condition that should be true before any future action is allowed.',
  suggested_action: 'A proposed action for review only; it is not executed by this flow.'
};

export interface LiveIntentionProposal {
  visibleState: string;
  repeatablePattern: string;
  guardCondition: string;
  suggestedAction: string;
}

export interface LiveIntentionDraftChange {
  nodeId: string;
  nodeTitle: string;
  nodeType: string;
  changes: Array<{
    label: string;
    before: string;
    after: string;
  }>;
}

export function hasLiveIntentionFields(fields: Record<string, StructuredFieldValue>): boolean {
  return liveIntentionFields.every((field) => Object.prototype.hasOwnProperty.call(fields, field));
}

export function liveIntentionProposalFromFields(fields: Record<string, StructuredFieldValue>): LiveIntentionProposal {
  return {
    visibleState: stringField(fields.visible_state),
    repeatablePattern: stringField(fields.repeatable_pattern),
    guardCondition: stringField(fields.guard_condition),
    suggestedAction: stringField(fields.suggested_action)
  };
}

export function applyLiveIntentionProposalToWorkflow(workflow: Workflow, proposal: LiveIntentionProposal): Workflow {
  const guardSummary = proposal.guardCondition || 'Review the selected region before acting';
  const patternSummary = proposal.repeatablePattern || 'User-reviewed live intention pattern';
  const actionSummary = proposal.suggestedAction || 'No action approved yet';

  return {
    ...workflow,
    status: 'paused',
    runnerState: 'inactive',
    autoAppend: false,
    lastRunStatus: 'proposal applied',
    lastResult: 'Live proposal applied to draft. Review nodes before arming.',
    summaryInstructions: [
      'Live intention proposal applied to editable draft.',
      proposal.visibleState ? `Visible state: ${proposal.visibleState}` : '',
      proposal.repeatablePattern ? `Pattern: ${proposal.repeatablePattern}` : '',
      proposal.guardCondition ? `Guard: ${proposal.guardCondition}` : '',
      proposal.suggestedAction ? `Suggested action: ${proposal.suggestedAction}` : ''
    ].filter(Boolean).join('\n'),
    trigger: {
      ...workflow.trigger,
      summary: guardSummary
    },
    nodes: workflow.nodes.map((node) => {
      if (node.type === 'trigger') {
        return {
          ...node,
          title: 'When the reviewed guard applies',
          summary: guardSummary,
          config: {
            ...node.config,
            proposedGuardCondition: proposal.guardCondition
          }
        };
      }
      if (node.type === 'extract') {
        return {
          ...node,
          title: 'Interpret selected region',
          summary: patternSummary,
          config: {
            ...node.config,
            proposedVisibleState: proposal.visibleState,
            proposedRepeatablePattern: proposal.repeatablePattern,
            prompt: liveIntentionPromptFromProposal(proposal)
          }
        };
      }
      if (node.type === 'review') {
        return {
          ...node,
          title: 'Review before action',
          summary: 'Human approval is required before using the suggested action.'
        };
      }
      if (node.type === 'action') {
        return {
          ...node,
          title: 'Keep suggested action reviewed',
          summary: `Suggested only: ${actionSummary}`,
          config: {
            ...node.config,
            kind: 'clipboard',
            proposedAction: proposal.suggestedAction,
            prompt: `Copy the reviewed live-intention proposal to the clipboard. Suggested action remains proposal-only: ${actionSummary}`
          }
        };
      }
      return node;
    })
  };
}

export function liveIntentionDraftDiff(workflow: Workflow, proposal: LiveIntentionProposal): LiveIntentionDraftChange[] {
  const next = applyLiveIntentionProposalToWorkflow(workflow, proposal);
  const diff: LiveIntentionDraftChange[] = [];
  for (const nextNode of next.nodes) {
    const currentNode = workflow.nodes.find((node) => node.id === nextNode.id);
    if (!currentNode) continue;
    const changes = [
      textChange('Title', currentNode.title, nextNode.title),
      textChange('Summary', currentNode.summary, nextNode.summary),
      textChange('Prompt', configString(currentNode.config.prompt), configString(nextNode.config.prompt)),
      textChange('Guard metadata', configString(currentNode.config.proposedGuardCondition), configString(nextNode.config.proposedGuardCondition)),
      textChange('Visible-state metadata', configString(currentNode.config.proposedVisibleState), configString(nextNode.config.proposedVisibleState)),
      textChange('Pattern metadata', configString(currentNode.config.proposedRepeatablePattern), configString(nextNode.config.proposedRepeatablePattern)),
      textChange('Action metadata', configString(currentNode.config.proposedAction), configString(nextNode.config.proposedAction))
    ].filter(isChange);
    if (!changes.length) continue;
    diff.push({
      nodeId: nextNode.id,
      nodeTitle: nextNode.title,
      nodeType: nextNode.type,
      changes
    });
  }
  return diff;
}

function liveIntentionPromptFromProposal(proposal: LiveIntentionProposal): string {
  return [
    'Analyze only the selected visible screen region. Return strict JSON with visible_state, repeatable_pattern, guard_condition, and suggested_action.',
    proposal.visibleState ? `Previously reviewed visible state: ${proposal.visibleState}` : '',
    proposal.repeatablePattern ? `Previously reviewed repeatable pattern: ${proposal.repeatablePattern}` : '',
    proposal.guardCondition ? `Previously reviewed guard condition: ${proposal.guardCondition}` : '',
    'Suggested actions are proposal data only. Do not execute or assume hidden target-app state.'
  ].filter(Boolean).join(' ');
}

function stringField(value: StructuredFieldValue | undefined): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function configString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textChange(label: string, before: string, after: string): LiveIntentionDraftChange['changes'][number] | undefined {
  if (before === after) {
    return undefined;
  }
  return { label, before, after };
}

function isChange(value: LiveIntentionDraftChange['changes'][number] | undefined): value is LiveIntentionDraftChange['changes'][number] {
  return Boolean(value);
}
