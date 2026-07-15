import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, resolve, sep } from 'node:path';
import type { ExtractionResult, OllamaStatus, SetupActionResult, StructuredFieldValue, Workflow, WorkflowExampleImage, WorkflowNodeType } from '../../shared/types';
import { normalizeExtraction } from './extractor';
import { dataPath } from './paths';
import { loadSettings } from './persistence';
import { matchReferenceImages, type ReferenceMatchScore } from './referenceMatcher';

export interface OllamaVisionExtraction {
  result: ExtractionResult;
  model: string;
  rawResponse: string;
}

export interface DetectionResult {
  match: boolean;
  confidence: number;
  reason: string;
  matchedReferences: string[];
  configuredReferences: string[];
  loadedReferences: string[];
  missingReferences: string[];
  unsupportedReferences: string[];
  referenceScores: ReferenceMatchScore[];
}

interface PromptImage {
  refName: string;
  label: string;
  base64: string;
}

interface ReferenceImageDebug {
  configuredReferences: string[];
  loadedReferences: string[];
  missingReferences: string[];
  unsupportedReferences: string[];
}

interface ReferenceImageReadResult {
  refs: WorkflowExampleImage[];
  images: PromptImage[];
  debug: ReferenceImageDebug;
}

export async function checkOllamaStatus(): Promise<OllamaStatus> {
  const settings = await loadSettings();
  const endpoint = settings.ai.endpoint.replace(/\/$/, '');
  const selectedModel = settings.ai.preferredModel;

  if (!isLocalEndpoint(endpoint)) {
    return {
      state: 'not_found',
      endpoint,
      selectedModel,
      models: [],
      message: 'Only local Ollama endpoints are allowed for v0.'
    };
  }

  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(1800) });
    if (!response.ok) {
      return {
        state: 'installed_not_running',
        endpoint,
        selectedModel,
        models: [],
        message: `Ollama responded with HTTP ${response.status}.`
      };
    }

    const json = (await response.json()) as { models?: Array<{ name: string }> };
    const models = (json.models ?? []).map((model) => model.name).sort();
    const hasSelected = models.includes(selectedModel);
    return {
      state: hasSelected ? 'model_available' : 'running',
      endpoint,
      selectedModel,
      models,
      message: hasSelected
        ? `${selectedModel} is available locally.`
        : 'Ollama is running. Select an installed model or pull a vision model manually.'
    };
  } catch {
    return {
      state: 'not_found',
      endpoint,
      selectedModel,
      models: [],
      message: 'Ollama was not reachable at the configured local endpoint.'
    };
  }
}

export async function pullOllamaModel(model: string): Promise<SetupActionResult> {
  const modelName = model.trim();
  if (!/^[a-zA-Z0-9._:/-]+$/.test(modelName)) {
    return { ok: false, message: 'Model name contains unsupported characters.' };
  }

  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', modelName], {
      windowsHide: true,
      shell: false
    });
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, message: `Timed out while pulling ${modelName}. Ollama may still be working in the background.` });
    }, 10 * 60 * 1000);

    child.stdout.on('data', (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-1000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-1000);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, message: `Could not run "ollama pull". ${error.message}` });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        message: code === 0 ? `${modelName} is installed.` : `Ollama pull exited with code ${code}. ${output.trim()}`
      });
    });
  });
}

export async function extractScreenshotWithOllamaVision(
  screenshotPath: string,
  workflow: Workflow,
  hints = ''
): Promise<OllamaVisionExtraction | null> {
  const settings = await loadSettings();
  const endpoint = settings.ai.endpoint.replace(/\/$/, '');
  const model = settings.ai.preferredModel.trim();

  if (!model || !isLocalEndpoint(endpoint)) {
    return null;
  }

  const referenceImages = await readWorkflowReferenceImages(workflow, 'extract', 'extraction-example');
  const imageBase64 = await readFile(screenshotPath, 'base64');
  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model,
      prompt: buildVisionPrompt(workflow, hints, referenceImages),
      images: [...referenceImages.map((image) => image.base64), imageBase64],
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        num_ctx: 4096
      }
    })
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { response?: string };
  const rawResponse = body.response ?? '';
  const parsed = parseVisionJson(rawResponse);
  if (!parsed) {
    return null;
  }

  const requestedFields = requestedExtractionFields(workflow);
  const genericFields = extractGenericFields(parsed, requestedFields);
  const result = normalizeExtraction({
    fish_name: pickString(parsed, ['fish_name', 'fish', 'catch', 'name']),
    exp_gained: pickString(parsed, ['exp_gained', 'exp', 'xp', 'experience']),
    weight: pickString(parsed, ['weight', 'fish_weight']),
    class_tier: pickString(parsed, ['class_tier', 'class', 'tier', 'rarity', 'rank']),
    bait_used: pickString(parsed, ['bait_used', 'bait', 'lure']),
    confidence: pickNumber(parsed, ['confidence', 'score']),
    notes: `Local Ollama vision extraction via ${model}. ${pickString(parsed, ['notes', 'note'])}`.trim(),
    fields: genericFields.fields,
    rawFields: genericFields.rawFields
  });

  return { result, model, rawResponse };
}

export async function detectWorkflowTriggerScreen(screenshotPath: string, workflow?: Workflow): Promise<DetectionResult> {
  const settings = await loadSettings();
  const endpoint = settings.ai.endpoint.replace(/\/$/, '');
  const model = settings.ai.preferredModel.trim();

  const referenceImages = workflow
    ? await readWorkflowReferenceImagesWithDebug(workflow, 'trigger', 'trigger-reference')
    : { refs: [], images: [], debug: emptyReferenceImageDebug() };
  const deterministicMatch = await matchReferenceImages(screenshotPath, referenceImages.refs, referenceSimilarityMinimum(workflow));
  if (deterministicMatch.match) {
    return {
      match: true,
      confidence: deterministicMatch.confidence,
      reason: `Deterministic reference image match at ${Math.round(deterministicMatch.confidence * 100)}% similarity.`,
      matchedReferences: deterministicMatch.matchedReferences,
      configuredReferences: referenceImages.debug.configuredReferences,
      loadedReferences: referenceImages.debug.loadedReferences,
      missingReferences: referenceImages.debug.missingReferences,
      unsupportedReferences: referenceImages.debug.unsupportedReferences,
      referenceScores: deterministicMatch.scores
    };
  }

  if (!model || !isLocalEndpoint(endpoint)) {
    return detectionUnavailable('Local vision model is not configured.', referenceImages.debug, deterministicMatch.scores);
  }

  const imageBase64 = await readFile(screenshotPath, 'base64');
  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model,
      prompt: buildDetectionPrompt(workflow, referenceImages.images),
      images: [...referenceImages.images.map((image) => image.base64), imageBase64],
      stream: false,
      format: 'json',
      options: {
        temperature: 0
      }
    })
  });

  if (!response.ok) {
    return detectionUnavailable(`Ollama returned HTTP ${response.status}.`, referenceImages.debug, deterministicMatch.scores);
  }

  const body = (await response.json()) as { response?: string };
  const parsed = parseVisionJson(body.response ?? '');
  if (!parsed) {
    return detectionUnavailable('Detection response was not valid JSON.', referenceImages.debug, deterministicMatch.scores);
  }
  return {
    ...normalizeDetectionResult(parsed),
    ...referenceImages.debug,
    referenceScores: deterministicMatch.scores
  };
}

export function normalizeDetectionResult(parsed: Record<string, unknown>): DetectionResult {
  return {
    match: pickBoolean(parsed, [
      'match',
      'is_match',
      'matched',
      'detected',
      'result_screen',
      'screen_visible'
    ]),
    confidence: normalizeConfidence(pickNumber(parsed, ['confidence', 'score'])),
    reason: pickString(parsed, ['reason', 'debug_reason']) || 'No reason provided.',
    matchedReferences: pickStringArray(parsed, ['matched_references', 'matchedReferences', 'references', 'refs']),
    configuredReferences: [],
    loadedReferences: [],
    missingReferences: [],
    unsupportedReferences: [],
    referenceScores: []
  };
}

function detectionUnavailable(reason: string, debug = emptyReferenceImageDebug(), referenceScores: ReferenceMatchScore[] = []): DetectionResult {
  return {
    match: false,
    confidence: 0,
    reason,
    matchedReferences: [],
    configuredReferences: debug.configuredReferences,
    loadedReferences: debug.loadedReferences,
    missingReferences: debug.missingReferences,
    unsupportedReferences: debug.unsupportedReferences,
    referenceScores
  };
}

function referenceSimilarityMinimum(workflow?: Workflow): number | undefined {
  const triggerNode = workflow?.nodes.find((node) => node.type === 'trigger');
  const value = triggerNode?.config.referenceSimilarityMinimum;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, numberValue));
}

function buildVisionPrompt(workflow: Workflow, hints: string, referenceImages: PromptImage[]): string {
  const extractNode = workflow.nodes.find((node) => node.type === 'extract');
  const config = extractNode?.config ?? {};
  const fields = requestedExtractionFields(workflow);
  const instruction =
    typeof config.prompt === 'string' && config.prompt.trim()
      ? config.prompt.trim()
      : 'Read the screenshot and extract the requested visible workflow data.';

  return [
    'You are a local-only screen data extractor for mAIcroFlow.',
    referenceImages.length
      ? `Images before the final image are user-provided examples: ${referenceImages.map((image) => `${image.refName} (${image.label})`).join(', ')}. Use them only as visual references for this node.`
      : '',
    'The final image is the live screenshot to extract from.',
    'Do not infer private credentials, hidden data, or unrelated background details.',
    instruction,
    hints.trim() ? `User-provided training hints or example text:\n${hints.trim()}` : '',
    'Return strict JSON only. Do not include markdown or prose.',
    `Required keys: ${fields.join(', ')}, confidence, notes.`,
    'Use empty strings for fields that are not visible. confidence must be between 0 and 1.',
    'Do a careful text read before filling fields. Only return values visible in the screenshot.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildDetectionPrompt(workflow: Workflow | undefined, referenceImages: PromptImage[]): string {
  const triggerSummary = workflow?.trigger.summary || 'the user-configured trigger screen';
  const triggerNode = workflow?.nodes.find((node) => node.type === 'trigger');
  const triggerPrompt = typeof triggerNode?.config.prompt === 'string' ? triggerNode.config.prompt.trim() : '';
  return [
    'You are the local watch gate for a visible screen macro. Return strict JSON only.',
    referenceImages.length
      ? `Images before the final image are user-provided trigger references: ${referenceImages.map((image) => `${image.refName} (${image.label})`).join(', ')}. The final image is the live disposable screen sample.`
      : '',
    `The workflow trigger is: ${triggerSummary}.`,
    triggerPrompt ? `Additional trigger instruction: ${triggerPrompt}` : '',
    'A match is TRUE when the final screenshot semantically matches the user-provided trigger references or trigger description.',
    'If trigger reference images are present, compare the final image against those references and explain the shortest reason.',
    'Return confidence as a number from 0 to 1.',
    'If trigger reference images are present, include matched_references as an array of ref names that materially matched.',
    'Schema: {"match": true, "confidence": 0.92, "reason": "short reason", "matched_references": ["#ref1"]} or {"match": false, "confidence": 0.12, "reason": "short reason", "matched_references": []}.'
  ]
    .filter(Boolean)
    .join('\n');
}

function requestedExtractionFields(workflow: Workflow): string[] {
  const extractNode = workflow.nodes.find((node) => node.type === 'extract');
  const rawFields = extractNode?.config.fields;
  const fields = Array.isArray(rawFields) ? rawFields.map(String).map((field) => field.trim()).filter(Boolean) : [];
  return fields.length ? fields : ['value'];
}

function extractGenericFields(
  parsed: Record<string, unknown>,
  requestedFields: string[]
): { fields: Record<string, StructuredFieldValue>; rawFields: Record<string, string> } {
  const nestedFields = isRecord(parsed.fields) ? parsed.fields : undefined;
  const fields: Record<string, StructuredFieldValue> = {};
  const rawFields: Record<string, string> = {};

  for (const field of requestedFields) {
    const value = nestedFields?.[field] ?? parsed[field];
    fields[field] = normalizeStructuredValue(value);
    rawFields[field] = value === undefined || value === null ? '' : String(value);
  }

  return { fields, rawFields };
}

function normalizeStructuredValue(value: unknown): StructuredFieldValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

async function readWorkflowReferenceImages(
  workflow: Workflow,
  nodeType: WorkflowNodeType,
  use: WorkflowExampleImage['use']
): Promise<PromptImage[]> {
  return (await readWorkflowReferenceImagesWithDebug(workflow, nodeType, use)).images;
}

async function readWorkflowReferenceImagesWithDebug(
  workflow: Workflow,
  nodeType: WorkflowNodeType,
  use: WorkflowExampleImage['use']
): Promise<ReferenceImageReadResult> {
  const refs = workflow.nodes
    .filter((node) => node.type === nodeType)
    .flatMap((node) => workflowExampleImagesFromConfig(node.config.exampleRefs, use));

  const images: PromptImage[] = [];
  const deterministicRefs: WorkflowExampleImage[] = [];
  const debug: ReferenceImageDebug = {
    configuredReferences: refs.map(referenceDebugLabel),
    loadedReferences: [],
    missingReferences: [],
    unsupportedReferences: []
  };
  for (const ref of refs) {
    const imagePath = resolve(ref.path);
    if (!isInsideExamplesDirectory(imagePath)) {
      debug.missingReferences.push(`${referenceDebugLabel(ref)} outside examples directory`);
      continue;
    }
    try {
      images.push({
        refName: ref.refName,
        label: ref.label,
        base64: await readFile(imagePath, 'base64')
      });
      if (extname(imagePath).toLowerCase() === '.png') {
        deterministicRefs.push(ref);
      } else {
        debug.unsupportedReferences.push(`${referenceDebugLabel(ref)} deterministic matcher supports PNG only`);
      }
      debug.loadedReferences.push(referenceDebugLabel(ref));
    } catch {
      debug.missingReferences.push(referenceDebugLabel(ref));
      // Missing refs should not stop a run; the UI still surfaces the saved path.
    }
  }
  return { refs: deterministicRefs, images, debug };
}

function emptyReferenceImageDebug(): ReferenceImageDebug {
  return {
    configuredReferences: [],
    loadedReferences: [],
    missingReferences: [],
    unsupportedReferences: []
  };
}

function referenceDebugLabel(ref: WorkflowExampleImage): string {
  return `${ref.refName} (${ref.label})`;
}

function workflowExampleImagesFromConfig(value: unknown, use: WorkflowExampleImage['use']): WorkflowExampleImage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is WorkflowExampleImage => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const ref = item as Partial<WorkflowExampleImage>;
    return (
      ref.use === use &&
      typeof ref.path === 'string' &&
      typeof ref.refName === 'string' &&
      typeof ref.label === 'string'
    );
  });
}

function isInsideExamplesDirectory(path: string): boolean {
  const examplesRoot = resolve(dataPath('examples'));
  return path === examplesRoot || path.startsWith(`${examplesRoot}${sep}`);
}

function parseVisionJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
  }
  return '';
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    const numberValue = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }
  return 0;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function pickStringArray(source: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function pickBoolean(source: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'yes', 'y', 'match', 'matched'].includes(normalized)) {
        return true;
      }
      if (['false', 'no', 'n', 'no_match', 'not_match'].includes(normalized)) {
        return false;
      }
    }
    if (typeof value === 'number') {
      return value > 0;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
