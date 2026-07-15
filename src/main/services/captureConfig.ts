import type { CaptureRegion, CaptureSourceKind, Workflow } from '../../shared/types';

export interface CaptureOptions {
  source?: Exclude<CaptureSourceKind, 'window-title'>;
  displayId?: string;
  region?: CaptureRegion;
}

export function captureOptionsFromWorkflow(workflow: Workflow): CaptureOptions {
  const captureNode = workflow.nodes.find((node) => node.type === 'capture');
  if (!captureNode) {
    throw new Error('Workflow is missing an explicit capture node.');
  }

  const source = captureNode.config.source;
  const displayId = captureNode.config.displayId;
  const region = captureRegionFromConfig(captureNode.config);

  if (source === 'cursor-display' || source === 'primary-display') {
    return { source, region };
  }

  if (source === 'display-id') {
    if (typeof displayId !== 'string' || displayId.trim().length === 0) {
      throw new Error('Specific-monitor capture requires an explicit displayId.');
    }
    return { source, displayId, region };
  }

  throw new Error(`Unsupported capture source "${String(source)}".`);
}

function captureRegionFromConfig(config: Record<string, unknown>): CaptureRegion | undefined {
  if (config.mode !== 'region') {
    return undefined;
  }

  const rawRegion = config.region;
  if (!rawRegion || typeof rawRegion !== 'object' || Array.isArray(rawRegion)) {
    throw new Error('Region capture requires an explicit rectangle.');
  }

  const region = rawRegion as Record<string, unknown>;
  const x = numericRegionValue(region.x, 'x');
  const y = numericRegionValue(region.y, 'y');
  const width = numericRegionValue(region.width, 'width');
  const height = numericRegionValue(region.height, 'height');
  if (width <= 0 || height <= 0) {
    throw new Error('Region capture width and height must be greater than zero.');
  }

  return { x, y, width, height };
}

function numericRegionValue(value: unknown, label: string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Region capture ${label} must be a number.`);
  }
  return Math.round(numberValue);
}
