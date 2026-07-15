import type { ExtractionResult } from '../../shared/types';

const emptyExtraction: ExtractionResult = {
  fish_name: '',
  exp_gained: '',
  weight: '',
  class_tier: '',
  bait_used: '',
  confidence: 0,
  notes: ''
};

export function normalizeExtraction(value: Partial<ExtractionResult> = {}): ExtractionResult {
  const confidence = Number(value.confidence ?? 0);
  return {
    fish_name: clean(value.fish_name),
    exp_gained: clean(value.exp_gained),
    weight: clean(value.weight),
    class_tier: clean(value.class_tier),
    bait_used: clean(value.bait_used),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    notes: clean(value.notes),
    fields: value.fields,
    rawFields: value.rawFields
  };
}

export function extractFishingResult(manualText = ''): ExtractionResult {
  const text = manualText.trim();
  if (!text) {
    return normalizeExtraction({
      ...emptyExtraction,
      fish_name: 'Unverified catch',
      confidence: 0.35,
      notes: 'Deterministic fallback: no readable text hints were supplied, so please edit the preview before saving.'
    });
  }

  return normalizeExtraction({
    fish_name: match(text, /(?:fish|catch|name)\s*[:\-]\s*([^\n,]+)/i),
    exp_gained: match(text, /(?:exp|xp|experience)\s*(?:gained)?\s*[:+\-]?\s*([0-9,]+)/i),
    weight: match(text, /(?:weight|wt)\s*[:\-]?\s*([0-9.]+\s*(?:kg|lb|lbs)?)/i),
    class_tier: match(text, /(?:class|tier|rank)\s*[:\-]\s*([^\n,]+)/i),
    bait_used: match(text, /(?:bait|lure)\s*[:\-]\s*([^\n,]+)/i),
    confidence: 0.72,
    notes: 'Parsed from supplied text using deterministic regex rules.'
  });
}

function match(text: string, pattern: RegExp): string {
  return pattern.exec(text)?.[1]?.trim() ?? '';
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
