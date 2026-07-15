import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell } from 'electron';
import type { IpcMainEvent } from 'electron';
import { optimizer } from '@electron-toolkit/utils';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { CaptureDisplaySource, CaptureRegion, ExtractionResult, Workflow } from '../shared/types';
import { log, readLogs } from './services/logger';
import { checkOllamaStatus, pullOllamaModel } from './services/ollama';
import { captureExampleImage, chooseAndImportExampleImage, readExampleImageDataUrl, savePastedExampleImage } from './services/exampleImages';
import { ensureDataFiles, loadSettings, loadWorkflows, saveSettings, saveWorkflows } from './services/persistence';
import { dataPath } from './services/paths';
import { armedStateFor } from './services/runnerState';
import { assertWorkflowsSafe } from './services/workflowPolicy';
import { WatchScheduler } from './services/watchScheduler';
import { WorkflowRunner } from './services/workflowRunner';
import { normalizeWorkflowLifecycleForSave } from '../shared/workflowReadiness';
import { SAFETY_PAUSE_HOTKEY, workflowHotkeys, workflowUsesHotkey } from './services/hotkeys';
import { displaySourceForRegion, displayUnionBounds, normalizePickedRegion, type PickedCaptureRegion } from './services/regionSelection';

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let regionPickerWindow: BrowserWindow | null = null;
const registeredWorkflowHotkeys = new Set<string>();

const workflowRunner = new WorkflowRunner({
  onPreviewReady: (preview, focus) => {
    mainWindow?.webContents.send('workflow:preview-ready', preview);
    if (focus) {
      mainWindow?.show();
    }
  },
  onAutoRunComplete: (workflowId) => {
    mainWindow?.webContents.send('workflow:auto-run-complete', workflowId);
  },
  onProgress: (progress) => {
    mainWindow?.webContents.send('workflow:progress', progress);
    floatingWindow?.webContents.send('workflow:progress', progress);
  }
});

const watchScheduler = new WatchScheduler((workflowId, capture) =>
  workflowRunner.executeWorkflow(workflowId, {
    source: 'detection',
    focusOnReview: false,
    capture
  })
);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'mAIcroFlow',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  });
  applyCaptureExclusion(mainWindow);

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createFloatingWindow(): BrowserWindow {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    return floatingWindow;
  }

  floatingWindow = new BrowserWindow({
    width: 340,
    height: 216,
    minWidth: 320,
    minHeight: 172,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'mAIcroFlow Control',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  });
  applyCaptureExclusion(floatingWindow);
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingWindow.on('closed', () => {
    floatingWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    floatingWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?floating=1`);
  } else {
    floatingWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { floating: '1' } });
  }

  return floatingWindow;
}

function applyCaptureExclusion(window: BrowserWindow): void {
  window.setContentProtection(true);
}

function showFloatingWindow(window: BrowserWindow): void {
  if (window.webContents.isLoading()) {
    window.once('ready-to-show', () => window.showInactive());
    return;
  }

  window.showInactive();
}

async function pickCaptureRegion(): Promise<PickedCaptureRegion | null> {
  if (regionPickerWindow && !regionPickerWindow.isDestroyed()) {
    regionPickerWindow.focus();
    return null;
  }

  const displays = screen.getAllDisplays();
  const overlayBounds = displayUnionBounds(displays);
  const mainWasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const floatingWasVisible = Boolean(floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible());

  mainWindow?.hide();
  floatingWindow?.hide();

  return new Promise((resolvePromise) => {
    let settled = false;
    const channelId = `region-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pickedChannel = `capture:region-picked:${channelId}`;
    const canceledChannel = `capture:region-canceled:${channelId}`;

    const cleanup = (): void => {
      ipcMain.removeListener(pickedChannel, onPicked);
      ipcMain.removeListener(canceledChannel, onCanceled);
      if (regionPickerWindow && !regionPickerWindow.isDestroyed()) {
        regionPickerWindow.close();
      }
      regionPickerWindow = null;
      if (mainWasVisible && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
      if (floatingWasVisible && floatingWindow && !floatingWindow.isDestroyed()) {
        showFloatingWindow(floatingWindow);
      }
    };

    const settle = (value: PickedCaptureRegion | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(value);
    };

    const onPicked = (_event: IpcMainEvent, start: { x: number; y: number }, end: { x: number; y: number }): void => {
      const region = normalizePickedRegion(start, end);
      const picked = displaySourceForRegion(displays, region);
      settle(picked);
    };

    const onCanceled = (): void => {
      settle(null);
    };

    ipcMain.once(pickedChannel, onPicked);
    ipcMain.once(canceledChannel, onCanceled);

    regionPickerWindow = new BrowserWindow({
      x: overlayBounds.x,
      y: overlayBounds.y,
      width: overlayBounds.width,
      height: overlayBounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: 'Select mAIcroFlow Region',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
      }
    });
    regionPickerWindow.setAlwaysOnTop(true, 'screen-saver');
    regionPickerWindow.on('closed', () => {
      regionPickerWindow = null;
      settle(null);
    });
    regionPickerWindow.loadURL(regionPickerDataUrl(channelId, overlayBounds));
    regionPickerWindow.once('ready-to-show', () => regionPickerWindow?.show());
  });
}

function regionPickerDataUrl(channelId: string, overlayBounds: CaptureRegion): string {
  const origin = JSON.stringify({ x: overlayBounds.x, y: overlayBounds.y });
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      cursor: crosshair;
      background: rgba(8, 16, 18, 0.18);
      user-select: none;
    }
    #hint {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 12px;
      border-radius: 6px;
      color: #effaf6;
      background: rgba(18, 49, 45, 0.9);
      border: 1px solid rgba(147, 226, 202, 0.72);
      font: 700 13px system-ui, sans-serif;
    }
    #box {
      position: fixed;
      display: none;
      border: 2px solid #93e2ca;
      background: rgba(147, 226, 202, 0.18);
      box-shadow: 0 0 0 9999px rgba(6, 12, 14, 0.32);
      pointer-events: none;
    }
    #measure {
      position: fixed;
      display: none;
      padding: 5px 7px;
      border-radius: 5px;
      color: #12312d;
      background: #93e2ca;
      font: 800 12px system-ui, sans-serif;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="hint">Drag to select a capture rectangle. Esc cancels.</div>
  <div id="box"></div>
  <div id="measure"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const origin = ${origin};
    const channelId = ${JSON.stringify(channelId)};
    const pickedChannel = 'capture:region-picked:' + channelId;
    const canceledChannel = 'capture:region-canceled:' + channelId;
    const box = document.getElementById('box');
    const measure = document.getElementById('measure');
    let start = null;
    function point(event) {
      return { x: Math.round(origin.x + event.clientX), y: Math.round(origin.y + event.clientY) };
    }
    function draw(event) {
      if (!start) return;
      const current = point(event);
      const x = Math.min(start.x - origin.x, current.x - origin.x);
      const y = Math.min(start.y - origin.y, current.y - origin.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);
      box.style.display = 'block';
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.width = width + 'px';
      box.style.height = height + 'px';
      measure.style.display = 'block';
      measure.style.left = Math.min(window.innerWidth - 140, Math.max(8, x + width + 8)) + 'px';
      measure.style.top = Math.min(window.innerHeight - 32, Math.max(8, y + height + 8)) + 'px';
      measure.textContent = Math.round(width) + ' x ' + Math.round(height) + ' @ ' + Math.round(Math.min(start.x, current.x)) + ', ' + Math.round(Math.min(start.y, current.y));
    }
    window.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      start = point(event);
      draw(event);
    });
    window.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', (event) => {
      if (!start || event.button !== 0) return;
      const end = point(event);
      if (Math.abs(end.x - start.x) < 4 || Math.abs(end.y - start.y) < 4) {
        ipcRenderer.send(canceledChannel);
        return;
      }
      ipcRenderer.send(pickedChannel, start, end);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') ipcRenderer.send(canceledChannel);
    });
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function saveCaptureRegionToWorkflow(workflowId?: string): Promise<Workflow | null> {
  const picked = await pickCaptureRegion();
  if (!picked) {
    return null;
  }

  const workflows = await loadWorkflows();
  const target = (workflowId ? workflows.find((workflow) => workflow.id === workflowId) : undefined) ?? workflows.find((workflow) => workflow.status === 'active') ?? workflows[0];
  if (!target) {
    throw new Error('Create a workflow before selecting a capture region.');
  }

  const captureIndex = target.nodes.findIndex((node) => node.type === 'capture');
  if (captureIndex < 0) {
    throw new Error('This workflow does not have a Screen Grab node to receive the region.');
  }

  const nextWorkflow: Workflow = {
    ...target,
    trigger: { ...target.trigger },
    nodes: target.nodes.map((node, index) =>
      index === captureIndex
        ? {
            ...node,
            config: {
              ...node.config,
              source: picked.source,
              displayId: picked.displayId,
              mode: 'region',
              region: picked.region
            }
          }
        : node
    )
  };
  const nextWorkflows = workflows.map((workflow) => (workflow.id === target.id ? nextWorkflow : workflow)).map(normalizeWorkflowLifecycleForSave);
  assertWorkflowsSafe(nextWorkflows);
  await saveWorkflows(nextWorkflows);
  watchScheduler.refresh(nextWorkflows);
  refreshWorkflowHotkeys(nextWorkflows);
  await log({
    level: 'info',
    scope: 'capture',
    message: 'Saved selected rectangle to workflow capture node',
    details: { workflowId: target.id, displayId: picked.displayId, region: picked.region }
  });
  mainWindow?.webContents.send('workflows:changed', 'Saved selected rectangle to the workflow.');
  floatingWindow?.webContents.send('workflows:changed', 'Saved selected rectangle to the workflow.');
  return nextWorkflows.find((workflow) => workflow.id === target.id) ?? nextWorkflow;
}

async function armActiveWorkflows(): Promise<void> {
  const workflows = await loadWorkflows();
  const armed = workflows.map((workflow) => {
    if (workflow.status !== 'active') {
      return { ...workflow, runnerState: 'inactive' as const };
    }
    if (workflow.runnerState === 'running' || workflow.runnerState === 'failed') {
      return { ...workflow, runnerState: 'armed' as const, lastRunStatus: 'ready' };
    }
    return { ...workflow, runnerState: workflow.runnerState ?? armedStateFor(workflow) };
  });
  await saveWorkflows(armed);
  watchScheduler.refresh(armed);
  refreshWorkflowHotkeys(armed);
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', async () => {
    await ensureDataFiles();
    await armActiveWorkflows();
    return {
      workflows: await loadWorkflows(),
      settings: await loadSettings(),
      logs: await readLogs(),
      ollama: await checkOllamaStatus()
    };
  });

  ipcMain.handle('workflows:list', () => loadWorkflows());
  ipcMain.handle('workflows:save', async (_event, workflows: Workflow[]) => {
    const normalized = workflows.map(normalizeWorkflowLifecycleForSave);
    assertWorkflowsSafe(normalized);
    await saveWorkflows(normalized);
    watchScheduler.refresh(normalized);
    refreshWorkflowHotkeys(normalized);
    await log({ level: 'info', scope: 'workflow', message: 'Saved workflow configuration' });
    return loadWorkflows();
  });

  ipcMain.handle('workflow:run', (_event, workflowId: string, manualText?: string) =>
    workflowRunner.runWorkflow(workflowId, manualText)
  );
  ipcMain.handle('workflow:confirm', (_event, runId: string, extraction: ExtractionResult) =>
    workflowRunner.confirmWorkflowRun(runId, extraction)
  );
  ipcMain.handle('workflow:cancel', (_event, runId: string) => workflowRunner.cancelWorkflowRun(runId));

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:save', async (_event, settings) => {
    await saveSettings(settings);
    await log({ level: 'info', scope: 'settings', message: 'Saved app settings' });
    return loadSettings();
  });

  ipcMain.handle('ollama:check', () => checkOllamaStatus());
  ipcMain.handle('ollama:pull-model', async (_event, model: string) => {
    const result = await pullOllamaModel(model);
    await log({
      level: result.ok ? 'info' : 'warn',
      scope: 'setup',
      message: result.message,
      details: { model }
    });
    return result;
  });
  ipcMain.handle('app:open-url', async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS setup links can be opened.');
    }
    await shell.openExternal(url);
  });
  ipcMain.handle('app:show-floating-control', async () => {
    const window = createFloatingWindow();
    showFloatingWindow(window);
    await log({
      level: 'info',
      scope: 'ui',
      message: 'Opened capture-excluded floating companion'
    });
  });
  ipcMain.handle('app:show-main-window', async () => {
    mainWindow?.show();
    mainWindow?.focus();
    floatingWindow?.hide();
  });
  ipcMain.handle('logs:list', () => readLogs());
  ipcMain.handle('capture:sources', () => listCaptureDisplaySources());
  ipcMain.handle('capture:pick-region', async () => pickCaptureRegion());
  ipcMain.handle('workflow:pick-capture-region', async (_event, workflowId?: string) => saveCaptureRegionToWorkflow(workflowId));
  ipcMain.handle('capture:image-data-url', async (_event, imagePath: string) => {
    const capturesRoot = resolve(dataPath('captures'));
    const resolvedPath = resolve(imagePath);
    if (resolvedPath !== capturesRoot && !resolvedPath.startsWith(`${capturesRoot}${sep}`)) {
      throw new Error('Capture preview path must be inside data/captures.');
    }
    const bytes = await readFile(resolvedPath);
    return `data:image/png;base64,${bytes.toString('base64')}`;
  });
  ipcMain.handle(
    'examples:import-image',
    (_event, workflowId: string, nodeId: string, refName: string, use: 'trigger-reference' | 'extraction-example') =>
      chooseAndImportExampleImage(mainWindow, workflowId, nodeId, refName, use)
  );
  ipcMain.handle(
    'examples:save-pasted-image',
    (_event, dataUrl: string, workflowId: string, nodeId: string, refName: string, use: 'trigger-reference' | 'extraction-example') =>
      savePastedExampleImage(dataUrl, workflowId, nodeId, refName, use)
  );
  ipcMain.handle(
    'examples:capture-image',
    (
      _event,
      workflowId: string,
      nodeId: string,
      refName: string,
      use: 'trigger-reference' | 'extraction-example',
      options?: Parameters<typeof captureExampleImage>[4]
    ) => captureExampleImage(workflowId, nodeId, refName, use, options)
  );
  ipcMain.handle('examples:image-data-url', (_event, imagePath: string) => readExampleImageDataUrl(imagePath));
  ipcMain.handle('output:choose-folder', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose workflow output folder',
      defaultPath: join(app.getPath('documents'), 'mAIcroFlow', 'output'),
      properties: ['openDirectory', 'createDirectory']
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('output:reveal', async (_event, outputPath: string) => {
    if (!isAbsolute(outputPath)) {
      throw new Error('Output path must be absolute.');
    }
    shell.showItemInFolder(outputPath);
    await shell.openPath(dirname(outputPath));
  });
}

function listCaptureDisplaySources(): CaptureDisplaySource[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: `Monitor ${index + 1}${display.id === primaryId ? ' (primary)' : ''} - ${display.size.width}x${display.size.height}`,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    isPrimary: display.id === primaryId
  }));
}

function refreshWorkflowHotkeys(workflows: Workflow[]): void {
  for (const hotkey of registeredWorkflowHotkeys) {
    globalShortcut.unregister(hotkey);
  }
  registeredWorkflowHotkeys.clear();

  for (const hotkey of workflowHotkeys(workflows)) {
    const ok = globalShortcut.register(hotkey, async () => {
      await runWorkflowHotkey(hotkey);
    });
    if (ok) {
      registeredWorkflowHotkeys.add(hotkey);
    }
    void log({
      level: ok ? 'info' : 'warn',
      scope: 'trigger',
      message: ok ? `Registered ${hotkey} workflow hotkey` : `Could not register ${hotkey} workflow hotkey`,
      details: { hotkey }
    });
  }
}

async function runWorkflowHotkey(hotkey: string): Promise<void> {
  try {
    const workflows = (await loadWorkflows()).filter((workflow) => workflow.status === 'active' && workflowUsesHotkey(workflow, hotkey));
    if (!workflows.length) {
      await log({
        level: 'info',
        scope: 'trigger',
        message: `${hotkey} pressed but no active workflow is configured for it`,
        details: { hotkey }
      });
      return;
    }

    for (const workflow of workflows) {
      await workflowRunner.executeWorkflow(workflow.id, {
        source: 'hotkey',
        focusOnReview: true
      });
    }
  } catch (error) {
    await log({
      level: 'error',
      scope: 'trigger',
      message: `${hotkey} workflow trigger failed`,
      details: { hotkey, error: error instanceof Error ? error.message : String(error) }
    });
    mainWindow?.webContents.send('workflow:trigger-error', error instanceof Error ? error.message : String(error));
  }
}

function registerHotkeys(): void {
  void loadWorkflows().then(refreshWorkflowHotkeys);
  const pauseOk = globalShortcut.register(SAFETY_PAUSE_HOTKEY, async () => {
    try {
      const workflows = await loadWorkflows();
      const paused = workflows.map((workflow) =>
        workflow.status === 'active'
          ? { ...workflow, status: 'paused' as const, runnerState: 'inactive' as const, lastRunStatus: 'Paused by global safety shortcut' }
          : workflow
      );
      await saveWorkflows(paused);
      watchScheduler.refresh(paused);
      refreshWorkflowHotkeys(paused);
      await log({
        level: 'warn',
        scope: 'safety',
        message: 'Global safety shortcut paused active workflows',
        details: { shortcut: SAFETY_PAUSE_HOTKEY }
      });
      mainWindow?.webContents.send('workflows:changed', 'Global safety shortcut paused active workflows.');
    } catch (error) {
      await log({
        level: 'error',
        scope: 'safety',
        message: 'Global safety shortcut failed',
        details: { error: error instanceof Error ? error.message : String(error) }
      });
    }
  });

  log({
    level: pauseOk ? 'info' : 'warn',
    scope: 'safety',
    message: pauseOk ? 'Registered global safety pause hotkey' : 'Could not register global safety pause hotkey',
    details: { shortcut: SAFETY_PAUSE_HOTKEY }
  });
}

app.whenReady().then(async () => {
  await ensureDataFiles();
  await armActiveWorkflows();
  registerIpc();
  createWindow();
  registerHotkeys();

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  watchScheduler.stopAll();
  globalShortcut.unregisterAll();
});
