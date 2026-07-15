import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { matchReferenceImages } from '../src/main/services/referenceMatcher';
import type { WorkflowExampleImage } from '../src/shared/types';

describe('deterministic reference image matcher', () => {
  it('matches identical reference images with high confidence', async () => {
    const dir = await tempDir();
    const samplePath = join(dir, 'sample.png');
    const refPath = join(dir, 'ref.png');
    const otherPath = join(dir, 'other.png');
    await writePng(samplePath, [20, 120, 220]);
    await writePng(refPath, [20, 120, 220]);
    await writePng(otherPath, [220, 80, 20]);

    const result = await matchReferenceImages(samplePath, [
      example('#ref1', refPath),
      example('#ref2', otherPath)
    ]);

    expect(result.match).toBe(true);
    expect(result.matchedReferences).toEqual(['#ref1']);
    expect(result.confidence).toBeGreaterThan(0.99);
    expect(result.scores[0]).toEqual(expect.objectContaining({ refName: '#ref1' }));
  });

  it('does not match visibly different reference images', async () => {
    const dir = await tempDir();
    const samplePath = join(dir, 'sample.png');
    const refPath = join(dir, 'ref.png');
    await writePng(samplePath, [0, 0, 0]);
    await writePng(refPath, [255, 255, 255]);

    const result = await matchReferenceImages(samplePath, [example('#ref1', refPath)]);

    expect(result.match).toBe(false);
    expect(result.confidence).toBeLessThan(0.1);
  });

  it('uses the configured similarity threshold', async () => {
    const dir = await tempDir();
    const samplePath = join(dir, 'sample.png');
    const refPath = join(dir, 'ref.png');
    await writePng(samplePath, [100, 100, 100]);
    await writePng(refPath, [104, 104, 104]);

    expect((await matchReferenceImages(samplePath, [example('#ref1', refPath)], 0.99)).match).toBe(false);
    expect((await matchReferenceImages(samplePath, [example('#ref1', refPath)], 0.98)).match).toBe(true);
  });
});

async function tempDir(): Promise<string> {
  const dir = join(tmpdir(), `maicroflow-reference-tests-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function example(refName: string, path: string): WorkflowExampleImage {
  return {
    id: refName.replace('#', 'example-'),
    refName,
    label: `${refName} image`,
    path,
    addedAt: '2026-06-20T00:00:00Z',
    use: 'trigger-reference'
  };
}

async function writePng(path: string, color: [number, number, number]): Promise<void> {
  const png = new PNG({ width: 8, height: 8 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      png.data[index] = color[0];
      png.data[index + 1] = color[1];
      png.data[index + 2] = color[2];
      png.data[index + 3] = 255;
    }
  }
  await writeFile(path, PNG.sync.write(png));
}
