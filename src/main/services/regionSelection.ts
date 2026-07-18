import type { CaptureDisplaySource, CaptureRegion } from '../../shared/types';

interface DisplayLike {
  id: number;
  bounds: CaptureRegion;
}

export interface PickedCaptureRegion {
  source: 'display-id';
  displayId: string;
  region: CaptureRegion;
}

export function normalizePickedRegion(start: { x: number; y: number }, end: { x: number; y: number }): CaptureRegion {
  return {
    x: Math.round(Math.min(start.x, end.x)),
    y: Math.round(Math.min(start.y, end.y)),
    width: Math.max(1, Math.round(Math.abs(end.x - start.x))),
    height: Math.max(1, Math.round(Math.abs(end.y - start.y)))
  };
}

export function displaySourceForRegion(displays: DisplayLike[], region: CaptureRegion): PickedCaptureRegion {
  const center = {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2
  };
  const display = displays.find((item) => pointInRegion(center, item.bounds)) ?? displayWithLargestIntersection(displays, region) ?? displays[0];
  if (!display) {
    throw new Error('No display is available for region selection.');
  }

  return {
    source: 'display-id',
    displayId: String(display.id),
    region
  };
}

export function displayUnionBounds(displays: DisplayLike[]): CaptureRegion {
  if (!displays.length) {
    throw new Error('No display is available for region selection.');
  }

  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

export function captureDisplaySourceFromPickedRegion(displays: CaptureDisplaySource[], region: CaptureRegion): PickedCaptureRegion {
  return displaySourceForRegion(
    displays.map((display) => ({ id: Number(display.id), bounds: display.bounds })),
    region
  );
}

function pointInRegion(point: { x: number; y: number }, region: CaptureRegion): boolean {
  return point.x >= region.x && point.x < region.x + region.width && point.y >= region.y && point.y < region.y + region.height;
}

function displayWithLargestIntersection(displays: DisplayLike[], region: CaptureRegion): DisplayLike | undefined {
  return displays
    .map((display) => ({ display, area: intersectionArea(display.bounds, region) }))
    .filter((item) => item.area > 0)
    .sort((left, right) => right.area - left.area)[0]?.display;
}

function intersectionArea(left: CaptureRegion, right: CaptureRegion): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}
