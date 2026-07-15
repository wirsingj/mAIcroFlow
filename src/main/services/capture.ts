import { desktopCapturer, screen } from 'electron';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { CaptureMetadata, CaptureSourceKind } from '../../shared/types';
import type { CaptureOptions } from './captureConfig';
export { captureOptionsFromWorkflow } from './captureConfig';

export async function captureFullScreen(options: CaptureOptions = {}): Promise<CaptureMetadata> {
  return captureScreenToDirectory(join(tmpdir(), 'maicroflow', 'run-captures'), 'capture', options);
}

export async function captureWatchSample(options: CaptureOptions = {}): Promise<CaptureMetadata> {
  return captureScreenToDirectory(join(tmpdir(), 'maicroflow', 'watch-samples'), 'watch-sample', options);
}

export async function deleteCaptureArtifact(path: string): Promise<boolean> {
  try {
    await rm(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function captureScreenToDirectory(directory: string, prefix: string, options: CaptureOptions): Promise<CaptureMetadata> {
  const sourceKind = options.source ?? 'cursor-display';
  const display = resolveDisplay(sourceKind, options.displayId);
  const size = display.size;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(1280, size.width),
      height: Math.max(720, size.height)
    }
  });

  const source = sources.find((item) => item.display_id === String(display.id));
  if (!source) {
    throw new Error(`No screen source was available for display ${display.id}.`);
  }

  const createdAt = new Date().toISOString();
  const id = `${prefix}-${createdAt.replace(/[:.]/g, '-')}`;
  const path = join(directory, `${id}.png`);
  await mkdir(directory, { recursive: true });

  const image = options.region ? cropDisplayRegion(source.thumbnail, display, options.region) : source.thumbnail;
  await writeFile(path, image.toPNG());

  const dimensions = image.getSize();
  return {
    id,
    createdAt,
    mode: options.region ? 'region' : 'full-screen',
    path,
    sourceName: source.name || basename(path),
    sourceKind,
    region: options.region,
    width: dimensions.width,
    height: dimensions.height
  };
}

function cropDisplayRegion(image: Electron.NativeImage, display: Electron.Display, region: NonNullable<CaptureOptions['region']>): Electron.NativeImage {
  const imageSize = image.getSize();
  const scaleX = imageSize.width / display.bounds.width;
  const scaleY = imageSize.height / display.bounds.height;
  const relativeX = region.x - display.bounds.x;
  const relativeY = region.y - display.bounds.y;
  const crop = {
    x: clamp(Math.round(relativeX * scaleX), 0, imageSize.width - 1),
    y: clamp(Math.round(relativeY * scaleY), 0, imageSize.height - 1),
    width: clamp(Math.round(region.width * scaleX), 1, imageSize.width),
    height: clamp(Math.round(region.height * scaleY), 1, imageSize.height)
  };
  crop.width = Math.min(crop.width, imageSize.width - crop.x);
  crop.height = Math.min(crop.height, imageSize.height - crop.y);
  return image.crop(crop);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveDisplay(sourceKind: CaptureSourceKind, displayId?: string): Electron.Display {
  if (sourceKind === 'primary-display') {
    return screen.getPrimaryDisplay();
  }

  if (sourceKind === 'display-id' && displayId) {
    const match = screen.getAllDisplays().find((display) => String(display.id) === displayId);
    if (match) {
      return match;
    }
    throw new Error(`Configured display ${displayId} is not available.`);
  }

  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
