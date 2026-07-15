import { describe, expect, it } from 'vitest';
import { extractFishingResult, normalizeExtraction } from '../src/main/services/extractor';
import { toFishingObservation, toStructuredExtraction, toStructuredFishingExtraction, toStructuredObservation } from '../src/main/services/structuredExtraction';
import type { CaptureMetadata } from '../src/shared/types';

describe('extractor normalization', () => {
  it('clamps confidence and collapses whitespace', () => {
    const result = normalizeExtraction({
      fish_name: '  River   Pike ',
      confidence: 2
    });

    expect(result.fish_name).toBe('River Pike');
    expect(result.confidence).toBe(1);
  });

  it('parses manual fishing text with deterministic regex rules', () => {
    const result = extractFishingResult('Fish: Glacier Trout\nEXP: 140\nWeight: 2.6 lb\nTier: Rare\nBait: Minnow');

    expect(result.fish_name).toBe('Glacier Trout');
    expect(result.exp_gained).toBe('140');
    expect(result.bait_used).toBe('Minnow');
  });

  it('adapts fishing extraction to the generic structured contract', () => {
    const structured = toStructuredFishingExtraction({
      fish_name: 'Glacier Trout',
      exp_gained: '140',
      weight: '',
      class_tier: 'Rare',
      bait_used: '',
      confidence: 0.91,
      notes: 'ok'
    });

    expect(structured.confidence).toBe(0.91);
    expect(structured.fields.fish_name).toBe('Glacier Trout');
    expect(structured.fields.exp_gained).toBe(140);
    expect(structured.fields.weight).toBeNull();
    expect(structured.rawFields?.exp_gained).toBe('140');
  });

  it('uses generic extraction fields as the primary structured contract', () => {
    const structured = toStructuredExtraction({
      fish_name: '',
      exp_gained: '',
      weight: '',
      class_tier: '',
      bait_used: '',
      confidence: 0.82,
      notes: 'generic fields',
      fields: {
        age: 42,
        timestamp_value: '12:30'
      },
      rawFields: {
        age: '42',
        timestamp_value: '12:30'
      }
    });

    expect(structured.fields.age).toBe(42);
    expect(structured.fields.timestamp_value).toBe('12:30');
    expect(structured.rawFields?.age).toBe('42');
  });

  it('adapts fishing extraction to the generic observation contract', () => {
    const capture: CaptureMetadata = {
      id: 'capture-1',
      createdAt: '2026-05-11T12:00:00Z',
      mode: 'region',
      path: 'deleted',
      sourceName: 'Monitor 1',
      sourceKind: 'primary-display',
      region: { x: 10, y: 20, width: 640, height: 360 },
      width: 640,
      height: 360
    };
    const observation = toFishingObservation(
      {
        fish_name: 'Glacier Trout',
        exp_gained: '140',
        weight: '2.6 lb',
        class_tier: 'Rare',
        bait_used: 'Minnow',
        confidence: 0.91,
        notes: 'ok'
      },
      capture,
      'run-1'
    );

    expect(observation.schemaId).toBe('template.fishing.v0');
    expect(observation.source.retained).toBe(false);
    expect(observation.source.region).toEqual({ x: 10, y: 20, width: 640, height: 360 });
    expect(observation.fields.fish_name.value).toBe('Glacier Trout');
    expect(observation.fields.exp_gained.value).toBe(140);
    expect(observation.warnings).toEqual([]);
  });

  it('creates a generic observation without fishing schema leakage', () => {
    const capture = {
      id: 'capture-1',
      createdAt: '2026-05-11T12:00:00Z',
      mode: 'full-screen' as const,
      path: 'deleted_after_extraction',
      sourceName: 'Primary display',
      sourceKind: 'primary-display' as const,
      region: { x: 0, y: 100, width: 800, height: 600 },
      width: 1920,
      height: 1080
    };

    const observation = toStructuredObservation(
      {
        fish_name: '',
        exp_gained: '',
        weight: '',
        class_tier: '',
        bait_used: '',
        confidence: 0.9,
        notes: '',
        fields: { score: 100 }
      },
      capture,
      'run-1'
    );

    expect(observation.schemaId).toBe('macro.structured.v0');
    expect(observation.source.region).toEqual({ x: 0, y: 100, width: 800, height: 600 });
    expect(observation.fields.score.value).toBe(100);
    expect(observation.fields).not.toHaveProperty('fish_name');
  });
});
