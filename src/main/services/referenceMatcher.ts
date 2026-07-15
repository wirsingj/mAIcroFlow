import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import type { WorkflowExampleImage } from '../../shared/types';

export interface ReferenceMatchScore {
  refName: string;
  label: string;
  similarity: number;
}

export interface ReferenceMatchResult {
  match: boolean;
  confidence: number;
  matchedReferences: string[];
  scores: ReferenceMatchScore[];
}

const defaultSimilarityThreshold = 0.96;
const sampleGridSize = 16;

export async function matchReferenceImages(
  samplePath: string,
  references: WorkflowExampleImage[],
  threshold = defaultSimilarityThreshold
): Promise<ReferenceMatchResult> {
  if (!references.length) {
    return emptyMatchResult();
  }

  let sample: ImageFingerprint;
  try {
    sample = await imageFingerprint(samplePath);
  } catch {
    return emptyMatchResult();
  }

  const scores: ReferenceMatchScore[] = [];
  for (const reference of references) {
    try {
      const fingerprint = await imageFingerprint(reference.path);
      scores.push({
        refName: reference.refName,
        label: reference.label,
        similarity: compareFingerprints(sample, fingerprint)
      });
    } catch {
      scores.push({
        refName: reference.refName,
        label: reference.label,
        similarity: 0
      });
    }
  }

  scores.sort((a, b) => b.similarity - a.similarity);
  const matchedReferences = scores.filter((score) => score.similarity >= threshold).map((score) => score.refName);
  return {
    match: matchedReferences.length > 0,
    confidence: scores[0]?.similarity ?? 0,
    matchedReferences,
    scores
  };
}

function emptyMatchResult(): ReferenceMatchResult {
  return {
    match: false,
    confidence: 0,
    matchedReferences: [],
    scores: []
  };
}

interface ImageFingerprint {
  values: number[];
}

async function imageFingerprint(path: string): Promise<ImageFingerprint> {
  const bytes = await readFile(path);
  const png = PNG.sync.read(bytes);
  const values: number[] = [];

  for (let y = 0; y < sampleGridSize; y += 1) {
    for (let x = 0; x < sampleGridSize; x += 1) {
      values.push(sampleGrayscale(png, x, y));
    }
  }

  return { values };
}

function sampleGrayscale(png: PNG, gridX: number, gridY: number): number {
  const x = Math.min(png.width - 1, Math.max(0, Math.floor(((gridX + 0.5) / sampleGridSize) * png.width)));
  const y = Math.min(png.height - 1, Math.max(0, Math.floor(((gridY + 0.5) / sampleGridSize) * png.height)));
  const index = (png.width * y + x) << 2;
  const alpha = png.data[index + 3] / 255;
  const red = png.data[index] * alpha + 255 * (1 - alpha);
  const green = png.data[index + 1] * alpha + 255 * (1 - alpha);
  const blue = png.data[index + 2] * alpha + 255 * (1 - alpha);
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

function compareFingerprints(a: ImageFingerprint, b: ImageFingerprint): number {
  const length = Math.min(a.values.length, b.values.length);
  if (!length) {
    return 0;
  }

  let distance = 0;
  for (let index = 0; index < length; index += 1) {
    distance += Math.abs(a.values[index] - b.values[index]) / 255;
  }

  return Math.max(0, Math.min(1, 1 - distance / length));
}
