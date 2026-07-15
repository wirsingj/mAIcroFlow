import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppLogEntry,
  AppSettings,
  CaptureRegion,
  CaptureDisplaySource,
  CaptureSourceKind,
  ExtractionResult,
  OllamaStatus,
  SetupActionResult,
  Workflow,
  WorkflowExampleImage,
  WorkflowRunProgress,
  WorkflowRunResult,
  WorkflowRunPreview
} from '../shared/types';

const api = {
  bootstrap: () =>
    ipcRenderer.invoke('app:bootstrap') as Promise<{
      workflows: Workflow[];
      settings: AppSettings;
      logs: AppLogEntry[];
      ollama: OllamaStatus;
    }>,
  listWorkflows: () => ipcRenderer.invoke('workflows:list') as Promise<Workflow[]>,
  saveWorkflows: (workflows: Workflow[]) => ipcRenderer.invoke('workflows:save', workflows) as Promise<Workflow[]>,
  runWorkflow: (workflowId: string, manualText?: string) =>
    ipcRenderer.invoke('workflow:run', workflowId, manualText) as Promise<WorkflowRunResult>,
  confirmWorkflowRun: (runId: string, extraction: ExtractionResult) =>
    ipcRenderer.invoke('workflow:confirm', runId, extraction) as Promise<void>,
  cancelWorkflowRun: (runId: string) => ipcRenderer.invoke('workflow:cancel', runId) as Promise<void>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings) as Promise<AppSettings>,
  checkOllama: () => ipcRenderer.invoke('ollama:check') as Promise<OllamaStatus>,
  pullOllamaModel: (model: string) => ipcRenderer.invoke('ollama:pull-model', model) as Promise<SetupActionResult>,
  openUrl: (url: string) => ipcRenderer.invoke('app:open-url', url) as Promise<void>,
  listLogs: () => ipcRenderer.invoke('logs:list') as Promise<AppLogEntry[]>,
  listCaptureSources: () => ipcRenderer.invoke('capture:sources') as Promise<CaptureDisplaySource[]>,
  pickCaptureRegion: () =>
    ipcRenderer.invoke('capture:pick-region') as Promise<{ source: 'display-id'; displayId: string; region: CaptureRegion } | null>,
  pickWorkflowCaptureRegion: (workflowId?: string) =>
    ipcRenderer.invoke('workflow:pick-capture-region', workflowId) as Promise<Workflow | null>,
  readCaptureDataUrl: (imagePath: string) => ipcRenderer.invoke('capture:image-data-url', imagePath) as Promise<string>,
  importExampleImage: (workflowId: string, nodeId: string, refName: string, use: WorkflowExampleImage['use']) =>
    ipcRenderer.invoke('examples:import-image', workflowId, nodeId, refName, use) as Promise<WorkflowExampleImage | null>,
  savePastedExampleImage: (
    dataUrl: string,
    workflowId: string,
    nodeId: string,
    refName: string,
    use: WorkflowExampleImage['use']
  ) => ipcRenderer.invoke('examples:save-pasted-image', dataUrl, workflowId, nodeId, refName, use) as Promise<WorkflowExampleImage>,
  captureExampleImage: (
    workflowId: string,
    nodeId: string,
    refName: string,
    use: WorkflowExampleImage['use'],
    options?: { source?: CaptureSourceKind; displayId?: string; region?: CaptureRegion }
  ) => ipcRenderer.invoke('examples:capture-image', workflowId, nodeId, refName, use, options) as Promise<WorkflowExampleImage>,
  readExampleImageDataUrl: (imagePath: string) => ipcRenderer.invoke('examples:image-data-url', imagePath) as Promise<string>,
  chooseOutputFolder: () => ipcRenderer.invoke('output:choose-folder') as Promise<string | null>,
  revealOutput: (outputPath: string) => ipcRenderer.invoke('output:reveal', outputPath) as Promise<void>,
  showFloatingControl: () => ipcRenderer.invoke('app:show-floating-control') as Promise<void>,
  showMainWindow: () => ipcRenderer.invoke('app:show-main-window') as Promise<void>,
  onPreviewReady: (callback: (preview: WorkflowRunPreview) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, preview: WorkflowRunPreview): void => callback(preview);
    ipcRenderer.on('workflow:preview-ready', listener);
    return () => ipcRenderer.removeListener('workflow:preview-ready', listener);
  },
  onTriggerError: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message);
    ipcRenderer.on('workflow:trigger-error', listener);
    return () => ipcRenderer.removeListener('workflow:trigger-error', listener);
  },
  onAutoRunComplete: (callback: (workflowId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, workflowId: string): void => callback(workflowId);
    ipcRenderer.on('workflow:auto-run-complete', listener);
    return () => ipcRenderer.removeListener('workflow:auto-run-complete', listener);
  },
  onRunProgress: (callback: (progress: WorkflowRunProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: WorkflowRunProgress): void => callback(progress);
    ipcRenderer.on('workflow:progress', listener);
    return () => ipcRenderer.removeListener('workflow:progress', listener);
  },
  onWorkflowsChanged: (callback: (reason: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, reason: string): void => callback(reason);
    ipcRenderer.on('workflows:changed', listener);
    return () => ipcRenderer.removeListener('workflows:changed', listener);
  }
};

contextBridge.exposeInMainWorld('maicroFlow', api);

export type MaicroFlowApi = typeof api;
