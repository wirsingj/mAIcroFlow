import { app, dialog, BrowserWindow, nativeImage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import type { CaptureRegion, WorkflowExampleImage } from '../../shared/types';
import { captureFullScreen, deleteCaptureArtifact } from './capture';
import { dataPath } from './paths';

const allowedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export interface ExampleCaptureOptions {
  source?: 'cursor-display' | 'primary-display' | 'display-id';
  displayId?: string;
  region?: CaptureRegion;
}

export async function ensureExampleDirectory(): Promise<void> {
  await mkdir(dataPath('examples'), { recursive: true });
}

export async function chooseAndImportExampleImage(
  owner: BrowserWindow | null,
  workflowId: string,
  nodeId: string,
  refName: string,
  use: WorkflowExampleImage['use']
): Promise<WorkflowExampleImage | null> {
  const options: Electron.OpenDialogOptions = {
    title: use === 'trigger-reference' ? 'Choose reference screenshot' : 'Choose extraction example screenshot',
    defaultPath: app.getPath('pictures'),
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  };

  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return importExampleImage(result.filePaths[0], workflowId, nodeId, refName, use);
}

export async function importExampleImage(
  sourcePath: string,
  workflowId: string,
  nodeId: string,
  refName: string,
  use: WorkflowExampleImage['use']
): Promise<WorkflowExampleImage> {
  const extension = extname(sourcePath).toLowerCase();
  if (!allowedImageExtensions.has(extension)) {
    throw new Error('Example screenshots must be PNG, JPG, JPEG, or WEBP files.');
  }

  const addedAt = new Date().toISOString();
  const safeWorkflowId = workflowId.replace(/[^a-z0-9_-]/gi, '_');
  const id = `example-${addedAt.replace(/[:.]/g, '-')}`;
  const safeNodeId = nodeId.replace(/[^a-z0-9_-]/gi, '_');
  const targetDirectory = dataPath('examples', safeWorkflowId, safeNodeId);
  const targetPath = join(targetDirectory, `${id}.png`);

  await mkdir(targetDirectory, { recursive: true });
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) {
    throw new Error('Example screenshot could not be decoded.');
  }
  await writeFile(targetPath, image.toPNG());

  return {
    id,
    refName,
    label: basename(sourcePath),
    path: targetPath,
    addedAt,
    use,
    nodeId
  };
}

export async function captureExampleImage(
  workflowId: string,
  nodeId: string,
  refName: string,
  use: WorkflowExampleImage['use'],
  options: ExampleCaptureOptions = {}
): Promise<WorkflowExampleImage> {
  const capture = await captureFullScreen(options);
  try {
    const image = await importExampleImage(capture.path, workflowId, nodeId, refName, use);
    return {
      ...image,
      label: `${refName} ${capture.mode} reference`
    };
  } finally {
    await deleteCaptureArtifact(capture.path);
  }
}

export async function savePastedExampleImage(
  dataUrl: string,
  workflowId: string,
  nodeId: string,
  refName: string,
  use: WorkflowExampleImage['use']
): Promise<WorkflowExampleImage> {
  const match = dataUrl.match(/^data:(image\/png|image\/jpeg|image\/webp);base64,(.+)$/);
  if (!match) {
    throw new Error('Pasted reference must be a PNG, JPEG, or WEBP image.');
  }

  const bytes = Buffer.from(match[2], 'base64');
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) {
    throw new Error('Pasted reference could not be decoded.');
  }
  const addedAt = new Date().toISOString();
  const safeWorkflowId = workflowId.replace(/[^a-z0-9_-]/gi, '_');
  const safeNodeId = nodeId.replace(/[^a-z0-9_-]/gi, '_');
  const id = `example-${addedAt.replace(/[:.]/g, '-')}`;
  const targetDirectory = dataPath('examples', safeWorkflowId, safeNodeId);
  const targetPath = join(targetDirectory, `${id}.png`);

  await mkdir(targetDirectory, { recursive: true });
  await writeFile(targetPath, image.toPNG());

  return {
    id,
    refName,
    label: `${refName} pasted image`,
    path: targetPath,
    addedAt,
    use,
    nodeId
  };
}

export async function readExampleImageDataUrl(imagePath: string): Promise<string> {
  const examplesRoot = resolve(dataPath('examples'));
  const resolvedPath = resolve(imagePath);
  if (resolvedPath !== examplesRoot && !resolvedPath.startsWith(`${examplesRoot}${sep}`)) {
    throw new Error('Example image preview path must be inside data/examples.');
  }

  const extension = extname(resolvedPath).toLowerCase();
  const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
  const bytes = await readFile(resolvedPath);
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}
