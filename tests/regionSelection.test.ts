import { describe, expect, it } from 'vitest';
import { displaySourceForRegion, displayUnionBounds, normalizePickedRegion } from '../src/main/services/regionSelection';

describe('region selection helpers', () => {
  const displays = [
    { id: 1, bounds: { x: -1280, y: 0, width: 1280, height: 720 } },
    { id: 2, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  ];

  it('normalizes a dragged rectangle regardless of drag direction', () => {
    expect(normalizePickedRegion({ x: 400, y: 300 }, { x: 100, y: 80 })).toEqual({
      x: 100,
      y: 80,
      width: 300,
      height: 220
    });
  });

  it('selects the display containing the picked region center', () => {
    expect(displaySourceForRegion(displays, { x: -900, y: 50, width: 200, height: 100 })).toEqual({
      source: 'display-id',
      displayId: '1',
      region: { x: -900, y: 50, width: 200, height: 100 }
    });
  });

  it('computes a union for multi-monitor overlays', () => {
    expect(displayUnionBounds(displays)).toEqual({ x: -1280, y: 0, width: 3200, height: 1080 });
  });
});
