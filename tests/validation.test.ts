import { describe, expect, it } from 'vitest';
import { validateFishingExtraction } from '../src/main/services/validation';

describe('fishing validation', () => {
  it('validation failure does not produce an auto-writable result', () => {
    const validation = validateFishingExtraction({
      fish_name: '',
      exp_gained: 'nineteen',
      weight: '847 g',
      class_tier: 'B',
      bait_used: '',
      confidence: 0.9,
      notes: ''
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContain('fish_name is required.');
    expect(validation.issues).toContain('exp_gained must be numeric.');
  });

  it('keeps unknown class text but flags low confidence', () => {
    const validation = validateFishingExtraction({
      fish_name: 'Blue-striped Grouper',
      exp_gained: '19',
      weight: '847 g',
      class_tier: 'Ultra',
      bait_used: '',
      confidence: 0.95,
      notes: ''
    });

    expect(validation.ok).toBe(true);
    expect(validation.result.class_tier).toBe('Ultra');
    expect(validation.result.confidence).toBeLessThanOrEqual(0.55);
  });

  it('rejects class or rarity values in the fish name field', () => {
    const validation = validateFishingExtraction({
      fish_name: 'Rare',
      exp_gained: '100',
      weight: '2298 g',
      class_tier: 'Rare',
      bait_used: '',
      confidence: 0.5,
      notes: ''
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.join(' ')).toMatch(/class\/tier/);
  });

  it('rejects placeholder and generic model outputs before auto-writing', () => {
    const validation = validateFishingExtraction({
      fish_name: 'Not visible in image',
      exp_gained: '100',
      weight: '5 lbs',
      class_tier: 'Rare',
      bait_used: 'Not visible in image',
      confidence: 0.8,
      notes: 'Not visible in image'
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContain('fish_name is required.');
    expect(validation.result.bait_used).toBe('');
  });

  it('rejects generic catch-result labels as fish names', () => {
    const validation = validateFishingExtraction({
      fish_name: 'Catch-result screen',
      exp_gained: '100',
      weight: '5 lbs',
      class_tier: '',
      bait_used: '',
      confidence: 0.8,
      notes: ''
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContain('fish_name is too generic to auto-write.');
  });
});
