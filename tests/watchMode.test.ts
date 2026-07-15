import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { Workflow } from '../src/shared/types';
import { normalizeDetectionResult, type DetectionResult } from '../src/main/services/ollama';
import {
  applyDetectionConfidenceGate,
  deleteWatchSample,
  handleWatchDetectionOutcome,
  hashSampleFile,
  isWorkflowWatchable,
  WatchArmBaselines,
  RecentSampleHashes,
  WatchTickLock
} from '../src/main/services/watchMode';

async function tempSample(name: string, content: string): Promise<string> {
  const dir = join(tmpdir(), 'maicroflow-watch-tests');
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  await writeFile(path, content);
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function detection(patch: Partial<DetectionResult>): DetectionResult {
  return {
    match: false,
    confidence: 0,
    reason: '',
    matchedReferences: [],
    configuredReferences: [],
    loadedReferences: [],
    missingReferences: [],
    unsupportedReferences: [],
    referenceScores: [],
    ...patch
  };
}

const workflow: Workflow = {
  id: 'watch-demo',
  name: 'Watch Demo',
  status: 'active',
  runnerState: 'armed',
  trigger: {
    kind: 'screen-detection',
    summary: 'Watch for matching screen every 5s',
    detectionIntervalSeconds: 5,
    detectionCooldownSeconds: 10,
    duplicateDetectionEnabled: true
  },
  nodes: [
    {
      id: 't',
      type: 'trigger',
      title: 'Trigger',
      summary: 'Watch',
      config: {
        exampleRefs: [
          {
            id: 'ref-1',
            refName: '#ref1',
            label: 'Trigger screen',
            path: 'C:\\temp\\ref.png',
            addedAt: '2026-05-11T12:00:00Z',
            use: 'trigger-reference'
          }
        ]
      }
    },
    { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: { source: 'cursor-display', mode: 'full-screen' } },
    { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: {} },
    { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
    { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
    { id: 'a', type: 'action', title: 'Action', summary: 'CSV', config: { kind: 'append-csv', fileName: 'watch-demo.csv' } }
  ]
};

describe('watch mode sample lifecycle', () => {
  it('deletes no-match samples immediately', async () => {
    const path = await tempSample('no-match', 'temporary bytes');

    const result = await handleWatchDetectionOutcome(
      path,
      detection({ match: false, confidence: 0.1, reason: 'not a result screen' }),
      async () => {
        throw new Error('onMatch should not run');
      }
    );

    expect(result.matched).toBe(false);
    expect(result.sampleDeleted).toBe(true);
    expect(await exists(path)).toBe(false);
  });

  it('matched sample triggers workflow callback and does not persist as watch sample', async () => {
    const path = await tempSample('match', 'matching bytes');
    let triggered = false;

    const result = await handleWatchDetectionOutcome(
      path,
      detection({ match: true, confidence: 0.9, reason: 'fish result', matchedReferences: ['#ref1'] }),
      async () => {
        triggered = true;
      }
    );

    expect(result.matched).toBe(true);
    expect(triggered).toBe(true);
    expect(await exists(path)).toBe(false);
  });

  it('duplicate hash prevents repeat processing', async () => {
    const path = await tempSample('hash', 'same screen');
    const hash = await hashSampleFile(path);
    const recent = new RecentSampleHashes();
    recent.remember('workflow-1', hash, 1000);

    expect(recent.has('workflow-1', hash, 2000)).toBe(true);
    expect(recent.has('workflow-2', hash, 2000)).toBe(false);
    await deleteWatchSample(path);
  });

  it('records an arm-time baseline and only allows detection after the screen changes', () => {
    const baselines = new WatchArmBaselines();

    expect(baselines.compare('workflow-1', 'screen-a')).toBe('baseline_recorded');
    expect(baselines.compare('workflow-1', 'screen-a')).toBe('baseline_unchanged');
    expect(baselines.compare('workflow-1', 'screen-b')).toBe('changed');
    expect(baselines.compare('workflow-1', 'screen-b')).toBe('baseline_recorded');
  });

  it('resets arm baselines when watch loops restart', () => {
    const baselines = new WatchArmBaselines();

    expect(baselines.compare('workflow-1', 'screen-a')).toBe('baseline_recorded');
    expect(baselines.compare('workflow-1', 'screen-b')).toBe('changed');
    baselines.resetFor(['workflow-1']);

    expect(baselines.compare('workflow-1', 'screen-b')).toBe('baseline_recorded');
  });

  it('watch loop is active only while workflow is armed', () => {
    expect(isWorkflowWatchable(workflow)).toBe(true);
    expect(isWorkflowWatchable({ ...workflow, status: 'paused' })).toBe(false);
    expect(isWorkflowWatchable({ ...workflow, runnerState: 'inactive' })).toBe(false);
    expect(isWorkflowWatchable({ ...workflow, runnerState: 'needs_review' })).toBe(false);
    expect(isWorkflowWatchable({ ...workflow, runnerState: 'failed' })).toBe(false);
  });

  it('watch loop supports reference-image and region-visible trigger kinds', () => {
    expect(isWorkflowWatchable({ ...workflow, trigger: { ...workflow.trigger, kind: 'reference-image' } })).toBe(true);
    expect(isWorkflowWatchable({ ...workflow, trigger: { ...workflow.trigger, kind: 'region-visible' } })).toBe(false);
    expect(
      isWorkflowWatchable({
        ...workflow,
        trigger: { ...workflow.trigger, kind: 'region-visible' },
        nodes: workflow.nodes.map((node) =>
          node.type === 'capture'
            ? { ...node, config: { ...node.config, mode: 'region', region: { x: 10, y: 20, width: 300, height: 200 } } }
            : node
        )
      })
    ).toBe(true);
  });

  it('does not watch incomplete or blocked workflow configs', () => {
    expect(isWorkflowWatchable({ ...workflow, nodes: workflow.nodes.filter((node) => node.type !== 'action') })).toBe(false);
    expect(
      isWorkflowWatchable({
        ...workflow,
        nodes: workflow.nodes.map((node) => (node.type === 'capture' ? { ...node, config: { source: 'display-id' } } : node))
      })
    ).toBe(false);
  });

  it('detection calls do not overlap for the same workflow', () => {
    const lock = new WatchTickLock();

    expect(lock.tryStart('workflow-1')).toBe(true);
    expect(lock.tryStart('workflow-1')).toBe(false);
    expect(lock.tryStart('workflow-2')).toBe(true);
    lock.finish('workflow-1');
    expect(lock.tryStart('workflow-1')).toBe(true);
  });

  it('normalizes detection confidence and matched reference debug fields', () => {
    const result = normalizeDetectionResult({
      screen_visible: true,
      score: 1.7,
      reason: 'matched the score panel',
      matched_references: ['#ref1', ' #ref2 ', '']
    });

    expect(result).toEqual({
      match: true,
      confidence: 1,
      reason: 'matched the score panel',
      matchedReferences: ['#ref1', '#ref2'],
      configuredReferences: [],
      loadedReferences: [],
      missingReferences: [],
      unsupportedReferences: [],
      referenceScores: []
    });
  });

  it('accepts comma-separated matched references from small local models', () => {
    const result = normalizeDetectionResult({
      match: 'no',
      confidence: 0.25,
      debug_reason: 'screen changed but target region is absent',
      matchedReferences: '#ref3, #ref4'
    });

    expect(result).toEqual({
      match: false,
      confidence: 0.25,
      reason: 'screen changed but target region is absent',
      matchedReferences: ['#ref3', '#ref4'],
      configuredReferences: [],
      loadedReferences: [],
      missingReferences: [],
      unsupportedReferences: [],
      referenceScores: []
    });
  });

  it('can gate visual matches below a configured confidence minimum', () => {
    const result = applyDetectionConfidenceGate(
      detection({
        match: true,
        confidence: 0.42,
        reason: 'similar panel',
        matchedReferences: ['#ref1']
      }),
      0.7
    );

    expect(result.blocked).toBe(true);
    expect(result.detection.match).toBe(false);
    expect(result.detection.reason).toContain('below the 70% trigger minimum');
  });

  it('leaves visual matches alone when no confidence minimum is configured', () => {
    const result = applyDetectionConfidenceGate(
      detection({
        match: true,
        confidence: 0.1,
        reason: 'model says yes'
      }),
      undefined
    );

    expect(result.blocked).toBe(false);
    expect(result.detection.match).toBe(true);
  });
});
