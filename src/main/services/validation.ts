import type { ExtractionResult } from '../../shared/types';

export interface ValidationResult {
  ok: boolean;
  issues: string[];
  result: ExtractionResult;
}

const knownClassTiers = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 's', 'a', 'b', 'c', 'd']);
const missingValuePatterns = [
  /^not visible/i,
  /^not shown/i,
  /^not present/i,
  /^unknown$/i,
  /^n\/a$/i,
  /^none$/i,
  /^null$/i
];
const genericFishNames = [
  /^catch[- ]?result screen$/i,
  /^result screen$/i,
  /^fish$/i,
  /^fishing result$/i,
  /^catch summary$/i
];

export function validateFishingExtraction(extraction: ExtractionResult): ValidationResult {
  const issues: string[] = [];
  const result: ExtractionResult = {
    ...extraction,
    fish_name: normalizeVisibleField(extraction.fish_name),
    exp_gained: extraction.exp_gained.trim(),
    weight: normalizeVisibleField(extraction.weight),
    class_tier: extraction.class_tier.trim(),
    bait_used: normalizeVisibleField(extraction.bait_used),
    confidence: normalizeConfidence(extraction.confidence),
    notes: extraction.notes.trim()
  };

  if (!result.fish_name) {
    issues.push('fish_name is required.');
  }

  if (genericFishNames.some((pattern) => pattern.test(result.fish_name))) {
    issues.push('fish_name is too generic to auto-write.');
  }

  if (knownClassTiers.has(result.fish_name.toLowerCase())) {
    issues.push('fish_name appears to contain a class/tier instead of the fish name.');
  }

  if (!isNumericText(result.exp_gained)) {
    issues.push('exp_gained must be numeric.');
  }

  if (result.weight && !parseWeight(result.weight)) {
    issues.push('weight must include a numeric value when present.');
  }

  if (result.class_tier && !knownClassTiers.has(result.class_tier.toLowerCase())) {
    result.confidence = Math.min(result.confidence, 0.55);
    result.notes = appendNote(result.notes, `Unknown class/tier "${result.class_tier}" kept as raw text and marked low confidence.`);
  }

  if (!Number.isFinite(result.confidence)) {
    result.confidence = 0;
  }

  return {
    ok: issues.length === 0,
    issues,
    result
  };
}

export function isNumericText(value: string): boolean {
  const normalized = value.replace(/,/g, '').trim();
  return normalized.length > 0 && Number.isFinite(Number(normalized));
}

export function parseNumberText(value: string): number | null {
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWeight(value: string): number | null {
  return parseNumberText(value);
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value > 1) {
    return Math.min(1, value / 100);
  }
  return Math.max(0, Math.min(1, value));
}

function appendNote(notes: string, note: string): string {
  return notes ? `${notes} ${note}` : note;
}

function normalizeVisibleField(value: string): string {
  const trimmed = value.trim();
  return missingValuePatterns.some((pattern) => pattern.test(trimmed)) ? '' : trimmed;
}
