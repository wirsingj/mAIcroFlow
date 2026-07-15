import type { ExtractionResult, MacroOutputRow, Workflow, WorkflowRunPreview } from '../../shared/types';
import { appendMacroCsvRow, appendMacroWorkbookRow, renderMacroClipboardText } from './actions';
import { includesLegacyFishingFields, toStructuredExtraction } from './structuredExtraction';
import { validateFishingExtraction, type ValidationResult } from './validation';
import { getActionKind } from './workflowPolicy';

export interface ActionExecutionResult {
  summaryUpdated: boolean;
  message?: string;
}

export function validateWorkflowExtraction(workflow: Workflow, extraction: ExtractionResult): ValidationResult {
  const validateNode = workflow.nodes.find((node) => node.type === 'validate');
  const requiredFields = asStringArray(validateNode?.config.requiredFields);
  const numericFields = asStringArray(validateNode?.config.numericFields);

  const structured = toStructuredExtraction(extraction);
  const fieldValue = (field: string) => structured.fields[field];
  const issues: string[] = [];

  for (const field of requiredFields) {
    const value = fieldValue(field);
    if (value === null || String(value ?? '').trim() === '') {
      issues.push(`${field} is required.`);
    }
  }

  for (const field of numericFields) {
    const value = fieldValue(field);
    if (value === null || String(value ?? '').trim() === '' || !Number.isFinite(Number(String(value).replace(/,/g, '')))) {
      issues.push(`${field} must be numeric.`);
    }
  }

  const hasStructuredValue = Object.values(structured.fields).some((value) => value !== null && String(value).trim() !== '');
  if (!hasStructuredValue) {
    issues.push('No visible values were extracted.');
  }

  const strictFishing =
    Object.keys(structured.fields).length === 0 &&
    includesLegacyFishingFields([...requiredFields, ...numericFields]);

  if (strictFishing) {
    return validateFishingExtraction(extraction);
  }

  const normalized: ExtractionResult = {
    ...extraction,
    fish_name: String(extraction.fish_name ?? '').trim(),
    exp_gained: String(extraction.exp_gained ?? '').trim(),
    weight: String(extraction.weight ?? '').trim(),
    class_tier: String(extraction.class_tier ?? '').trim(),
    bait_used: String(extraction.bait_used ?? '').trim(),
    confidence: normalizeConfidence(extraction.confidence),
    notes: String(extraction.notes ?? '').trim()
  };

  return {
    ok: issues.length === 0,
    issues,
    result: normalized
  };
}

export async function executeWorkflowAction(
  workflow: Workflow | undefined,
  preview: WorkflowRunPreview,
  extraction: ExtractionResult
): Promise<ActionExecutionResult> {
  const structured = toStructuredExtraction(extraction);
  const row: MacroOutputRow = {
    timestamp: new Date().toISOString(),
    workflow_name: preview.workflowName,
    confidence: normalizeConfidence(extraction.confidence),
    notes: extraction.notes,
    fields: structured.fields
  };

  const actionKind = workflow ? getActionKind(workflow) : preview.outputPath === 'clipboard' ? 'clipboard' : 'append-csv';
  if (actionKind === 'clipboard') {
    await writeClipboardText(renderMacroClipboardText(row));
    return { summaryUpdated: false, message: 'Copied structured fields to clipboard' };
  }

  if (actionKind === 'xlsx' || preview.outputPath.toLowerCase().endsWith('.xlsx')) {
    await appendMacroWorkbookRow(row, preview.outputPath);
  } else {
    await appendMacroCsvRow(row, preview.outputPath);
  }
  return { summaryUpdated: true };
}

async function writeClipboardText(text: string): Promise<void> {
  const { clipboard } = await import('electron');
  clipboard.writeText(text);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizeConfidence(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }
  if (numberValue > 1) {
    return Math.min(1, numberValue / 100);
  }
  return Math.max(0, Math.min(1, numberValue));
}
