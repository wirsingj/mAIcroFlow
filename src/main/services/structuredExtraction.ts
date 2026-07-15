import type { CaptureMetadata, ExtractionResult, StructuredExtraction, StructuredFieldValue, StructuredObservation } from '../../shared/types';
import { parseNumberText } from './validation';

export const legacyFishingFieldNames = ['fish_name', 'exp_gained', 'weight', 'class_tier', 'bait_used'] as const;

export function includesLegacyFishingFields(fields: string[]): boolean {
  const legacyNames = new Set<string>(legacyFishingFieldNames);
  return fields.some((field) => legacyNames.has(field));
}

export function toStructuredExtraction(extraction: ExtractionResult): StructuredExtraction {
  const directFields = extraction.fields ?? {};
  const directRawFields = extraction.rawFields ?? {};
  const fields: Record<string, StructuredFieldValue> = {};
  const rawFields: Record<string, string> = {};

  for (const [key, value] of Object.entries(directFields)) {
    fields[key] = value;
    rawFields[key] = directRawFields[key] ?? String(value ?? '');
  }

  if (Object.keys(fields).length === 0) {
    for (const key of legacyFishingFieldNames) {
      const rawValue = String(extraction[key] ?? '').trim();
      if (!rawValue) continue;
      fields[key] = key === 'exp_gained' ? nullableNumber(rawValue) : rawValue;
      rawFields[key] = rawValue;
    }
  }

  return {
    confidence: extraction.confidence,
    fields,
    rawFields,
    notes: extraction.notes
  };
}

export function toStructuredObservation(extraction: ExtractionResult, capture: CaptureMetadata, runId: string): StructuredObservation {
  const structured = toStructuredExtraction(extraction);
  const fields = Object.fromEntries(
    Object.entries(structured.fields).map(([key, value]) => [
      key,
      {
        value,
        confidence: extraction.confidence,
        raw: structured.rawFields?.[key]
      }
    ])
  );

  return {
    observationId: `obs-${runId}`,
    schemaId: 'macro.structured.v0',
    createdAt: new Date().toISOString(),
    source: {
      kind: 'capture',
      captureId: capture.id,
      captureMode: capture.mode,
      sourceName: capture.sourceName,
      sourceKind: capture.sourceKind,
      region: capture.region,
      retained: false
    },
    fields,
    confidence: extraction.confidence,
    matchedReferences: [],
    warnings: genericObservationWarnings(structured),
    notes: extraction.notes
  };
}

export function firstUsefulFieldLabel(extraction: ExtractionResult): string {
  const structured = toStructuredExtraction(extraction);
  const firstEntry = Object.entries(structured.fields).find(([, value]) => value !== null && String(value).trim() !== '');
  if (!firstEntry) {
    return 'row';
  }
  return `${firstEntry[0]}: ${firstEntry[1]}`;
}

export function toStructuredFishingExtraction(extraction: ExtractionResult): StructuredExtraction {
  return {
    confidence: extraction.confidence,
    fields: {
      fish_name: nullableString(extraction.fish_name),
      exp_gained: nullableNumber(extraction.exp_gained),
      weight: nullableString(extraction.weight),
      class_tier: nullableString(extraction.class_tier),
      bait_used: nullableString(extraction.bait_used)
    },
    rawFields: {
      fish_name: extraction.fish_name,
      exp_gained: extraction.exp_gained,
      weight: extraction.weight,
      class_tier: extraction.class_tier,
      bait_used: extraction.bait_used
    },
    notes: extraction.notes
  };
}

export function toFishingObservation(extraction: ExtractionResult, capture: CaptureMetadata, runId: string): StructuredObservation {
  const structured = toStructuredFishingExtraction(extraction);
  const fields = Object.fromEntries(
    Object.entries(structured.fields).map(([key, value]) => [
      key,
      {
        value,
        confidence: extraction.confidence,
        raw: structured.rawFields?.[key]
      }
    ])
  );

  return {
    observationId: `obs-${runId}`,
    schemaId: 'template.fishing.v0',
    createdAt: new Date().toISOString(),
    source: {
      kind: 'capture',
      captureId: capture.id,
      captureMode: capture.mode,
      sourceName: capture.sourceName,
      sourceKind: capture.sourceKind,
      region: capture.region,
      retained: false
    },
    fields,
    confidence: extraction.confidence,
    matchedReferences: [],
    warnings: observationWarnings(extraction),
    notes: extraction.notes
  };
}

function genericObservationWarnings(extraction: StructuredExtraction): string[] {
  const warnings: string[] = [];
  const hasValue = Object.values(extraction.fields).some((value) => value !== null && String(value).trim() !== '');
  if (!hasValue) {
    warnings.push('no_visible_values');
  }
  if (extraction.confidence < 0.5) {
    warnings.push('low_confidence');
  }
  return warnings;
}

function observationWarnings(extraction: ExtractionResult): string[] {
  const warnings: string[] = [];
  if (!extraction.fish_name.trim()) {
    warnings.push('fish_name_missing');
  }
  if (!parseNumberText(extraction.exp_gained)) {
    warnings.push('exp_gained_not_numeric');
  }
  if (extraction.confidence < 0.5) {
    warnings.push('low_confidence');
  }
  return warnings;
}

function nullableString(value: string): StructuredFieldValue {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string): StructuredFieldValue {
  return parseNumberText(value);
}
