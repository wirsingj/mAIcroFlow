import { describe, expect, it } from 'vitest';
import type { Workflow } from '../src/shared/types';
import { lintWorkflow } from '../src/shared/workflowLint';
import { validateWorkflowSafety } from '../src/main/services/workflowPolicy';

describe('workflow lint diagnostics', () => {
  it('warns when model prompts try to execute workflow actions', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        nodes: baseWorkflow().nodes.map((node) =>
          node.type === 'extract'
            ? { ...node, config: { ...node.config, prompt: 'Read the score, click submit, then write to a file.' } }
            : node
        )
      })
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('prompt_action_boundary');
  });

  it('errors on invalid hotkeys', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        trigger: { kind: 'hotkey', summary: 'bad', hotkey: 'Ctrl+NotAKey' }
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'invalid_hotkey' }));
  });

  it('warns on impossible logic and sensitive targets', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        trigger: { kind: 'screen-detection', summary: 'When 1 > 2, take a screenshot of an NSA computer' }
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'impossible_condition' }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'sensitive_target' }));
  });

  it('warns for protected output folders and errors for bad file names', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        nodes: baseWorkflow().nodes.map((node) =>
          node.type === 'action'
            ? {
                ...node,
                config: {
                  kind: 'append-csv',
                  outputDirectory: 'C:\\Windows\\System32',
                  fileName: 'bad/name.csv'
                }
              }
            : node
        )
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'protected_output_directory' }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'invalid_output_file' }));
  });

  it('applies output file diagnostics to Excel workbook actions too', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        nodes: baseWorkflow().nodes.map((node) =>
          node.type === 'action'
            ? {
                ...node,
                config: {
                  kind: 'xlsx',
                  outputDirectory: 'C:\\Users\\wirsi\\Desktop\\output',
                  fileName: 'stats.csv'
                }
              }
            : node
        )
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'unexpected_output_extension' }));
  });

  it('warns when a file output action instruction describes another output type', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        nodes: baseWorkflow().nodes.map((node) =>
          node.type === 'action'
            ? {
                ...node,
                config: {
                  kind: 'append-csv',
                  outputDirectory: 'C:\\Users\\wirsi\\Desktop\\output',
                  fileName: 'stats.csv',
                  prompt: 'Press T, click the green button, then send a webhook.'
                }
              }
            : node
        )
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', code: 'action_prompt_output_mismatch' }));
  });

  it('blocks unsafe automatic keyboard and mouse output through safety policy', () => {
    const workflow = workflowWithPatch({
      autoAppend: true,
      nodes: baseWorkflow().nodes.map((node) =>
        node.type === 'action' ? { ...node, config: { kind: 'keyboard-mouse', sequence: ['T'] } } : node
      )
    });

    const result = validateWorkflowSafety(workflow);

    expect(result.ok).toBe(false);
    expect(result.issues.join(' ')).toMatch(/Keyboard\/mouse output cannot run automatically|High-risk action/);
  });

  it('blocks malformed rectangle capture nodes before arming', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        nodes: baseWorkflow().nodes.map((node) =>
          node.type === 'capture'
            ? { ...node, config: { mode: 'region', source: 'primary-display', region: { x: 0, y: 0, width: 0, height: 100 } } }
            : node
        )
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'invalid_capture_region' }));
  });

  it('blocks region-visible triggers unless the capture node uses a rectangle', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        trigger: { kind: 'region-visible', summary: 'When the selected region is visible' }
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'region_visible_requires_capture_region' }));
  });

  it('blocks invalid visual trigger confidence minimums', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        trigger: { kind: 'screen-detection', summary: 'Watch screen' },
        nodes: baseWorkflow().nodes.map((node) =>
          node.type === 'trigger' ? { ...node, config: { confidenceMinimum: 1.5 } } : node
        )
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'invalid_confidence_minimum' }));
  });

  it('blocks invalid reference similarity minimums', () => {
    const diagnostics = lintWorkflow(
      workflowWithPatch({
        trigger: { kind: 'reference-image', summary: 'When a reference image matches' },
        nodes: baseWorkflow().nodes.map((node) =>
          node.type === 'trigger' ? { ...node, config: { referenceSimilarityMinimum: -0.1 } } : node
        )
      })
    );

    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'invalid_reference_similarity_minimum' }));
  });
});

function workflowWithPatch(patch: Partial<Workflow>): Workflow {
  return {
    ...baseWorkflow(),
    ...patch
  };
}

function baseWorkflow(): Workflow {
  return {
    id: 'lint-demo',
    name: 'Lint Demo',
    status: 'active',
    runnerState: 'armed',
    autoAppend: true,
    trigger: { kind: 'hotkey', summary: 'F7', hotkey: 'F7' },
    nodes: [
      { id: 't', type: 'trigger', title: 'Trigger', summary: 'F7', config: {} },
      { id: 'c', type: 'capture', title: 'Capture', summary: 'Screen', config: { source: 'cursor-display' } },
      { id: 'e', type: 'extract', title: 'Extract', summary: 'Parse', config: { prompt: 'Read visible values.' } },
      { id: 'v', type: 'validate', title: 'Validate', summary: 'Rules', config: {} },
      { id: 'r', type: 'review', title: 'Review', summary: 'Preview', config: {} },
      {
        id: 'a',
        type: 'action',
        title: 'Action',
        summary: 'CSV',
        config: { kind: 'append-csv', outputDirectory: 'C:\\Users\\wirsi\\Desktop\\output', fileName: 'stats.csv' }
      }
    ]
  };
}
