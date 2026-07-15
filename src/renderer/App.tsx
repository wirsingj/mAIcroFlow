import {
  ArrowDown,
  ArrowUp,
  BrainCircuit,
  Braces,
  Camera,
  Check,
  ClipboardList,
  Crosshair,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow as WorkflowIcon,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, ReactElement } from 'react';
import {
  applyLiveIntentionProposalToWorkflow,
  hasLiveIntentionFields,
  liveIntentionDraftDiff,
  type LiveIntentionDraftChange,
  liveIntentionProposalFromFields,
  liveIntentionFieldDescriptions,
  liveIntentionFieldLabels,
  liveIntentionFields
} from '../shared/liveIntention';
import type {
  AppLogEntry,
  AppSettings,
  CaptureDisplaySource,
  CaptureRegion,
  ExtractionResult,
  OllamaStatus,
  PermissionCapability,
  SetupActionResult,
  StructuredFieldValue,
  Workflow,
  WorkflowExampleImage,
  WorkflowNode,
  WorkflowRunProgress,
  WorkflowRunPreview
} from '../shared/types';
import { workflowCapabilityRequirements } from '../shared/capabilities';
import { createMacroNodeFromTemplate, macroNodeTemplates, type MacroNodeTemplateKind } from '../shared/macroNodeTemplates';
import { createLiveIntentionWorkflow, createNewMacroWorkflow } from '../shared/workflowTemplates';
import { lintWorkflow, workflowHasBlockingDiagnostics } from '../shared/workflowLint';
import { isVisualTriggerKind, workflowCanRun, workflowRunReadinessIssues } from '../shared/workflowReadiness';

type Tab = 'workflows' | 'ai' | 'captures' | 'settings';
type CaptureRequest = { source: 'cursor-display' | 'primary-display' | 'display-id'; displayId?: string; region?: CaptureRegion };
type PermissionChoice = 'once' | 'session' | 'always' | 'deny';
type PermissionRequest = {
  capability: PermissionCapability;
  reason?: string;
};

const isFloatingMode = new URLSearchParams(window.location.search).get('floating') === '1';
const blankExtraction: ExtractionResult = {
  fish_name: '',
  exp_gained: '',
  weight: '',
  class_tier: '',
  bait_used: '',
  confidence: 0,
  notes: ''
};

const permissionText: Record<PermissionCapability, { title: string; body: string; future?: boolean }> = {
  'screen-region-capture': {
    title: 'Allow mAIcroFlow to capture the selected screen region?',
    body: 'This opens the visible rectangle picker and stores the chosen monitor/coordinates in the workflow.'
  },
  'screen-observation': {
    title: 'Allow mAIcroFlow to observe the configured screen region?',
    body: 'This lets the workflow capture visible pixels through normal OS screenshot APIs for analysis.'
  },
  'local-ai-analysis': {
    title: 'Allow mAIcroFlow to ask local AI to analyze the visible state?',
    body: 'The app sends the temporary capture and workflow prompt only to the configured local Ollama endpoint.'
  },
  'propose-actions': {
    title: 'Allow this flow to propose mouse/keyboard or output actions?',
    body: 'Suggested actions are recorded as editable proposal fields. They are not executed automatically.'
  },
  'browser-prompt': {
    title: 'Allow mAIcroFlow to open a browser prompt when you approve?',
    body: 'This is used only for explicit setup links, such as opening an official model or app download page.'
  },
  'command-help': {
    title: 'Allow this flow to request command-line help when you approve?',
    body: 'Command-line execution is not implemented in this MVP; this permission shape is reserved for future explicit flows.',
    future: true
  }
};

export function App(): ReactElement {
  if (isFloatingMode) {
    return <FloatingControl />;
  }

  const [tab, setTab] = useState<Tab>('workflows');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [captureSources, setCaptureSources] = useState<CaptureDisplaySource[]>([]);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [preview, setPreview] = useState<WorkflowRunPreview | null>(null);
  const [runProgressByWorkflow, setRunProgressByWorkflow] = useState<Record<string, WorkflowRunProgress>>({});
  const [editedExtraction, setEditedExtraction] = useState<ExtractionResult>(blankExtraction);
  const [manualText, setManualText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Ready');
  const [sessionApprovals, setSessionApprovals] = useState<Partial<Record<PermissionCapability, true>>>({});
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const permissionResolver = useRef<((approved: boolean) => void) | null>(null);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? workflows[0],
    [selectedWorkflowId, workflows]
  );

  useEffect(() => {
    void bootstrap();
    const offPreview = window.maicroFlow.onPreviewReady((incomingPreview) => {
      setPreview(incomingPreview);
      setEditedExtraction(incomingPreview.extraction);
      setNotice('A run needs review before it can continue.');
    });
    const offError = window.maicroFlow.onTriggerError((message) => setNotice(message));
    const offAutoRun = window.maicroFlow.onAutoRunComplete(() => {
      void window.maicroFlow.listWorkflows().then(setWorkflows);
      void refreshLogs();
    });
    const offProgress = window.maicroFlow.onRunProgress((progress) => {
      setRunProgressByWorkflow((current) => ({
        ...current,
        [progress.workflowId]: progress
      }));
      setNotice(progress.message);
    });
    const offWorkflowsChanged = window.maicroFlow.onWorkflowsChanged((reason) => {
      void window.maicroFlow.listWorkflows().then(setWorkflows);
      void refreshLogs();
      setNotice(reason);
    });
    return () => {
      offPreview();
      offError();
      offAutoRun();
      offProgress();
      offWorkflowsChanged();
    };
  }, []);

  async function bootstrap(): Promise<void> {
    setBusy(true);
    try {
      const data = await window.maicroFlow.bootstrap();
      setWorkflows(data.workflows);
      setSettings(data.settings);
      setLogs(data.logs);
      setOllama(data.ollama);
      setCaptureSources(await window.maicroFlow.listCaptureSources());
      setSelectedWorkflowId(data.workflows[0]?.id ?? '');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function refreshLogs(): Promise<void> {
    setLogs(await window.maicroFlow.listLogs());
  }

  async function runWorkflow(workflowId: string): Promise<void> {
    if (!(await ensurePermission('screen-observation', 'Running a workflow captures the configured visible pixels.'))) {
      setNotice('Screen observation was not approved.');
      return;
    }
    if (!(await ensurePermission('local-ai-analysis', 'The extraction step may ask local Ollama to interpret the capture.'))) {
      setNotice('Local AI analysis was not approved.');
      return;
    }
    setBusy(true);
    setNotice('Capturing the visible screen and asking local Ollama to extract fields...');
    try {
      const incomingPreview = await window.maicroFlow.runWorkflow(workflowId, manualText);
      setWorkflows(await window.maicroFlow.listWorkflows());
      await refreshLogs();
      if (incomingPreview.preview) {
        setPreview(incomingPreview.preview);
        setEditedExtraction(incomingPreview.preview.extraction);
        setNotice('Run needs review before it can continue.');
      } else if (incomingPreview.appended) {
        setPreview(null);
        setNotice(
          isClipboardOutputPath(incomingPreview.outputPath)
            ? 'Run completed. Copied structured fields to clipboard.'
            : incomingPreview.outputPath
              ? `Run completed. Wrote row to ${incomingPreview.outputPath}.`
              : 'Run completed and row was appended.'
        );
      } else if (incomingPreview.ignored) {
        setNotice(incomingPreview.message ?? 'Run did not start.');
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkflows(nextWorkflows: Workflow[]): Promise<void> {
    setWorkflows(nextWorkflows);
    const saved = await window.maicroFlow.saveWorkflows(nextWorkflows);
    setWorkflows(saved);
    await refreshLogs();
  }

  async function toggleWorkflow(workflow: Workflow): Promise<void> {
    const nextStatus = workflow.status === 'active' ? 'paused' : 'active';
    await saveWorkflows(workflows.map((item) => (item.id === workflow.id ? { ...item, status: nextStatus } : item)));
  }

  async function deleteWorkflow(workflowId: string): Promise<void> {
    const next = workflows.filter((workflow) => workflow.id !== workflowId);
    await saveWorkflows(next);
    setSelectedWorkflowId(next[0]?.id ?? '');
  }

  async function createWorkflow(): Promise<void> {
    const workflow = createNewMacroWorkflow();
    const next = [...workflows, workflow];
    await saveWorkflows(next);
    setSelectedWorkflowId(workflow.id);
    setNotice('New macro created. Add a trigger screenshot, then add the next step.');
  }

  async function createLiveWorkflow(): Promise<void> {
    if (!(await ensurePermission('screen-region-capture', 'New Live Flow starts by selecting the exact screen rectangle to observe.'))) {
      setNotice('Region capture was not approved.');
      return;
    }
    const picked = await window.maicroFlow.pickCaptureRegion();
    if (!picked) {
      setNotice('Live flow setup canceled before selecting a region.');
      return;
    }
    if (!(await ensurePermission('local-ai-analysis', 'The live flow draft uses local AI to interpret the selected visible state.'))) {
      setNotice('Local AI analysis was not approved.');
      return;
    }
    if (!(await ensurePermission('propose-actions', 'The live flow will ask AI for a proposed routine and suggested action, but will not execute it.'))) {
      setNotice('Action proposals were not approved.');
      return;
    }
    const workflow = createLiveIntentionWorkflow(picked);
    const next = [...workflows, workflow];
    await saveWorkflows(next);
    setSelectedWorkflowId(workflow.id);
    setNotice('Live flow draft created. Run Test to capture the selected region and review the AI proposal.');
  }

  async function ensurePermission(capability: PermissionCapability, reason?: string): Promise<boolean> {
    if (settings?.safety.capabilityApprovals?.[capability] === 'always' || sessionApprovals[capability]) {
      return true;
    }
    return new Promise((resolve) => {
      permissionResolver.current = resolve;
      setPermissionRequest({ capability, reason });
    });
  }

  async function resolvePermission(choice: PermissionChoice): Promise<void> {
    const request = permissionRequest;
    setPermissionRequest(null);
    if (!request || !permissionResolver.current) return;
    if (choice === 'deny') {
      permissionResolver.current(false);
      permissionResolver.current = null;
      return;
    }
    if (choice === 'session') {
      setSessionApprovals((current) => ({ ...current, [request.capability]: true }));
    }
    if (choice === 'always' && settings) {
      const nextSettings: AppSettings = {
        ...settings,
        safety: {
          ...settings.safety,
          capabilityApprovals: {
            ...(settings.safety.capabilityApprovals ?? {}),
            [request.capability]: 'always'
          }
        }
      };
      setSettings(await window.maicroFlow.saveSettings(nextSettings));
    }
    permissionResolver.current(true);
    permissionResolver.current = null;
  }

  async function confirmRun(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    try {
      await window.maicroFlow.confirmWorkflowRun(preview.runId, editedExtraction);
      setPreview(null);
      setWorkflows(await window.maicroFlow.listWorkflows());
      await refreshLogs();
      setNotice(isClipboardOutputPath(preview.outputPath) ? 'Copied structured fields to clipboard.' : `Saved row to ${preview.outputPath}.`);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function applyLiveProposalToDraft(): Promise<void> {
    if (!preview) return;
    const fields = editedExtraction.fields ?? preview.structuredExtraction?.fields ?? {};
    if (!hasLiveIntentionFields(fields)) {
      setNotice('This review does not contain a live-intention proposal.');
      return;
    }
    const proposal = liveIntentionProposalFromFields(fields);
    const nextWorkflows = workflows.map((workflow) =>
      workflow.id === preview.workflowId ? applyLiveIntentionProposalToWorkflow(workflow, proposal) : workflow
    );
    await saveWorkflows(nextWorkflows);
    setSelectedWorkflowId(preview.workflowId);
    setNotice('Applied proposal to the editable workflow draft. Review nodes before arming.');
  }

  async function cancelRun(): Promise<void> {
    if (preview) {
      await window.maicroFlow.cancelWorkflowRun(preview.runId);
    }
    setPreview(null);
    await refreshLogs();
    setNotice('Capture canceled. Nothing was written.');
  }

  async function checkOllama(): Promise<void> {
    setBusy(true);
    try {
      setOllama(await window.maicroFlow.checkOllama());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">m</div>
          <div>
            <strong>mAIcroFlow</strong>
            <span>screen-aware AI macros</span>
          </div>
        </div>
        <nav>
          <NavButton icon={<WorkflowIcon size={18} />} label="Workflows" active={tab === 'workflows'} onClick={() => setTab('workflows')} />
          <NavButton icon={<BrainCircuit size={18} />} label="AI Setup" active={tab === 'ai'} onClick={() => setTab('ai')} />
          <NavButton icon={<Camera size={18} />} label="Captures" active={tab === 'captures'} onClick={() => setTab('captures')} />
          <NavButton icon={<Settings size={18} />} label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
        </nav>
        <div className="sidebarFooter">
          <span className="hotkey">F12</span>
          <span>Default trigger. Active workflows can use their configured hotkey.</span>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <h1>{tabTitle(tab)}</h1>
            <p>{notice}</p>
        </div>
        <div className="topbarActions">
            <button className="ghostButton" onClick={() => void window.maicroFlow.showFloatingControl()} disabled={busy}>
              <SlidersHorizontal size={16} />
              Floating Control
            </button>
          </div>
        </header>

        {tab === 'workflows' && (
          <WorkflowsPage
            workflows={workflows}
            selectedWorkflow={selectedWorkflow}
            progress={selectedWorkflow ? runProgressByWorkflow[selectedWorkflow.id] : undefined}
            manualText={manualText}
            captureSources={captureSources}
            setManualText={setManualText}
            onRun={(id) => void runWorkflow(id)}
            onSelect={setSelectedWorkflowId}
            onToggle={(workflow) => void toggleWorkflow(workflow)}
            onDelete={(id) => void deleteWorkflow(id)}
            onCreate={() => void createWorkflow()}
            onCreateLive={() => void createLiveWorkflow()}
            onSave={(workflow) => saveWorkflows(workflows.map((item) => (item.id === workflow.id ? workflow : item)))}
            onRevealOutput={(path) => void window.maicroFlow.revealOutput(path)}
            onOpenLogs={() => setTab('captures')}
            ensurePermission={ensurePermission}
            busy={busy}
          />
        )}

        {tab === 'ai' && (
          <AiSetupPage
            workflow={selectedWorkflow}
            ollama={ollama}
            settings={settings}
            onCheck={() => void checkOllama()}
            onSettings={setSettings}
            onSaveSettings={async (next) => setSettings(await window.maicroFlow.saveSettings(next))}
            onNotice={setNotice}
            onOllama={setOllama}
            ensurePermission={ensurePermission}
          />
        )}
        {tab === 'captures' && <CapturesPage logs={logs} onRefresh={() => void refreshLogs()} />}
        {tab === 'settings' && <SettingsPage settings={settings} onSave={async (next) => setSettings(await window.maicroFlow.saveSettings(next))} />}
      </main>

      {preview && (
        <ConfirmationModal
          preview={preview}
          extraction={editedExtraction}
          setExtraction={setEditedExtraction}
          onConfirm={() => void confirmRun()}
          onCancel={() => void cancelRun()}
          onApplyProposal={() => void applyLiveProposalToDraft()}
          workflow={workflows.find((workflow) => workflow.id === preview.workflowId)}
          busy={busy}
        />
      )}
      {permissionRequest && (
        <PermissionModal
          request={permissionRequest}
          onResolve={(choice) => void resolvePermission(choice)}
        />
      )}
    </div>
  );
}

function FloatingControl(): ReactElement {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const selectedWorkflowIdRef = useRef('');
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [notice, setNotice] = useState('Ready');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.classList.add('floatingBody');
    void refreshWorkflow();
    const offWorkflowsChanged = window.maicroFlow.onWorkflowsChanged((reason) => {
      setNotice(reason);
      void refreshWorkflow(selectedWorkflowIdRef.current);
    });
    return () => {
      offWorkflowsChanged();
      document.body.classList.remove('floatingBody');
    };
  }, []);

  async function refreshWorkflow(preferredWorkflowId = selectedWorkflowId): Promise<void> {
    const nextWorkflows = await window.maicroFlow.listWorkflows();
    setWorkflows(nextWorkflows);
    const selected =
      nextWorkflows.find((item) => item.id === preferredWorkflowId) ??
      nextWorkflows.find((item) => item.status === 'active') ??
      nextWorkflows[0] ??
      null;
    setWorkflow(selected);
    setSelectedWorkflowId(selected?.id ?? '');
    selectedWorkflowIdRef.current = selected?.id ?? '';
  }

  async function runNow(): Promise<void> {
    if (!workflow) return;
    setBusy(true);
    setNotice('Running...');
    try {
      const result = await window.maicroFlow.runWorkflow(workflow.id);
      await refreshWorkflow(workflow.id);
      if (result.appended) {
        setNotice(isClipboardOutputPath(result.outputPath) ? 'Copied' : 'Saved');
      } else if (result.preview) {
        setNotice('Review needed');
      } else if (result.ignored) {
        setNotice(result.message ?? 'Run did not start');
      } else {
        setNotice('Busy');
      }
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function pickRegion(): Promise<void> {
    if (!workflow) return;
    setBusy(true);
    setNotice('Drag a rectangle...');
    try {
      const updated = await window.maicroFlow.pickWorkflowCaptureRegion(workflow.id);
      await refreshWorkflow(workflow.id);
      setNotice(updated ? 'Region saved' : 'Region canceled');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="floatingControl">
      <div className="floatingDrag">
        <div className="brandMark tiny">m</div>
        <div>
          <strong>{workflow?.name ?? 'mAIcroFlow'}</strong>
          <span>{workflow?.runnerState ?? 'loading'} - capture-excluded</span>
        </div>
      </div>
      <div className="floatingActions">
        {workflows.length > 1 && (
          <select
            className="floatingSelect"
            value={workflow?.id ?? ''}
            onChange={(event) => {
              setSelectedWorkflowId(event.target.value);
              selectedWorkflowIdRef.current = event.target.value;
              setWorkflow(workflows.find((item) => item.id === event.target.value) ?? null);
            }}
            title="Choose workflow"
          >
            {workflows.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <button title="Run workflow now" onClick={() => void runNow()} disabled={busy || !workflow}>
          <Play size={16} />
          <span>Run</span>
        </button>
        <button title="Pick capture rectangle" onClick={() => void pickRegion()} disabled={busy || !workflow}>
          <Crosshair size={16} />
          <span>Region</span>
        </button>
        <button title="Open full app" onClick={() => void window.maicroFlow.showMainWindow()}>
          <WorkflowIcon size={16} />
          <span>Open Builder</span>
        </button>
      </div>
      <p>{notice}</p>
    </div>
  );
}

function WorkflowsPage(props: {
  workflows: Workflow[];
  selectedWorkflow?: Workflow;
  progress?: WorkflowRunProgress;
  manualText: string;
  captureSources: CaptureDisplaySource[];
  setManualText: (value: string) => void;
  onRun: (id: string) => void;
  onSelect: (id: string) => void;
  onToggle: (workflow: Workflow) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onCreateLive: () => void;
  onSave: (workflow: Workflow) => Promise<void>;
  onRevealOutput: (path: string) => void;
  onOpenLogs: () => void;
  ensurePermission: (capability: PermissionCapability, reason?: string) => Promise<boolean>;
  busy: boolean;
}): ReactElement {
  const selectedCanArm = props.selectedWorkflow
    ? workflowCanRun(props.selectedWorkflow) && !workflowHasBlockingDiagnostics(props.selectedWorkflow)
    : false;
  const selectedIsActive = props.selectedWorkflow?.status === 'active';

  if (props.workflows.length === 0) {
    return (
      <div className="pageGrid focused">
        <section className="starterHero">
          <div className="starterHeroCopy">
            <span className="eyebrow">Local-first macro workbench</span>
            <h2>mAIcroFlow</h2>
            <p>Visible pixels become structured observations, local AI proposes fields, and explicit workflow nodes decide what gets written.</p>
            <div className="starterActions">
              <button className="primaryButton bigAction" onClick={props.onCreate} disabled={props.busy}>
                <Plus size={16} />
                New Macro
              </button>
              <button className="ghostButton bigAction" onClick={props.onCreateLive} disabled={props.busy}>
                <Crosshair size={16} />
                New Live Flow
              </button>
              <button className="ghostButton" onClick={props.onOpenLogs}>
                <ClipboardList size={16} />
                Run Inspector
              </button>
            </div>
          </div>
          <WorkflowContractCard />
        </section>
        <section className="starterRail" aria-label="mAIcroFlow workflow contract">
          <ContractChip icon={<Eye size={17} />} title="Observe" detail="Visible screen captures only" />
          <ContractChip icon={<Braces size={17} />} title="Structure" detail="JSON fields and run traces" />
          <ContractChip icon={<ShieldCheck size={17} />} title="Guard" detail="Validation before output" />
          <ContractChip icon={<Sparkles size={17} />} title="Adapt" detail="Ready for local providers" />
        </section>
      </div>
    );
  }

  return (
    <div className="pageGrid focused">
      {props.workflows.length > 1 && (
        <section className="panel wide compactLibrary">
          <label>
            Current workflow
            <select value={props.selectedWorkflow?.id ?? ''} onChange={(event) => props.onSelect(event.target.value)}>
              {props.workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
              ))}
            </select>
          </label>
          <button className="ghostButton" onClick={props.onCreate} disabled={props.busy}>
            <Plus size={16} />
            New
          </button>
          <button className="primaryButton" onClick={props.onCreateLive} disabled={props.busy}>
            <Crosshair size={16} />
            New Live Flow
          </button>
        </section>
      )}

      <section className="panel builderPanel wide">
        <div className="panelHeader">
          <div>
            <h2>Macro builder</h2>
            <p>Build a simple chain: when this happens, read this, then do that.</p>
          </div>
          <div className="compactState">
            {props.selectedWorkflow && (
              <>
                <StatusPill status={props.selectedWorkflow.status} />
                <RunnerPill state={props.selectedWorkflow.runnerState ?? (props.selectedWorkflow.status === 'active' ? 'armed' : 'inactive')} />
              </>
            )}
            <button className="ghostButton" type="button" onClick={props.onCreate} disabled={props.busy}>
              <Plus size={15} />
              New Macro
            </button>
            <button className="primaryButton" type="button" onClick={props.onCreateLive} disabled={props.busy}>
              <Crosshair size={15} />
              New Live Flow
            </button>
          </div>
        </div>
        {props.selectedWorkflow ? (
          <WorkflowBuilder
            workflow={props.selectedWorkflow}
            progress={props.progress}
            captureSources={props.captureSources}
            onSave={props.onSave}
            onRun={props.onRun}
            onRevealOutput={props.onRevealOutput}
            onOpenLogs={props.onOpenLogs}
            ensurePermission={props.ensurePermission}
          />
        ) : (
          <div className="emptyText">
            Create a flow to define trigger, capture, extraction, validation, and output nodes.
          </div>
        )}
      </section>
    </div>
  );
}

function normalizeGuidedMacro(workflow: Workflow): Workflow {
  const sourceNodes = workflow.nodes.length ? workflow.nodes : [createMacroNodeFromTemplate('watch-screen')];
  const nodes = sourceNodes.map((node) => normalizeBuilderNode(node, workflow));
  const triggerNode = nodes.find((node) => node.type === 'trigger');

  return {
    ...workflow,
    trigger: {
      ...workflow.trigger,
      kind: workflow.trigger.kind === 'hotkey' ? 'hotkey' : workflow.trigger.kind,
      hotkey: workflow.trigger.hotkey ?? stringValue(triggerNode?.config.hotkey) ?? 'F12',
      detectionIntervalSeconds: workflow.trigger.detectionIntervalSeconds ?? 5,
      detectionCooldownSeconds: workflow.trigger.detectionCooldownSeconds ?? 10,
      duplicateDetectionEnabled: workflow.trigger.duplicateDetectionEnabled ?? true,
      experimental: workflow.trigger.kind !== 'hotkey',
      summary:
        workflow.trigger.kind === 'hotkey'
          ? `${workflow.trigger.hotkey ?? 'F12'} hotkey`
          : visualTriggerSummary(workflow.trigger.kind, workflow.trigger.detectionIntervalSeconds ?? 5)
    },
    nodes
  };
}

function normalizeBuilderNode(node: WorkflowNode, workflow: Workflow): WorkflowNode {
  if (node.type === 'trigger') {
    return {
      ...node,
      title: node.title || 'When this happens',
      summary: node.summary || 'Start this macro from a hotkey or matching visible screen.',
      config: {
        ...node.config,
        kind: workflow.trigger.kind,
        hotkey: workflow.trigger.hotkey ?? stringValue(node.config.hotkey) ?? 'F12',
        detectionIntervalSeconds: workflow.trigger.detectionIntervalSeconds ?? 5,
        detectionCooldownSeconds: workflow.trigger.detectionCooldownSeconds ?? 10,
        duplicateDetectionEnabled: workflow.trigger.duplicateDetectionEnabled ?? true,
        exampleRefs: exampleImagesFromNode(node)
      }
    };
  }

  if (node.type === 'capture') {
    return {
      ...node,
      title: node.title || 'Capture visible screen',
      summary: node.summary || 'Capture visible pixels for later macro steps.',
      config: {
        mode: 'full-screen',
        source: 'cursor-display',
        ...node.config
      }
    };
  }

  if (node.type === 'extract') {
    return {
      ...node,
      title: node.title || 'AI step',
      summary: node.summary || 'Use local AI to read or reason about visible content.',
      config: {
        kind: 'ollama-vision',
        ...node.config,
        fieldsText: fieldsTextValue(node.config),
        fields: parseFieldsText(fieldsTextValue(node.config)),
        prompt: stringValue(node.config.prompt) || 'Read the screenshot and return the requested visible values as strict JSON.',
        exampleRefs: exampleImagesFromNode(node)
      }
    };
  }

  if (node.type === 'action') {
    const rawKind = stringValue(node.config.kind) || 'append-csv';
    return {
      ...node,
      title: node.title || 'Output',
      summary: node.summary || 'Write the macro result to a local output.',
      config: {
        kind: rawKind,
        ...node.config,
        prompt:
          stringValue(node.config.prompt) ||
          actionPromptForKind(rawKind),
        outputDirectory: stringValue(node.config.outputDirectory),
        fileName: stringValue(node.config.fileName) || (isFileOutputAction(rawKind) ? defaultActionFileName(rawKind, 'macro_output') : '')
      }
    };
  }

  return node;
}

function WorkflowBuilder({
  workflow,
  progress,
  captureSources,
  onSave,
  onRun,
  onRevealOutput,
  onOpenLogs,
  ensurePermission
}: {
  workflow: Workflow;
  progress?: WorkflowRunProgress;
  captureSources: CaptureDisplaySource[];
  onSave: (workflow: Workflow) => Promise<void>;
  onRun: (workflowId: string) => void;
  onRevealOutput: (path: string) => void;
  onOpenLogs: () => void;
  ensurePermission: (capability: PermissionCapability, reason?: string) => Promise<boolean>;
}): ReactElement {
  const [draft, setDraft] = useState(() => normalizeGuidedMacro(workflow));
  const [newNodeKind, setNewNodeKind] = useState<MacroNodeTemplateKind>('screen-grab');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const triggerIndex = draft.nodes.findIndex((node) => node.type === 'trigger');
  const triggerNode = triggerIndex >= 0 ? draft.nodes[triggerIndex] : undefined;
  const captureIndex = draft.nodes.findIndex((node) => node.type === 'capture');
  const captureConfig = captureIndex >= 0 ? draft.nodes[captureIndex].config : {};
  const extractIndex = draft.nodes.findIndex((node) => node.type === 'extract');
  const extractNode = extractIndex >= 0 ? draft.nodes[extractIndex] : undefined;
  const extractConfig = extractIndex >= 0 ? draft.nodes[extractIndex].config : {};
  const actionIndex = draft.nodes.findIndex((node) => node.type === 'action');
  const actionNode = actionIndex >= 0 ? draft.nodes[actionIndex] : undefined;
  const actionConfig = actionIndex >= 0 ? draft.nodes[actionIndex].config : {};
  const actionKind = stringValue(actionConfig.kind) || 'append-csv';
  const actionUsesFileOutput = isFileOutputAction(actionKind);
  const draftIsActive = draft.status === 'active';
  const diagnostics = useMemo(() => lintWorkflow(draft), [draft]);
  const runReadinessIssues = useMemo(() => workflowRunReadinessIssues(draft), [draft]);
  const hasBlockingDiagnostics = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const blockingDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warningCount = diagnostics.length - blockingDiagnostics.length;
  const canRunDraft = !hasBlockingDiagnostics && runReadinessIssues.length === 0;
  const visibleNodes = draft.nodes;

  useEffect(() => setDraft(normalizeGuidedMacro(workflow)), [workflow]);

  function updateNode(index: number, patch: Partial<WorkflowNode>): void {
    setDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node, nodeIndex) => (nodeIndex === index ? { ...node, ...patch } : node))
    }));
  }

  function moveNode(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.nodes.length) return;
    const nodes = [...draft.nodes];
    const [node] = nodes.splice(index, 1);
    nodes.splice(nextIndex, 0, node);
    setDraft({ ...draft, nodes });
  }

  function addNodeFromTemplate(kind: MacroNodeTemplateKind): void {
    const node = createMacroNodeFromTemplate(kind);
    const patch = workflowPatchForTemplate(kind, draft);
    setDraft({ ...draft, ...patch, nodes: [...draft.nodes, node] });
  }

  async function saveDraft(patch: Partial<Workflow> = {}): Promise<void> {
    const next = normalizeGuidedMacro({ ...draft, ...patch });
    setDraft(next);
    await onSave(next);
  }

  async function runTest(): Promise<void> {
    const next = normalizeGuidedMacro({ ...draft, status: 'paused', runnerState: 'inactive' });
    setDraft(next);
    await onSave(next);
    onRun(next.id);
  }

  function replaceNodeFromTemplate(index: number, kind: MacroNodeTemplateKind): void {
    const replacement = createMacroNodeFromTemplate(kind);
    const existing = draft.nodes[index];
    const patch = workflowPatchForTemplate(kind, draft);
    setDraft({
      ...draft,
      ...patch,
      nodes: draft.nodes.map((node, nodeIndex) =>
        nodeIndex === index
          ? {
              ...replacement,
              id: existing.id
            }
          : node
      )
    });
  }

  function updateNodeConfig(index: number, key: string, value: unknown): void {
    const node = draft.nodes[index];
    updateNode(index, {
      config: {
        ...node.config,
        [key]: value
      }
    });
  }

  function updateActionConfig(key: string, value: string): void {
    if (actionIndex < 0) return;
    updateNode(actionIndex, {
      config: {
        ...actionConfig,
        [key]: value
      }
    });
  }

  function updateExtractConfig(key: string, value: string | string[]): void {
    if (extractIndex < 0) return;
    updateNode(extractIndex, {
      config: {
        ...extractConfig,
        [key]: value
      }
    });
  }

  function updateCaptureSource(value: string): void {
    if (captureIndex < 0) return;
    if (value.startsWith('display-id:')) {
      updateNode(captureIndex, {
        config: {
          ...captureConfig,
          source: 'display-id',
          displayId: value.replace('display-id:', '')
        }
      });
      return;
    }

    updateNode(captureIndex, {
      config: {
        ...captureConfig,
        source: value,
        displayId: undefined
      }
    });
  }

  function updateCaptureConfig(patch: Record<string, unknown>): void {
    if (captureIndex < 0) return;
    updateNode(captureIndex, {
      config: {
        ...captureConfig,
        ...patch
      }
    });
  }

  function updateCaptureRegion(key: 'x' | 'y' | 'width' | 'height', value: string): void {
    const region = regionValue(captureConfig.region);
    updateCaptureConfig({
      mode: 'region',
      region: {
        ...region,
        [key]: Number(value)
      }
    });
  }

  function updateActionKind(index: number, kind: string, defaultStem: string): void {
    setDraft((current) => ({
      ...current,
      autoAppend: kind === 'clipboard' ? false : current.autoAppend,
      nodes: current.nodes.map((node, nodeIndex) => {
        if (nodeIndex !== index) return node;
        const nextConfig = {
          ...node.config,
          kind,
          prompt: stringValue(node.config.prompt) || actionPromptForKind(kind)
        };
        if (isFileOutputAction(kind)) {
          return {
            ...node,
            config: {
              ...nextConfig,
              fileName: stringValue(node.config.fileName) || defaultActionFileName(kind, defaultStem)
            }
          };
        }
        return {
          ...node,
          config: nextConfig
        };
      })
    }));
  }

  function applyReferenceCaptureRequest(request: CaptureRequest): void {
    if (captureIndex < 0) return;
    updateNode(captureIndex, {
      config: {
        ...captureConfig,
        source: request.source,
        displayId: request.displayId,
        mode: request.region ? 'region' : 'full-screen',
        region: request.region
      }
    });
  }

  async function pickRegionForCapture(): Promise<void> {
    if (captureIndex < 0) return;
    if (!(await ensurePermission('screen-region-capture', 'Picking a capture rectangle observes your monitor layout and stores the selected region.'))) {
      return;
    }
    const picked = await window.maicroFlow.pickCaptureRegion();
    if (!picked) return;
    updateNode(captureIndex, {
      config: {
        ...captureConfig,
        source: picked.source,
        displayId: picked.displayId,
        mode: 'region',
        region: picked.region
      }
    });
  }

  function updateTrigger(patch: Partial<Workflow['trigger']>): void {
    const nextTrigger = { ...draft.trigger, ...patch };
    if (patch.kind === 'hotkey') {
      nextTrigger.hotkey = nextTrigger.hotkey || 'F12';
      nextTrigger.summary = `${nextTrigger.hotkey} hotkey`;
      nextTrigger.experimental = false;
    }
    if (patch.kind && isVisualTriggerKind(patch.kind)) {
      nextTrigger.summary = visualTriggerSummary(patch.kind, nextTrigger.detectionIntervalSeconds ?? 5);
      nextTrigger.experimental = true;
      nextTrigger.detectionCooldownSeconds = nextTrigger.detectionCooldownSeconds ?? 10;
      nextTrigger.detectionIntervalSeconds = nextTrigger.detectionIntervalSeconds ?? 5;
      nextTrigger.duplicateDetectionEnabled = nextTrigger.duplicateDetectionEnabled ?? true;
    }
    setDraft({ ...draft, trigger: nextTrigger });
  }

  async function chooseOutputFolder(nodeIndex = actionIndex): Promise<void> {
    const folder = await window.maicroFlow.chooseOutputFolder();
    if (folder && nodeIndex >= 0) {
      updateNodeConfig(nodeIndex, 'outputDirectory', folder);
    } else if (folder) {
      updateActionConfig('outputDirectory', folder);
    }
  }

  function addNodeExampleImage(nodeIndex: number, image: WorkflowExampleImage): void {
    const node = draft.nodes[nodeIndex];
    const refs = exampleImagesFromNode(node);
    updateNode(nodeIndex, {
      config: {
        ...node.config,
        exampleRefs: [...refs, image]
      }
    });
  }

  function removeNodeExampleImage(nodeIndex: number, id: string): void {
    const node = draft.nodes[nodeIndex];
    const refs = exampleImagesFromNode(node);
    updateNode(nodeIndex, {
      config: {
        ...node.config,
        exampleRefs: refs.filter((image) => image.id !== id)
      }
    });
  }

  function renderNodeOptions(node: WorkflowNode, index: number): ReactElement {
    if (node.type === 'trigger') {
      return (
        <div className="bubbleOptions">
          <NodeExampleRefs
            workflowId={draft.id}
            node={node}
            refs={exampleImagesFromNode(node)}
            captureSources={captureSources}
            onAdd={(image) => addNodeExampleImage(index, image)}
            onRemove={(id) => removeNodeExampleImage(index, id)}
            onCaptured={(request) => applyReferenceCaptureRequest(request)}
            ensurePermission={ensurePermission}
          />
          <label>
            Trigger
            <select value={draft.trigger.kind} onChange={(event) => updateTrigger({ kind: event.target.value as Workflow['trigger']['kind'] })}>
              <option value="hotkey">Hotkey</option>
              <option value="screen-detection">Watch screen</option>
              <option value="reference-image">Reference image</option>
              <option value="region-visible">Region visible</option>
            </select>
          </label>
          {draft.trigger.kind === 'hotkey' && (
            <label>
              Hotkey
              <input value={draft.trigger.hotkey ?? 'F12'} onChange={(event) => updateTrigger({ hotkey: event.target.value, summary: `${event.target.value} hotkey` })} />
            </label>
          )}
          {isVisualTriggerKind(draft.trigger.kind) && (
            <div className="bubbleOptionGrid">
              <label>
                Interval
                <select
                  value={draft.trigger.detectionIntervalSeconds ?? 5}
                  onChange={(event) =>
                    updateTrigger({
                      detectionIntervalSeconds: Number(event.target.value) as 1 | 2 | 5 | 10,
                      summary: visualTriggerSummary(draft.trigger.kind, Number(event.target.value))
                    })
                  }
                >
                  <option value={1}>1s</option>
                  <option value={2}>2s</option>
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                </select>
              </label>
              <label>
                Cooldown
                <input type="number" min="1" value={draft.trigger.detectionCooldownSeconds ?? 10} onChange={(event) => updateTrigger({ detectionCooldownSeconds: Number(event.target.value) })} />
              </label>
              <label>
                Minimum confidence
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={numberValue(node.config.confidenceMinimum, 0)}
                  onChange={(event) => updateNodeConfig(index, 'confidenceMinimum', Number(event.target.value))}
                />
              </label>
              <label>
                Pixel match minimum
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={numberValue(node.config.referenceSimilarityMinimum, 0.96)}
                  onChange={(event) => updateNodeConfig(index, 'referenceSimilarityMinimum', Number(event.target.value))}
                />
              </label>
            </div>
          )}
          <label className="toggleLine compactToggle">
            <input
              type="checkbox"
              checked={Boolean(draft.autoAppend)}
              onChange={(event) => setDraft({ ...draft, autoAppend: event.target.checked })}
            />
            Auto-run actions
          </label>
        </div>
      );
    }

    if (node.type === 'capture') {
      const config = node.config;
      return (
        <div className="bubbleOptions">
          <label>
            Source
            <select
              value={captureSourceSelectValue(config)}
              onChange={(event) => {
                const value = event.target.value;
                if (value.startsWith('display-id:')) {
                  updateNode(index, {
                    config: {
                      ...config,
                      source: 'display-id',
                      displayId: value.replace('display-id:', '')
                    }
                  });
                  return;
                }
                updateNode(index, { config: { ...config, source: value, displayId: undefined } });
              }}
            >
              <option value="cursor-display">Display under cursor</option>
              <option value="primary-display">Primary display</option>
              {captureSources.map((source) => (
                <option key={source.id} value={`display-id:${source.id}`}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          <label className="toggleLine compactToggle">
            <input
              type="checkbox"
              checked={config.mode === 'region'}
              onChange={(event) =>
                updateNode(index, {
                  config: {
                    ...config,
                    mode: event.target.checked ? 'region' : 'full-screen',
                    region: event.target.checked ? regionValue(config.region) : undefined
                  }
                })
              }
            />
            Crop region
          </label>
          {config.mode === 'region' && (
            <>
              <button className="ghostButton inlineToolButton" type="button" onClick={() => void pickRegionForCapture()} title="Drag to select a visible screen rectangle">
                <Crosshair size={14} />
                Pick Region
              </button>
              <div className="bubbleOptionGrid four">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <input
                      type="number"
                      min={key === 'width' || key === 'height' ? 1 : undefined}
                      value={regionValue(config.region)[key]}
                      onChange={(event) =>
                        updateNode(index, {
                          config: {
                            ...config,
                            region: {
                              ...regionValue(config.region),
                              [key]: Number(event.target.value)
                            }
                          }
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      );
    }

    if (node.type === 'extract') {
      return (
        <div className="bubbleOptions">
          <label>
            Fields
            <input
              value={fieldsTextValue(node.config)}
              onChange={(event) => updateNodeConfig(index, 'fieldsText', event.target.value)}
              placeholder="name, status, amount"
            />
          </label>
          <label>
            Prompt
            <textarea
              value={stringValue(node.config.prompt)}
              onChange={(event) => updateNodeConfig(index, 'prompt', event.target.value)}
              placeholder="Describe what this node should read from the screenshot."
            />
          </label>
          <NodeExampleRefs
            workflowId={draft.id}
            node={node}
            refs={exampleImagesFromNode(node)}
            captureSources={captureSources}
            onAdd={(image) => addNodeExampleImage(index, image)}
            onRemove={(id) => removeNodeExampleImage(index, id)}
            ensurePermission={ensurePermission}
          />
        </div>
      );
    }

    if (node.type === 'validate') {
      return (
        <div className="bubbleOptions">
          <div className="bubbleOptionGrid">
            <label>
              Required fields
              <input
                value={arrayValue(node.config.requiredFields).join(', ')}
                onChange={(event) => updateNodeConfig(index, 'requiredFields', commaList(event.target.value))}
                placeholder="name, amount"
              />
            </label>
            <label>
              Numeric fields
              <input
                value={arrayValue(node.config.numericFields).join(', ')}
                onChange={(event) => updateNodeConfig(index, 'numericFields', commaList(event.target.value))}
                placeholder="amount"
              />
            </label>
          </div>
          <label>
            Minimum confidence
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={numberValue(node.config.confidenceMinimum, 0.35)}
              onChange={(event) => updateNodeConfig(index, 'confidenceMinimum', Number(event.target.value))}
            />
          </label>
        </div>
      );
    }

    if (node.type === 'review') {
      return (
        <div className="bubbleOptions">
          <label className="toggleLine compactToggle">
            <input
              type="checkbox"
              checked={node.config.reviewOnValidationFailure !== false}
              onChange={(event) => updateNodeConfig(index, 'reviewOnValidationFailure', event.target.checked)}
            />
            Pause when validation fails
          </label>
        </div>
      );
    }

    const nodeActionKind = stringValue(node.config.kind) || 'append-csv';
    const nodeUsesFileOutput = isFileOutputAction(nodeActionKind);

    return (
      <div className="bubbleOptions">
        <label>
          Action instruction
          <textarea
            className="compactTextarea"
            value={stringValue(node.config.prompt)}
            onChange={(event) => updateNodeConfig(index, 'prompt', event.target.value)}
            placeholder="Describe the explicit output this action should perform."
          />
        </label>
        <label>
          Output type
          <select
            value={nodeActionKind}
            onChange={(event) => {
              updateActionKind(index, event.target.value, 'workflow_output');
            }}
          >
            <option value="append-csv">Append CSV row</option>
            <option value="xlsx">Append XLSX row</option>
            <option value="clipboard">Copy to clipboard</option>
            <option value="webhook" disabled>Webhook (planned)</option>
          </select>
        </label>
        {nodeUsesFileOutput && (
          <>
            <label>
              Output folder
              <div className="inputWithButton">
                <input
                  value={stringValue(node.config.outputDirectory)}
                  onChange={(event) => updateNodeConfig(index, 'outputDirectory', event.target.value)}
                  placeholder="defaults to Documents\\mAIcroFlow\\output"
                />
                <button className="ghostButton" onClick={() => void chooseOutputFolder(index)}>
                  Choose
                </button>
              </div>
            </label>
            <label>
              File name
              <input
                value={stringValue(node.config.fileName)}
                onChange={(event) => updateNodeConfig(index, 'fileName', event.target.value)}
                placeholder={defaultActionFileName(nodeActionKind, 'workflow_output')}
              />
            </label>
          </>
        )}
        <div className="outputPreview">
          <strong>{nodeUsesFileOutput ? 'Path' : 'Output'}</strong>
          <span>{previewOutputPath(node)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="builder">
      <div className="macroHeader">
        <div>
          <label>
            Macro name
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
        </div>
        <div className="primaryActions">
          <button
            className="primaryButton bigAction"
            onClick={() => void saveDraft({ status: draftIsActive ? 'paused' : 'active' })}
            disabled={!canRunDraft}
          >
            {draftIsActive ? <Pause size={18} /> : <Play size={18} />}
            {draftIsActive ? 'Save + Pause' : 'Save + Arm'}
          </button>
          <button
            className="ghostButton"
            onClick={() => void runTest()}
            disabled={!canRunDraft}
          >
            <Play size={18} />
            Run Test
          </button>
          <button className="ghostButton" onClick={() => void saveDraft()} disabled={hasBlockingDiagnostics}>
            <Save size={16} />
            Save
          </button>
          <button className="ghostButton subtleButton" onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? 'Hide Details' : 'Details'}
          </button>
        </div>
      </div>
      <div className={canRunDraft ? 'readyHint ready' : 'readyHint'}>
        <strong>{canRunDraft ? 'Ready macro' : 'Finish the macro before running'}</strong>
        <span>
          {canRunDraft
            ? 'Save + Arm stores these exact steps and starts listening. Run Test runs these exact steps once.'
            : runReadinessIssues.length
              ? `Next before running: ${runReadinessIssues.join(' ')}`
              : 'Fix the blocking issue below before running.'}
        </span>
      </div>
      <WorkflowContractCard workflow={draft} />
      {isLiveIntentionWorkflow(draft) && <LiveIntentionDraftCard workflow={draft} />}
      {progress && <RunProgressBar progress={progress} onRevealOutput={onRevealOutput} onOpenLogs={onOpenLogs} />}
      {blockingDiagnostics.length > 0 && (
        <div className="outputConfig warningBox">
          <strong>Fix before running</strong>
          <ul className="diagnosticList">
            {blockingDiagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}-${diagnostic.nodeId ?? 'workflow'}-${diagnostic.message}`} className={diagnostic.severity}>
                <span>{diagnostic.severity}</span>
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showAdvanced && warningCount > 0 && (
        <div className="quietNotice">
          {warningCount} non-blocking workflow note{warningCount === 1 ? '' : 's'}. The app can still run.
        </div>
      )}
      <div className="guidedMacro">
        {triggerNode && (
          <section className="macroStep whenStep">
            <div className="macroStepNumber">1</div>
            <div className="macroStepContent">
              <div className="macroStepTitle">
                <span>When</span>
                <strong>Start when</strong>
              </div>
              <div className="bubbleOptions">
                <label>
                  Run this macro
                  <select value={draft.trigger.kind} onChange={(event) => updateTrigger({ kind: event.target.value as Workflow['trigger']['kind'] })}>
                    <option value="screen-detection">When a screen or region appears</option>
                    <option value="reference-image">When a reference image matches</option>
                    <option value="region-visible">When a region is visible</option>
                    <option value="hotkey">When I press a hotkey</option>
                  </select>
                </label>
                {draft.trigger.kind === 'hotkey' && (
                  <label>
                    Hotkey
                    <input value={draft.trigger.hotkey ?? 'F12'} onChange={(event) => updateTrigger({ hotkey: event.target.value, summary: `${event.target.value} hotkey` })} />
                  </label>
                )}
                {isVisualTriggerKind(draft.trigger.kind) && (
                  <>
                    <NodeExampleRefs
                      workflowId={draft.id}
                      node={triggerNode}
                      refs={exampleImagesFromNode(triggerNode)}
                      captureSources={captureSources}
                      onAdd={(image) => addNodeExampleImage(triggerIndex, image)}
                      onRemove={(id) => removeNodeExampleImage(triggerIndex, id)}
                      onCaptured={(request) => applyReferenceCaptureRequest(request)}
                      ensurePermission={ensurePermission}
                    />
                    <div className="bubbleOptionGrid">
                      <label>
                        Check every
                        <select
                          value={draft.trigger.detectionIntervalSeconds ?? 5}
                          onChange={(event) =>
                            updateTrigger({
                              detectionIntervalSeconds: Number(event.target.value) as 1 | 2 | 5 | 10,
                              summary: visualTriggerSummary(draft.trigger.kind, Number(event.target.value))
                            })
                          }
                        >
                          <option value={1}>1s</option>
                          <option value={2}>2s</option>
                          <option value={5}>5s</option>
                          <option value={10}>10s</option>
                        </select>
                      </label>
                      <label>
                        Screen source
                        <div className="inputWithButton">
                          <select value={captureSourceSelectValue(captureConfig)} onChange={(event) => updateCaptureSource(event.target.value)}>
                            <option value="cursor-display">Display under cursor</option>
                            <option value="primary-display">Primary display</option>
                            {captureSources.map((source) => (
                              <option key={source.id} value={`display-id:${source.id}`}>
                                {source.label}
                              </option>
                            ))}
                          </select>
                          <button className="ghostButton" type="button" onClick={() => void pickRegionForCapture()} title="Drag to select a visible screen rectangle">
                            <Crosshair size={14} />
                            Pick
                          </button>
                        </div>
                      </label>
                      <label>
                        Minimum confidence
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          value={numberValue(triggerNode.config.confidenceMinimum, 0)}
                          onChange={(event) => updateNodeConfig(triggerIndex, 'confidenceMinimum', Number(event.target.value))}
                        />
                      </label>
                      <label>
                        Pixel match minimum
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={numberValue(triggerNode.config.referenceSimilarityMinimum, 0.96)}
                          onChange={(event) => updateNodeConfig(triggerIndex, 'referenceSimilarityMinimum', Number(event.target.value))}
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {extractNode && (
          <section className="macroStep aiStep">
            <div className="macroStepNumber">2</div>
            <div className="macroStepContent">
              <div className="macroStepTitle">
                <span>Read</span>
                <strong>Pull out these values</strong>
              </div>
              <div className="bubbleOptions">
                <label>
                  Field names
                  <input
                    value={fieldsTextValue(extractConfig)}
                    onChange={(event) => updateExtractConfig('fieldsText', event.target.value)}
                    placeholder="age, weight, timestamp"
                  />
                </label>
                <label>
                  AI instruction
                  <textarea
                    value={stringValue(extractConfig.prompt)}
                    onChange={(event) => updateExtractConfig('prompt', event.target.value)}
                    placeholder="Take the screenshot and pull out the age, weight, and timestamp values. Return JSON only."
                  />
                </label>
              </div>
            </div>
          </section>
        )}

        {actionNode && (
          <section className="macroStep doStep">
            <div className="macroStepNumber">3</div>
            <div className="macroStepContent">
              <div className="macroStepTitle">
                <span>Do</span>
                <strong>Write the result</strong>
              </div>
              <div className="bubbleOptions">
                <label>
                  Action instruction
                  <textarea
                    className="compactTextarea"
                    value={stringValue(actionConfig.prompt)}
                    onChange={(event) => updateActionConfig('prompt', event.target.value)}
                    placeholder="Add the extracted values to a spreadsheet row. Keep the raw values and update summary stats."
                  />
                </label>
                <label>
                  Output type
                  <select
                    value={actionKind}
                    onChange={(event) => {
                      updateActionKind(actionIndex, event.target.value, 'macro_output');
                    }}
                  >
                    <option value="append-csv">Add a row to CSV</option>
                    <option value="xlsx">Add a row to Excel workbook</option>
                    <option value="clipboard">Copy to clipboard</option>
                    <option value="keyboard-mouse" disabled>Keyboard/mouse action (planned, safety-gated)</option>
                  </select>
                </label>
                {actionUsesFileOutput && (
                  <>
                    <label>
                      Output folder
                      <div className="inputWithButton">
                        <input
                          value={stringValue(actionConfig.outputDirectory)}
                          onChange={(event) => updateActionConfig('outputDirectory', event.target.value)}
                          placeholder="defaults to Documents\\mAIcroFlow\\output"
                        />
                        <button className="ghostButton" onClick={() => void chooseOutputFolder(actionIndex)}>
                          Choose
                        </button>
                      </div>
                    </label>
                    <label>
                      File name
                      <input
                        value={stringValue(actionConfig.fileName)}
                        onChange={(event) => updateActionConfig('fileName', event.target.value)}
                        placeholder={defaultActionFileName(actionKind, 'macro_output')}
                      />
                    </label>
                  </>
                )}
                <div className="outputPreview">
                  <strong>{actionUsesFileOutput ? 'Output' : 'Action'}</strong>
                  <span>{previewOutputPath(actionNode)}</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {(
      <div className="stepList advancedSteps">
        {visibleNodes.map((node, visibleIndex) => {
          const index = draft.nodes.findIndex((item) => item.id === node.id);
          return (
            <div className={`stepItem node-${node.type}`} key={node.id}>
              <div className="stepNumber">{visibleIndex + 1}</div>
              <div className="stepBody">
                <div className="stepHeader">
                  <div className="stepTitle">
                  <span className="nodeBadge">{stepKindLabel(node)}</span>
                  <input value={node.title} onChange={(event) => updateNode(index, { title: event.target.value })} />
                </div>
                {showAdvanced && (
                  <div className="nodeActions">
                    <button title="Move earlier" onClick={() => moveNode(index, -1)} disabled={index === 0}>
                      <ArrowUp size={15} />
                    </button>
                    <button title="Move later" onClick={() => moveNode(index, 1)} disabled={index === draft.nodes.length - 1}>
                      <ArrowDown size={15} />
                    </button>
                    <button title="Remove node" onClick={() => setDraft({ ...draft, nodes: draft.nodes.filter((item) => item.id !== node.id) })}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
              {showAdvanced && (
                <>
                  <label>
                    Node type
                    <select value={templateKindForNode(node)} onChange={(event) => replaceNodeFromTemplate(index, event.target.value as MacroNodeTemplateKind)}>
                      {macroNodeTemplates
                        .filter((template) => template.implemented)
                        .map((template) => (
                          <option key={template.kind} value={template.kind}>
                            {template.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Label
                    <textarea className="compactTextarea" value={node.summary} onChange={(event) => updateNode(index, { summary: event.target.value })} />
                  </label>
                </>
              )}
              {renderNodeOptions(node, index)}
              </div>
            </div>
          );
        })}
        <div className="addStepItem">
          <div className="stepNumber">
            <Plus size={16} />
          </div>
          <div className="stepBody addStepBody">
          <label>
            Add next step
            <select value={newNodeKind} onChange={(event) => setNewNodeKind(event.target.value as MacroNodeTemplateKind)}>
              {macroNodeTemplates
                .filter((template) => template.implemented)
                .map((template) => (
                  <option key={template.kind} value={template.kind}>
                    {template.title}
                  </option>
                ))}
            </select>
          </label>
          <button className="primaryButton" onClick={() => addNodeFromTemplate(newNodeKind)}>
            Add Step
          </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function RunProgressBar({
  progress,
  onRevealOutput,
  onOpenLogs
}: {
  progress?: WorkflowRunProgress;
  onRevealOutput: (path: string) => void;
  onOpenLogs: () => void;
}): ReactElement {
  const isBlocked = progress?.status === 'blocked';
  const isFailed = progress?.status === 'failed';
  const isDone = progress?.stage === 'done' && progress.status === 'complete';
  const revealOutputPath = progress?.outputPath && !isClipboardOutputPath(progress.outputPath) ? progress.outputPath : '';

  return (
    <div className={`runProgress ${progress?.status ?? 'idle'}`}>
      <div className="runProgressHeader">
        <div>
          <strong>{progress ? progress.message : 'Ready to run'}</strong>
          <span>{progress ? `Last update ${new Date(progress.updatedAt).toLocaleTimeString()}` : 'Press Run or Save + Run when the flow is ready.'}</span>
        </div>
        <div className="runProgressActions">
          {revealOutputPath && (
            <button className="ghostButton" onClick={() => onRevealOutput(revealOutputPath)}>
              <FileText size={15} />
              Output
            </button>
          )}
          <button className="ghostButton" onClick={onOpenLogs}>
            <ClipboardList size={15} />
            Inspect
          </button>
        </div>
      </div>
      {(isBlocked || isFailed) && (
        <div className="progressIssue">
          <strong>{isFailed ? 'Run failed' : progress?.stage === 'review' ? 'Waiting for review' : 'Run blocked'}</strong>
          <span>{progress?.issues?.length ? progress.issues.join(' ') : progress?.message}</span>
        </div>
      )}
      {isDone && progress?.outputPath && (
        <div className="progressIssue success">
          <strong>{isClipboardOutputPath(progress.outputPath) ? 'Clipboard updated' : 'Output ready'}</strong>
          <span>{isClipboardOutputPath(progress.outputPath) ? 'Structured fields copied after review.' : progress.outputPath}</span>
        </div>
      )}
    </div>
  );
}

function WorkflowStateBar({ workflow }: { workflow: Workflow }): ReactElement {
  const state = workflow.runnerState ?? (workflow.status === 'active' ? 'armed' : 'inactive');
  return (
    <div className={`stateBar state-${state}`}>
      <div>
        <strong>{workflow.name}</strong>
        <span>{workflow.status === 'active' ? 'Listening when armed' : 'Not listening until resumed'}</span>
      </div>
      <StatusPill status={workflow.status} />
      <RunnerPill state={state} />
      <span>{workflow.autoAppend ? 'Auto-run after validation' : 'Review before output'}</span>
      <span>{isVisualTriggerKind(workflow.trigger.kind) ? `Watch every ${workflow.trigger.detectionIntervalSeconds ?? 5}s` : workflow.trigger.hotkey ?? workflow.trigger.kind}</span>
    </div>
  );
}

function AiSetupPage(props: {
  workflow?: Workflow;
  ollama: OllamaStatus | null;
  settings: AppSettings | null;
  onCheck: () => void;
  onSettings: (settings: AppSettings) => void;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  onNotice: (message: string) => void;
  onOllama: (status: OllamaStatus) => void;
  ensurePermission: (capability: PermissionCapability, reason?: string) => Promise<boolean>;
}): ReactElement {
  const ollama = props.ollama;
  const settings = props.settings;
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupResult, setSetupResult] = useState<SetupActionResult | null>(null);
  const requirements = workflowCapabilityRequirements(props.workflow);
  const needsVision = requirements.some((requirement) => requirement.kind === 'local-vision');
  const selectedModel = settings?.ai.preferredModel || ollama?.selectedModel || 'llava:7b';

  async function openSetupUrl(url: string): Promise<void> {
    if (!(await props.ensurePermission('browser-prompt', 'Opening setup help uses your default browser for an explicit link.'))) {
      props.onNotice('Browser prompt was not approved.');
      return;
    }
    await window.maicroFlow.openUrl(url);
  }

  async function pullSelectedModel(): Promise<void> {
    setSetupBusy(true);
    try {
      const result = await window.maicroFlow.pullOllamaModel(selectedModel);
      setSetupResult(result);
      props.onNotice(result.message);
      props.onOllama(await window.maicroFlow.checkOllama());
    } catch (error) {
      props.onNotice(errorMessage(error));
    } finally {
      setSetupBusy(false);
    }
  }

  return (
    <div className="pageGrid two">
      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>Setup Assistant</h2>
            <p>{props.workflow ? `For ${props.workflow.name}` : 'Select a workflow to see what it needs.'}</p>
          </div>
          <button className="ghostButton" onClick={props.onCheck}>
            <RefreshCcw size={16} />
            Check Again
          </button>
        </div>
        <div className="capabilityList">
          {requirements.map((requirement) => (
            <div className="capabilityItem" key={requirement.kind}>
              <Check size={17} />
              <div>
                <strong>{requirement.label}</strong>
                <span>{requirement.reason}</span>
                {requirement.suggestedModel && <small>Suggested: {requirement.suggestedModel}</small>}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>Local AI Readiness</h2>
            <p>One-time local setup for AI-powered nodes.</p>
          </div>
        </div>
        <div className={`statusBox ${ollama?.state ?? 'not_found'}`}>
          <strong>{statusLabel(ollama?.state)}</strong>
          <span>{ollama?.message ?? 'Checking local Ollama status...'}</span>
        </div>
        {needsVision && (
          <div className="setupSteps">
            <div className="setupStep">
              <strong>Install or start Ollama</strong>
              <span>mAIcroFlow uses only your local Ollama endpoint.</span>
              <button className="ghostButton" onClick={() => void openSetupUrl('https://ollama.com/download')}>
                <ExternalLink size={16} />
                Open Download
              </button>
            </div>
            <div className="setupStep">
              <strong>Pull model</strong>
              <span>Pull the selected model if it is not already installed.</span>
              <div className="setupActions">
                <button className="primaryButton" onClick={() => void pullSelectedModel()} disabled={setupBusy || !selectedModel}>
                  <Download size={16} />
                  Pull {selectedModel}
                </button>
              </div>
            </div>
          </div>
        )}
        {setupResult && <p className={setupResult.ok ? 'setupResult ok' : 'setupResult error'}>{setupResult.message}</p>}
        <div className="modelList">
          {(ollama?.models.length ? ollama.models : ['No local models detected']).map((model) => (
            <span key={model}>{model}</span>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>Model Settings</h2>
            <p>Defaults for workflows that call local AI.</p>
          </div>
        </div>
        {settings && (
          <div className="settingsForm">
            <label>
              Endpoint
              <input
                value={settings.ai.endpoint}
                onChange={(event) => props.onSettings({ ...settings, ai: { ...settings.ai, endpoint: event.target.value } })}
              />
            </label>
            <label>
              Preferred model
              <input
                value={settings.ai.preferredModel}
                onChange={(event) => props.onSettings({ ...settings, ai: { ...settings.ai, preferredModel: event.target.value } })}
              />
            </label>
            <button className="primaryButton" onClick={() => void props.onSaveSettings(settings)}>
              <Save size={16} />
              Save AI Settings
            </button>
          </div>
        )}
      </section>
      <section className="panel aiContractPanel">
        <div className="panelHeader">
          <div>
            <h2>Provider Contract</h2>
            <p>For Ollama now, Cuddler and OllamaSaddle later.</p>
          </div>
        </div>
        <div className="contractStack">
          <ContractChip icon={<Braces size={17} />} title="Input" detail="Workflow JSON, node prompts, visible captures, and refs" />
          <ContractChip icon={<BrainCircuit size={17} />} title="Provider" detail="Local model interprets context and returns JSON" />
          <ContractChip icon={<ShieldCheck size={17} />} title="Boundary" detail="No hidden actions, no cloud fallback, no process hooks" />
        </div>
      </section>
    </div>
  );
}

function WorkflowContractCard({ workflow }: { workflow?: Workflow }): ReactElement {
  const nodeCount = workflow?.nodes.length ?? 5;
  const fieldCount = workflow
    ? workflow.nodes
        .filter((node) => node.type === 'extract')
        .flatMap((node) => parseFieldsText(fieldsTextValue(node.config))).length
    : 0;
  const actionKind = workflow?.nodes.find((node) => node.type === 'action')?.config.kind;

  return (
    <div className="contractCard">
      <div className="contractCardHeader">
        <span className="eyebrow">Workflow contract</span>
        <strong>{workflow ? workflow.name : 'Visible pixels in, explicit actions out'}</strong>
      </div>
      <div className="contractMetrics">
        <div>
          <strong>{nodeCount}</strong>
          <span>nodes</span>
        </div>
        <div>
          <strong>{fieldCount || 'JSON'}</strong>
          <span>fields</span>
        </div>
        <div>
          <strong>{workflow?.autoAppend ? 'Auto' : 'Review'}</strong>
          <span>policy</span>
        </div>
      </div>
      <div className="contractFlow">
        <span>Trigger</span>
        <span>Observe</span>
        <span>Think</span>
        <span>Guard</span>
        <span>{typeof actionKind === 'string' ? actionKind.replace('-', ' ') : 'Act'}</span>
      </div>
    </div>
  );
}

function ContractChip({ icon, title, detail }: { icon: ReactElement; title: string; detail: string }): ReactElement {
  return (
    <div className="contractChip">
      {icon}
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function LiveIntentionDraftCard({ workflow }: { workflow: Workflow }): ReactElement {
  const captureNode = workflow.nodes.find((node) => node.type === 'capture');
  const extractNode = workflow.nodes.find((node) => node.type === 'extract');
  const region = regionValue(captureNode?.config.region);
  const fields = parseFieldsText(fieldsTextValue(extractNode?.config ?? {}));

  return (
    <div className="liveDraftCard">
      <div>
        <span className="eyebrow">Live intention capture</span>
        <strong>Selected region: x {region.x}, y {region.y}, {region.width}x{region.height}</strong>
      </div>
      <div className="liveDraftFlow">
        <span>Observe selected pixels</span>
        <span>Infer visible pattern</span>
        <span>Review proposal</span>
        <span>Approve before action</span>
      </div>
      <div className="liveDraftFields">
        {fields.map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>
    </div>
  );
}

function NodeFacts({ node, workflow }: { node: WorkflowNode; workflow: Workflow }): ReactElement {
  const facts = describeNodeFacts(node, workflow);
  return (
    <div className="nodeFacts" aria-label={`${node.title} behavior`}>
      {facts.map((fact) => (
        <div key={fact.label}>
          <strong>{fact.label}</strong>
          <span>{fact.value}</span>
        </div>
      ))}
    </div>
  );
}

function NodeExampleRefs({
  workflowId,
  node,
  refs,
  captureSources,
  onAdd,
  onRemove,
  onCaptured,
  ensurePermission
}: {
  workflowId: string;
  node: WorkflowNode;
  refs: WorkflowExampleImage[];
  captureSources: CaptureDisplaySource[];
  onAdd: (image: WorkflowExampleImage) => void;
  onRemove: (id: string) => void;
  onCaptured?: (request: CaptureRequest) => void;
  ensurePermission: (capability: PermissionCapability, reason?: string) => Promise<boolean>;
}): ReactElement {
  const use = node.type === 'trigger' ? 'trigger-reference' : 'extraction-example';
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureSource, setCaptureSource] = useState('cursor-display');
  const [cropEnabled, setCropEnabled] = useState(false);
  const [region, setRegion] = useState<CaptureRegion>({ x: 0, y: 0, width: 640, height: 360 });
  const [status, setStatus] = useState('');
  const [capturing, setCapturing] = useState(false);
  const isTriggerRef = node.type === 'trigger';

  async function addFromFile(): Promise<void> {
    const image = await window.maicroFlow.importExampleImage(workflowId, node.id, nextRefName(refs), use);
    if (image) {
      onAdd(image);
      setStatus(`${image.refName} attached from file.`);
    }
  }

  async function captureFromScreen(): Promise<void> {
    if (!(await ensurePermission('screen-observation', 'Capturing a reference screenshot observes the selected visible pixels.'))) {
      setStatus('Screen observation was not approved.');
      return;
    }
    setCapturing(true);
    setStatus('Capturing visible pixels...');
    try {
      const request = captureRequest(captureSource, cropEnabled ? region : undefined);
      const image = await window.maicroFlow.captureExampleImage(
        workflowId,
        node.id,
        nextRefName(refs),
        use,
        request
      );
      onAdd(image);
      onCaptured?.(request);
      setCaptureOpen(false);
      setStatus(`${image.refName} attached. Save + Arm when you are ready to listen.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setCapturing(false);
    }
  }

  async function pickReferenceRegion(): Promise<void> {
    if (!(await ensurePermission('screen-region-capture', 'Picking a reference rectangle observes your monitor layout and stores the selected region.'))) {
      setStatus('Region selection was not approved.');
      return;
    }
    setCapturing(true);
    setStatus('Drag a rectangle...');
    try {
      const picked = await window.maicroFlow.pickCaptureRegion();
      if (!picked) {
        setStatus('Region selection canceled.');
        return;
      }
      setCaptureSource(`display-id:${picked.displayId}`);
      setCropEnabled(true);
      setRegion(picked.region);
      setStatus('Region selected. Capture it when the target screen is ready.');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setCapturing(false);
    }
  }

  async function addFromPaste(event: ClipboardEvent<HTMLDivElement>): Promise<void> {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    const dataUrl = await readFileAsDataUrl(file);
    const image = await window.maicroFlow.savePastedExampleImage(dataUrl, workflowId, node.id, nextRefName(refs), use);
    onAdd(image);
    setStatus(`${image.refName} attached from paste.`);
  }

  return (
    <div className={isTriggerRef ? 'nodeRefs triggerRefs' : 'nodeRefs'} tabIndex={0} onPaste={(event) => void addFromPaste(event)}>
      <div className="nodeRefsHeader">
        <span>
          {refs.length
            ? `${refs.length} trigger screenshot${refs.length === 1 ? '' : 's'} attached`
            : isTriggerRef
              ? 'Add the screenshot this trigger should watch for'
              : 'No refs attached'}
        </span>
        <div className="nodeRefsActions">
          <button
            className={isTriggerRef ? 'primaryButton' : undefined}
            type="button"
            onClick={() => setCaptureOpen((value) => !value)}
            title="Capture current screen as a reference"
          >
            <Camera size={14} />
            {isTriggerRef ? 'Add Screenshot' : 'Capture'}
          </button>
          <button type="button" onClick={() => void addFromFile()} title="Add an existing image file">
            <Plus size={14} />
            File
          </button>
        </div>
      </div>
      <p>{node.type === 'trigger' ? 'Add the screen this node should watch for. When armed, mAIcroFlow waits for the screen to change before firing, so setup screenshots are not consumed as real events.' : 'Capture the current visible screen, paste an image, or add a file. Use refs like #ref1 in this node prompt.'}</p>
      {captureOpen && (
        <div className="referenceCapturePanel">
          <div>
            <strong>Capture a reference</strong>
            <span>The app window is capture-excluded where Windows/Electron supports it. Unsupported window capture stays disabled instead of falling back silently.</span>
          </div>
          <label>
            Source
            <select value={captureSource} onChange={(event) => setCaptureSource(event.target.value)}>
              <option value="cursor-display">Display under cursor</option>
              <option value="primary-display">Primary display</option>
              {captureSources.map((source) => (
                <option key={source.id} value={`display-id:${source.id}`}>
                  {source.label}
                </option>
              ))}
              <option value="window-title" disabled>Specific app/window (planned)</option>
            </select>
          </label>
          <label className="toggleLine">
            <input type="checkbox" checked={cropEnabled} onChange={(event) => setCropEnabled(event.target.checked)} />
            Capture rectangle
          </label>
          {cropEnabled && (
            <>
              <button className="ghostButton inlineToolButton" type="button" onClick={() => void pickReferenceRegion()} disabled={capturing}>
                <Crosshair size={14} />
                Pick Region
              </button>
              <div className="settingsForm compact">
                <label>
                  X
                  <input type="number" value={region.x} onChange={(event) => setRegion({ ...region, x: Number(event.target.value) })} />
                </label>
                <label>
                  Y
                  <input type="number" value={region.y} onChange={(event) => setRegion({ ...region, y: Number(event.target.value) })} />
                </label>
                <label>
                  Width
                  <input type="number" min="1" value={region.width} onChange={(event) => setRegion({ ...region, width: Number(event.target.value) })} />
                </label>
                <label>
                  Height
                  <input type="number" min="1" value={region.height} onChange={(event) => setRegion({ ...region, height: Number(event.target.value) })} />
                </label>
              </div>
            </>
          )}
          <div className="capturePanelActions">
            <button className="primaryButton" type="button" onClick={() => void captureFromScreen()} disabled={capturing}>
              <Camera size={14} />
              Capture Reference
            </button>
            <button className="ghostButton" type="button" onClick={() => setCaptureOpen(false)} disabled={capturing}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {status && <p className="refStatus">{status}</p>}
      {refs.length > 0 && (
        <div className="exampleImageList">
          {refs.map((image) => (
            <ExampleImageCard key={image.id} image={image} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExampleImageCard({
  image,
  onRemove
}: {
  image: WorkflowExampleImage;
  onRemove: (id: string) => void;
}): ReactElement {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let canceled = false;
    window.maicroFlow
      .readExampleImageDataUrl(image.path)
      .then((value) => {
        if (!canceled) setDataUrl(value);
      })
      .catch(() => {
        if (!canceled) setDataUrl('');
      });
    return () => {
      canceled = true;
    };
  }, [image.path]);

  return (
    <div className="exampleImageCard">
      {dataUrl ? <img src={dataUrl} alt={image.label} /> : <div className="imagePlaceholder">Preview unavailable</div>}
      <div>
        <strong>{image.refName} - {image.label}</strong>
        <span>{image.use === 'trigger-reference' ? 'Trigger reference' : 'Extraction example'}</span>
        <small>{image.path}</small>
      </div>
      <button title="Remove example" onClick={() => onRemove(image.id)}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function CapturesPage({ logs, onRefresh }: { logs: AppLogEntry[]; onRefresh: () => void }): ReactElement {
  const captureLogs = logs.filter((entry) => entry.scope === 'capture');
  return (
    <div className="pageGrid two">
      <section className="panel">
        <div className="panelHeader">
          <div>
            <h2>Recent Captures</h2>
            <p>Only paths and metadata are logged.</p>
          </div>
          <button className="ghostButton" onClick={onRefresh}>
            <RefreshCcw size={16} />
            Refresh
          </button>
        </div>
        <div className="captureList">
          {captureLogs.length === 0 && <p className="emptyText">No captures yet.</p>}
          {captureLogs.map((entry) => (
            <div className="captureItem" key={`${entry.timestamp}-${entry.details?.path}`}>
              <Camera size={18} />
              <div>
                <strong>{new Date(entry.timestamp).toLocaleString()}</strong>
                <span>{String(entry.details?.path ?? '')}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <RunInspector logs={logs} />
      <section className="panel logsPanel">
        <div className="panelHeader">
          <div>
            <h2>Diagnostics</h2>
            <p>Workflow, capture, extraction, and action events.</p>
          </div>
        </div>
        <LogList logs={logs} />
      </section>
    </div>
  );
}

function RunInspector({ logs }: { logs: AppLogEntry[] }): ReactElement {
  const groups = runEntryGroups(logs);
  const [selectedRunId, setSelectedRunId] = useState('');
  const selectedRun = groups.find((group) => group.runId === selectedRunId) ?? groups[0];
  const extractionEntry = selectedRun ? findRunEntry(selectedRun.entries, 'extractor') : undefined;
  const validationEntry = selectedRun ? findRunEntry(selectedRun.entries, 'validation') : undefined;
  const actionEntry = selectedRun ? findRunEntry(selectedRun.entries, 'action') : undefined;
  const captureEntry = selectedRun ? findRunEntry(selectedRun.entries, 'capture') : undefined;
  const detectionEntry = selectedRun ? findRunEntry(selectedRun.entries, 'detection') : undefined;
  const watchEntry = selectedRun ? findWatchDecisionEntry(selectedRun.entries) : undefined;
  const triggerEntry = selectedRun ? findRunEntry(selectedRun.entries, 'trigger') : undefined;
  const reviewEntry = selectedRun ? findRunEntry(selectedRun.entries, 'workflow') : undefined;
  const warningEntry = selectedRun?.entries.find((entry) => entry.level !== 'info');

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>Run Inspector</h2>
          <p>What triggered, what was seen, what was extracted, and what action happened.</p>
        </div>
      </div>
      {groups.length === 0 && <p className="emptyText">No workflow run has been recorded yet.</p>}
      {groups.length > 0 && (
        <div className="runTimeline">
          {groups.slice(0, 8).map((group) => (
            <button
              key={group.runId}
              className={selectedRun?.runId === group.runId ? 'selected' : ''}
              onClick={() => setSelectedRunId(group.runId)}
            >
              <strong>{new Date(group.entries[0].timestamp).toLocaleTimeString()}</strong>
              <span>{groupStatusLabel(group.entries)}</span>
            </button>
          ))}
        </div>
      )}
      {selectedRun && (
        <div className="runInspector">
          <div className="runInspectorHeader">
            <strong>{selectedRun.runId}</strong>
            <span>{new Date(selectedRun.entries[0].timestamp).toLocaleString()}</span>
          </div>
          <InspectorRow label="Timestamp" detail={new Date(selectedRun.entries[0].timestamp).toLocaleString()} fallback="No timestamp" />
          <InspectorRow label="Trigger source" entry={triggerEntry} detail={formatTrigger(triggerEntry)} fallback="No trigger logged yet" />
          <InspectorRow label="Watch decision" entry={detectionEntry ?? watchEntry} detail={formatWatchDecision(detectionEntry, watchEntry)} fallback="No watch decision logged yet" />
          <InspectorRow label="Captured image/region" entry={captureEntry} detail={formatCapture(captureEntry)} fallback="No capture logged yet" />
          <InspectorRow label="Matched references" entry={detectionEntry} detail={formatDetection(detectionEntry)} fallback="Not a watch-mode run or no match logged" />
          <InspectorRow label="Extracted fields" entry={extractionEntry} detail={formatExtractionFields(extractionEntry)} fallback="No extraction logged yet" />
          <InspectorRow label="Validation result" entry={validationEntry} detail={formatValidation(validationEntry)} fallback="No validation logged yet" />
          <InspectorRow label="Output action" entry={actionEntry} detail={formatAction(actionEntry)} fallback="No output action logged yet" />
          <InspectorRow label="Review required" entry={reviewEntry} detail={formatReview(reviewEntry)} fallback="No review step logged yet" />
          <InspectorRow label="Errors/warnings" entry={warningEntry} fallback="No errors or warnings on this run" />
        </div>
      )}
    </section>
  );
}

function InspectorRow({ label, entry, detail, fallback }: { label: string; entry?: AppLogEntry; detail?: string; fallback: string }): ReactElement {
  return (
    <div className={`inspectorRow ${entry?.level ?? 'info'}`}>
      <strong>{label}</strong>
      <span>{detail || (entry ? inspectorMessage(entry) : fallback)}</span>
    </div>
  );
}

function SettingsPage({ settings, onSave }: { settings: AppSettings | null; onSave: (settings: AppSettings) => Promise<void> }): ReactElement {
  if (!settings) return <p className="emptyText">Loading settings...</p>;
  const approvals = settings.safety.capabilityApprovals ?? {};
  const resetApproval = (capability: PermissionCapability): void => {
    const nextApprovals = { ...approvals };
    delete nextApprovals[capability];
    void onSave({
      ...settings,
      safety: {
        ...settings.safety,
        capabilityApprovals: nextApprovals
      }
    });
  };

  return (
    <section className="panel settingsOnly">
      <div className="panelHeader">
        <div>
          <h2>Safety & Defaults</h2>
          <p>Local-first controls for future expansion.</p>
        </div>
      </div>
      <div className="settingsForm">
        <label>
          Default capture mode
          <select
            value={settings.capture.defaultMode}
            onChange={(event) => onSave({ ...settings, capture: { defaultMode: event.target.value as AppSettings['capture']['defaultMode'] } })}
          >
            <option value="full-screen">Full screen</option>
            <option value="active-window" disabled>Active window (planned)</option>
            <option value="region" disabled>Region rectangle (set per workflow)</option>
          </select>
        </label>
        <label className="toggleLine">
          <input
            type="checkbox"
            checked={settings.safety.requireScriptConfirmation}
            onChange={(event) => onSave({ ...settings, safety: { ...settings.safety, requireScriptConfirmation: event.target.checked } })}
          />
          Require confirmation before local scripts
        </label>
        <label className="toggleLine disabled">
          <input type="checkbox" checked={settings.safety.autoTrustWorkflowSaving} disabled />
          Save and trust workflow later (disabled for v0)
        </label>
        <div className="permissionSettings">
          <strong>Capability approvals</strong>
          {Object.entries(permissionText).map(([capability, copy]) => {
            const typedCapability = capability as PermissionCapability;
            const approved = approvals[typedCapability] === 'always';
            return (
              <div className="permissionSettingRow" key={capability}>
                <div>
                  <span>{copy.title.replace(/\?$/, '')}</span>
                  <small>{copy.future ? 'Future permission shape. Execution unavailable.' : copy.body}</small>
                </div>
                {approved ? (
                  <button className="ghostButton" type="button" onClick={() => resetApproval(typedCapability)}>
                    Revoke
                  </button>
                ) : (
                  <span className="permissionState">Ask each time</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PermissionModal({ request, onResolve }: { request: PermissionRequest; onResolve: (choice: PermissionChoice) => void }): ReactElement {
  const copy = permissionText[request.capability];
  return (
    <div className="modalBackdrop">
      <div className="modal permissionModal">
        <div className="modalHeader">
          <div>
            <h2>Permission Required</h2>
            <p>{request.capability}</p>
          </div>
          <button onClick={() => onResolve('deny')} title="Deny">
            <X size={18} />
          </button>
        </div>
        <div className="permissionBody">
          <ShieldCheck size={22} />
          <div>
            <strong>{copy.title}</strong>
            <span>{request.reason ?? copy.body}</span>
            {request.reason && <small>{copy.body}</small>}
            {copy.future && <small>This capability is not executable in this build.</small>}
          </div>
        </div>
        <div className="modalActions permissionActions">
          <button className="ghostButton" onClick={() => onResolve('deny')}>
            Deny
          </button>
          <button className="ghostButton" onClick={() => onResolve('once')}>
            Approve Once
          </button>
          <button className="ghostButton" onClick={() => onResolve('session')}>
            This Session
          </button>
          <button className="primaryButton" onClick={() => onResolve('always')}>
            Do Not Ask Again
          </button>
        </div>
      </div>
    </div>
  );
}

function LiveProposalReview({
  fields,
  diff,
  onChange,
  onApply
}: {
  fields: Record<string, StructuredFieldValue>;
  diff: LiveIntentionDraftChange[];
  onChange: (field: string, value: string) => void;
  onApply: () => void;
}): ReactElement {
  return (
    <div className="liveProposalReview">
      <div className="proposalNotice">
        <ShieldCheck size={18} />
        <div>
          <strong>AI interpretation, not an action</strong>
          <span>Edit this proposal before approving. mAIcroFlow will not click, type, or run the suggested action from this review.</span>
        </div>
      </div>
      <div className="proposalGrid">
        {liveIntentionFields.map((field) => (
          <label key={field} className={field === 'suggested_action' ? 'proposalActionField' : undefined}>
            {liveIntentionFieldLabels[field]}
            <span>{liveIntentionFieldDescriptions[field]}</span>
            <textarea
              className="compactTextarea"
              value={String(fields[field] ?? '')}
              onChange={(event) => onChange(field, event.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="proposalApplyBox">
        <div>
          <strong>Apply to editable draft</strong>
          <span>Updates workflow summaries and prompts from this proposal, keeps the flow paused, and does not execute the suggested action.</span>
        </div>
        <button className="ghostButton" type="button" onClick={onApply}>
          Apply to Draft
        </button>
      </div>
      <div className="proposalDiff">
        <strong>Draft changes before applying</strong>
        {diff.length === 0 ? (
          <span>No workflow node changes detected.</span>
        ) : (
          diff.map((item) => (
            <div className="proposalDiffNode" key={item.nodeId}>
              <div>
                <span className="nodeBadge">{item.nodeType}</span>
                <strong>{item.nodeTitle}</strong>
              </div>
              {item.changes.map((change) => (
                <div className="proposalDiffChange" key={`${item.nodeId}-${change.label}`}>
                  <span>{change.label}</span>
                  <del>{change.before || 'blank'}</del>
                  <ins>{change.after || 'blank'}</ins>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ConfirmationModal(props: {
  preview: WorkflowRunPreview;
  extraction: ExtractionResult;
  setExtraction: (value: ExtractionResult) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onApplyProposal: () => void;
  workflow?: Workflow;
  busy: boolean;
}): ReactElement {
  const structuredFields = props.extraction.fields ?? props.preview.structuredExtraction?.fields ?? legacyFieldsFromExtraction(props.extraction);
  const fieldEntries = Object.entries(structuredFields);
  const [captureDataUrl, setCaptureDataUrl] = useState('');
  const isClipboardOutput = isClipboardOutputPath(props.preview.outputPath);
  const isLiveProposal = hasLiveIntentionFields(structuredFields);
  const liveProposal = isLiveProposal ? liveIntentionProposalFromFields(structuredFields) : undefined;
  const proposalDiff = isLiveProposal && props.workflow && liveProposal ? liveIntentionDraftDiff(props.workflow, liveProposal) : [];
  const genericFieldEntries = isLiveProposal
    ? fieldEntries.filter(([field]) => !liveIntentionFields.includes(field as (typeof liveIntentionFields)[number]))
    : fieldEntries;
  const updateField = (field: string, value: string): void => {
    props.setExtraction({
      ...props.extraction,
      fields: {
        ...structuredFields,
        [field]: value
      },
      rawFields: {
        ...(props.extraction.rawFields ?? {}),
        [field]: value
      }
    });
  };

  useEffect(() => {
    let canceled = false;
    setCaptureDataUrl('');
    if (props.preview.screenshotPath === 'deleted_after_extraction') {
      return () => {
        canceled = true;
      };
    }
    window.maicroFlow
      .readCaptureDataUrl(props.preview.screenshotPath)
      .then((dataUrl) => {
        if (!canceled) {
          setCaptureDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!canceled) {
          setCaptureDataUrl('');
        }
      });
    return () => {
      canceled = true;
    };
  }, [props.preview.screenshotPath]);

  return (
    <div className="modalBackdrop">
      <div className="modal">
        <div className="modalHeader">
          <div>
            <h2>{isLiveProposal ? 'Review Proposed Workflow' : 'Review Macro Output'}</h2>
            <p>{isLiveProposal ? `${props.preview.workflowName} - proposed only` : props.preview.workflowName}</p>
          </div>
          <button onClick={props.onCancel} title="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modalBody">
          <div className="screenshotPreview">
            {captureDataUrl ? <img src={captureDataUrl} alt="Latest capture" /> : <div className="imagePlaceholder">Capture discarded after extraction</div>}
            <span>{props.preview.screenshotPath}</span>
            <strong>{isClipboardOutput ? 'Action' : 'Output'}</strong>
            <span>{isClipboardOutput ? 'Copy to system clipboard' : props.preview.outputPath}</span>
          </div>
          <div className="editGrid">
            {isLiveProposal && (
              <LiveProposalReview
                fields={structuredFields}
                diff={proposalDiff}
                onChange={updateField}
                onApply={props.onApplyProposal}
              />
            )}
            {genericFieldEntries.map(([field, value]) => (
              <label key={field}>
                {labelFor(field)}
                <input value={String(value ?? '')} onChange={(event) => updateField(field, event.target.value)} />
              </label>
            ))}
            <label>
              Notes
              <textarea
                value={props.extraction.notes}
                onChange={(event) => props.setExtraction({ ...props.extraction, notes: event.target.value })}
              />
            </label>
            <label>
              Confidence
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={props.extraction.confidence}
                onChange={(event) => props.setExtraction({ ...props.extraction, confidence: Number(event.target.value) })}
              />
            </label>
          </div>
        </div>
        <div className="modalActions">
          <button className="ghostButton" disabled>
            <SlidersHorizontal size={16} />
            Save and Trust Later
          </button>
          <button className="ghostButton" onClick={props.onCancel}>
            <X size={16} />
            Cancel
          </button>
          <button className="primaryButton" onClick={props.onConfirm} disabled={props.busy}>
            <Check size={16} />
            {isLiveProposal ? 'Approve Proposal' : isClipboardOutput ? 'Copy' : 'Save Row'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogList({ logs }: { logs: AppLogEntry[] }): ReactElement {
  return (
    <div className="logList">
      {logs.length === 0 && <p className="emptyText">No log entries yet.</p>}
      {logs.map((entry) => (
        <div className={`logEntry ${entry.level}`} key={`${entry.timestamp}-${entry.scope}-${entry.message}`}>
          <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
          <strong>{entry.scope}</strong>
          <p>{entry.message}</p>
        </div>
      ))}
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: ReactElement; label: string; active: boolean; onClick: () => void }): ReactElement {
  return (
    <button className={active ? 'active' : ''} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function StatusPill({ status }: { status: Workflow['status'] }): ReactElement {
  return <span className={`statusPill ${status}`}>{status}</span>;
}

function RunnerPill({ state }: { state: NonNullable<Workflow['runnerState']> }): ReactElement {
  return <span className={`runnerPill ${state}`}>{state}</span>;
}

function tabTitle(tab: Tab): string {
  return {
    workflows: 'Workflows',
    ai: 'AI Setup',
    captures: 'Captures & Logs',
    settings: 'Settings'
  }[tab];
}

function statusLabel(state?: OllamaStatus['state']): string {
  return {
    not_found: 'Not found',
    installed_not_running: 'Installed but not running',
    running: 'Running',
    model_available: 'Model available'
  }[state ?? 'not_found'];
}

function legacyFieldsFromExtraction(extraction: ExtractionResult): Record<string, StructuredFieldValue> {
  const entries = [
    ['fish_name', extraction.fish_name],
    ['exp_gained', extraction.exp_gained],
    ['weight', extraction.weight],
    ['class_tier', extraction.class_tier],
    ['bait_used', extraction.bait_used]
  ].filter(([, value]) => String(value ?? '').trim());
  return Object.fromEntries(entries);
}

function labelFor(field: string): string {
  return field.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function fieldsTextValue(config: Record<string, unknown>): string {
  const text = stringValue(config.fieldsText);
  if (text !== '') {
    return text;
  }
  return arrayValue(config.fields).join(', ');
}

function parseFieldsText(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function commaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stepKindLabel(node: WorkflowNode): string {
  if (node.type === 'trigger') return 'When';
  if (node.type === 'capture') return 'Capture';
  if (node.type === 'extract') return 'Read';
  if (node.type === 'validate') return 'Check';
  if (node.type === 'review') return 'Review';
  return 'Write';
}

function templateKindForNode(node: WorkflowNode): MacroNodeTemplateKind {
  if (node.type === 'trigger') {
    return stringValue(node.config.kind) === 'hotkey' ? 'hotkey-trigger' : 'watch-screen';
  }
  if (node.type === 'capture') return 'screen-grab';
  if (node.type === 'extract') return 'ai-extract';
  if (node.type === 'validate') return 'validate-fields';
  if (node.type === 'review') return 'review-if-needed';
  if (stringValue(node.config.kind) === 'xlsx') return 'append-xlsx';
  if (stringValue(node.config.kind) === 'clipboard') return 'copy-clipboard';
  return 'append-csv';
}

function workflowPatchForTemplate(kind: MacroNodeTemplateKind, workflow: Workflow): Partial<Workflow> {
  if (kind === 'hotkey-trigger') {
    return {
      trigger: {
        ...workflow.trigger,
        kind: 'hotkey',
        hotkey: workflow.trigger.hotkey || 'F12',
        summary: `${workflow.trigger.hotkey || 'F12'} hotkey`,
        experimental: false
      }
    };
  }

  if (kind === 'watch-screen') {
    return {
      trigger: {
        ...workflow.trigger,
        kind: 'screen-detection',
        summary: visualTriggerSummary('screen-detection', workflow.trigger.detectionIntervalSeconds ?? 5),
        detectionIntervalSeconds: workflow.trigger.detectionIntervalSeconds ?? 5,
        detectionCooldownSeconds: workflow.trigger.detectionCooldownSeconds ?? 10,
        duplicateDetectionEnabled: workflow.trigger.duplicateDetectionEnabled ?? true,
        experimental: true
      }
    };
  }

  if (kind === 'copy-clipboard') {
    return {
      autoAppend: false
    };
  }

  return {};
}

function previewOutputPath(node: WorkflowNode): string {
  const kind = stringValue(node.config.kind) || 'append-csv';
  if (kind === 'clipboard') {
    return 'System clipboard after review';
  }
  const fileName = stringValue(node.config.fileName) || defaultActionFileName(kind, 'workflow_output');
  const outputDirectory = stringValue(node.config.outputDirectory);
  return outputDirectory ? `${outputDirectory}\\${fileName}` : `Documents\\mAIcroFlow\\output\\${fileName}`;
}

function actionPromptForKind(kind: string): string {
  if (kind === 'xlsx') {
    return 'Add the extracted fields as a new row in the Excel workbook.';
  }
  if (kind === 'clipboard') {
    return 'Copy the extracted fields to the clipboard.';
  }
  return 'Add the extracted fields as a new row in the CSV file.';
}

function actionProducesLabel(kind: string): string {
  if (kind === 'xlsx') {
    return 'A local XLSX row and summary block';
  }
  if (kind === 'clipboard') {
    return 'Reviewed structured fields copied to the system clipboard';
  }
  return 'A local CSV row and summary block';
}

function defaultActionFileName(kind: string, stem: string): string {
  return kind === 'xlsx' ? `${stem}.xlsx` : `${stem}.csv`;
}

function isFileOutputAction(kind: string): boolean {
  return kind === 'append-csv' || kind === 'xlsx';
}

function isClipboardOutputPath(path?: string): boolean {
  return path === 'clipboard';
}

function isLiveIntentionWorkflow(workflow: Workflow): boolean {
  return workflow.id.startsWith('live-workflow-') || workflow.summaryInstructions?.toLowerCase().includes('live intention') === true;
}

function captureSourceSelectValue(config: Record<string, unknown>): string {
  const source = stringValue(config.source);
  const displayId = stringValue(config.displayId);
  if (source === 'display-id' && displayId) {
    return `display-id:${displayId}`;
  }
  return source || 'cursor-display';
}

function regionValue(value: unknown): { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { x: 0, y: 0, width: 640, height: 360 };
  }
  const region = value as Record<string, unknown>;
  return {
    x: numberValue(region.x, 0),
    y: numberValue(region.y, 0),
    width: numberValue(region.width, 640),
    height: numberValue(region.height, 360)
  };
}

function captureRequest(sourceValue: string, region?: CaptureRegion): CaptureRequest {
  if (sourceValue.startsWith('display-id:')) {
    return {
      source: 'display-id',
      displayId: sourceValue.replace('display-id:', ''),
      region
    };
  }
  return {
    source: sourceValue === 'primary-display' ? 'primary-display' : 'cursor-display',
    region
  };
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function visualTriggerSummary(kind: Workflow['trigger']['kind'], intervalSeconds: number): string {
  if (kind === 'reference-image') {
    return `Watch for reference image every ${intervalSeconds}s`;
  }
  if (kind === 'region-visible') {
    return `Watch for visible region every ${intervalSeconds}s`;
  }
  return `Watch for matching screen every ${intervalSeconds}s`;
}

function describeNodeFacts(node: WorkflowNode, workflow: Workflow): Array<{ label: string; value: string }> {
  const config = node.config;
  if (node.type === 'trigger') {
    return [
      { label: 'Watches', value: isVisualTriggerKind(workflow.trigger.kind) ? 'Visible samples and node reference images' : workflow.trigger.hotkey ?? 'Configured hotkey' },
      { label: 'Produces', value: 'A workflow run request' },
      { label: 'On failure', value: 'Log and stay armed; no output action runs' },
      { label: 'Auto-run', value: workflow.autoAppend ? 'Enabled after validation' : 'Stops for review' }
    ];
  }
  if (node.type === 'capture') {
    return [
      { label: 'Uses', value: captureSourceSelectValue(config) },
      { label: 'Produces', value: config.mode === 'region' ? 'A temporary rectangle screenshot' : 'A temporary screenshot' },
      { label: 'On failure', value: 'Run fails closed and writes no output' },
      { label: 'Auto-run', value: 'Allowed only as part of an armed workflow' }
    ];
  }
  if (node.type === 'extract') {
    return [
      { label: 'Uses', value: 'Temporary capture plus local Ollama prompt and refs' },
      { label: 'Produces', value: `Structured fields: ${arrayValue(config.fields).join(', ') || 'configured fields'}` },
      { label: 'On failure', value: 'Fallback result is flagged for review' },
      { label: 'Auto-run', value: 'Only if validation passes and workflow auto-run is on' }
    ];
  }
  if (node.type === 'validate') {
    return [
      { label: 'Uses', value: 'Extracted structured fields' },
      { label: 'Produces', value: 'Pass/fail issues and normalized values' },
      { label: 'On failure', value: 'Marks needs review and blocks output' },
      { label: 'Auto-run', value: 'No output until validation passes' }
    ];
  }
  if (node.type === 'review') {
    return [
      { label: 'Uses', value: 'Validation state and safety policy' },
      { label: 'Produces', value: 'A human-edited approval when needed' },
      { label: 'On failure', value: 'Workflow re-arms after cancel or save' },
      { label: 'Auto-run', value: workflow.autoAppend ? 'Skipped unless needed' : 'Required' }
    ];
  }
  return [
    { label: 'Uses', value: 'Validated workflow values' },
    { label: 'Produces', value: actionProducesLabel(stringValue(config.kind)) },
    { label: 'On failure', value: 'Logs error and marks workflow failed' },
    { label: 'Auto-run', value: workflow.autoAppend ? 'Allowed for file output' : 'Requires review first' }
  ];
}

function exampleImagesFromNode(node: WorkflowNode): WorkflowExampleImage[] {
  const value = node.config.exampleRefs;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isWorkflowExampleImage);
}

function isWorkflowExampleImage(value: unknown): value is WorkflowExampleImage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<WorkflowExampleImage>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.refName === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.addedAt === 'string' &&
    (candidate.use === 'trigger-reference' || candidate.use === 'extraction-example')
  );
}

function nextRefName(refs: WorkflowExampleImage[]): string {
  const used = new Set(refs.map((ref) => ref.refName));
  let index = 1;
  while (used.has(`#ref${index}`)) {
    index += 1;
  }
  return `#ref${index}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read pasted image.'));
    reader.readAsDataURL(file);
  });
}

function runEntryGroups(logs: AppLogEntry[]): Array<{ runId: string; entries: AppLogEntry[] }> {
  const groups = new Map<string, AppLogEntry[]>();
  for (const entry of logs) {
    const runId = entry.details?.run_id;
    if (typeof runId !== 'string') continue;
    groups.set(runId, [...(groups.get(runId) ?? []), entry]);
  }
  return Array.from(groups.entries())
    .map(([runId, entries]) => ({ runId, entries }))
    .sort((left, right) => right.entries[0].timestamp.localeCompare(left.entries[0].timestamp));
}

function findRunEntry(entries: AppLogEntry[], scope: string): AppLogEntry | undefined {
  return [...entries].reverse().find((entry) => entry.scope === scope);
}

function findWatchDecisionEntry(entries: AppLogEntry[]): AppLogEntry | undefined {
  const decisionMessages = new Set([
    'baseline_recorded',
    'baseline_unchanged',
    'duplicate_sample_skipped',
    'detection_no_match_deleted',
    'matched_sample_used_for_run',
    'sample_delete_failed'
  ]);
  return [...entries].reverse().find((entry) => entry.scope === 'watch' && decisionMessages.has(entry.message));
}

function inspectorMessage(entry: AppLogEntry): string {
  const parts = [entry.message];
  const details = entry.details ?? {};
  if (typeof details.path === 'string') {
    parts.push(details.path);
  }
  if (typeof details.outputPath === 'string') {
    parts.push(details.outputPath);
  }
  if (Array.isArray(details.issues) && details.issues.length > 0) {
    parts.push(details.issues.map(String).join('; '));
  }
  return parts.join(' - ');
}

function groupStatusLabel(entries: AppLogEntry[]): string {
  if (entries.some((entry) => entry.level === 'error')) return 'failed';
  if (entries.some((entry) => entry.scope === 'workflow' && entry.message.toLowerCase().includes('review'))) return 'needs review';
  if (entries.some((entry) => entry.scope === 'action' && actionEntryCompleted(entry))) return 'completed';
  if (entries.some((entry) => entry.scope === 'validation' && entry.level === 'warn')) return 'validation warning';
  return 'running';
}

function actionEntryCompleted(entry: AppLogEntry): boolean {
  const message = entry.message.toLowerCase();
  return message.includes('success') || message.includes('copied');
}

function formatTrigger(entry?: AppLogEntry): string {
  if (!entry) return '';
  return `${entry.message}${typeof entry.details?.workflowId === 'string' ? ` for ${entry.details.workflowId}` : ''}`;
}

function formatCapture(entry?: AppLogEntry): string {
  if (!entry) return '';
  const details = entry.details ?? {};
  const mode = typeof details.mode === 'string' ? details.mode : 'capture';
  const source = typeof details.sourceName === 'string' ? details.sourceName : 'visible display';
  const sourceKind = typeof details.sourceKind === 'string' ? ` (${details.sourceKind})` : '';
  const region = formatRegion(details.region);
  return `${entry.message}: ${mode} from ${source}${sourceKind}${region ? `, ${region}` : ''}. Capture is temporary and deleted after extraction.`;
}

function formatDetection(entry?: AppLogEntry): string {
  if (!entry) return '';
  const details = entry.details ?? {};
  const confidence = typeof details.confidence === 'number' ? ` - confidence ${Math.round(details.confidence * 100)}%` : '';
  const refs = Array.isArray(details.matchedReferences) && details.matchedReferences.length > 0
    ? ` - refs ${details.matchedReferences.map(String).join(', ')}`
    : '';
  const loadedRefs = Array.isArray(details.loadedReferences) && details.loadedReferences.length > 0
    ? ` - loaded ${details.loadedReferences.length}/${Array.isArray(details.configuredReferences) ? details.configuredReferences.length : details.loadedReferences.length} refs`
    : '';
  const missingRefs = Array.isArray(details.missingReferences) && details.missingReferences.length > 0
    ? ` - missing ${details.missingReferences.map(String).join(', ')}`
    : '';
  const unsupportedRefs = Array.isArray(details.unsupportedReferences) && details.unsupportedReferences.length > 0
    ? ` - unsupported ${details.unsupportedReferences.length} refs`
    : '';
  const scores = Array.isArray(details.referenceScores) && details.referenceScores.length > 0
    ? ` - scores ${formatReferenceScores(details.referenceScores)}`
    : '';
  const sample =
    typeof details.sampleWidth === 'number' && typeof details.sampleHeight === 'number'
      ? ` - ${details.sampleWidth}x${details.sampleHeight}${typeof details.sampleMode === 'string' ? ` ${details.sampleMode}` : ''}`
      : '';
  const region = formatRegion(details.region);
  const reason = typeof details.reason === 'string' ? ` - ${details.reason}` : '';
  const hash = typeof entry.details?.hash === 'string' ? ` - sample ${entry.details.hash.slice(0, 8)}` : '';
  return `${entry.message}${confidence}${refs}${loadedRefs}${missingRefs}${unsupportedRefs}${scores}${sample}${region ? ` - ${region}` : ''}${reason}${hash}`;
}

function formatWatchDecision(detectionEntry?: AppLogEntry, watchEntry?: AppLogEntry): string {
  if (detectionEntry) {
    return formatDetection(detectionEntry);
  }
  if (!watchEntry) {
    return '';
  }
  const details = watchEntry.details ?? {};
  const reason = typeof details.reason === 'string' ? ` - ${details.reason}` : '';
  const hash = typeof details.hash === 'string' ? ` - sample ${details.hash.slice(0, 8)}` : '';
  const path = typeof details.path === 'string' ? ` - ${details.path}` : '';
  return `${watchEntry.message}${reason}${hash}${path}`;
}

function formatReferenceScores(values: unknown[]): string {
  const scores = values
    .slice(0, 3)
    .map((value) => {
      const score = valueRecord(value);
      if (!score) return '';
      const name = typeof score.refName === 'string' ? score.refName : 'reference';
      const similarity = typeof score.similarity === 'number' ? `${Math.round(score.similarity * 100)}%` : 'unknown';
      return `${name} ${similarity}`;
    })
    .filter(Boolean);
  return scores.length ? scores.join(', ') : 'unknown';
}

function formatExtractionFields(entry?: AppLogEntry): string {
  if (!entry) return '';
  const observation = valueRecord(entry.details?.observation);
  const fields = valueRecord(observation?.fields);
  if (!fields || Object.keys(fields).length === 0) {
    return inspectorMessage(entry);
  }
  const summary = Object.entries(fields).map(([key, value]) => {
    const field = valueRecord(value);
    const raw = field?.value ?? field?.normalized ?? '';
    return `${key}: ${raw === null || raw === '' ? 'blank' : String(raw)}`;
  });
  const confidence = typeof observation?.confidence === 'number' ? ` confidence ${Math.round(observation.confidence * 100)}%` : '';
  return `${summary.join(', ')}${confidence}`;
}

function formatValidation(entry?: AppLogEntry): string {
  if (!entry) return '';
  const issues = Array.isArray(entry.details?.issues) ? entry.details.issues.map(String).filter(Boolean) : [];
  return issues.length ? `${entry.message}: ${issues.join('; ')}` : entry.message;
}

function formatAction(entry?: AppLogEntry): string {
  if (!entry) return '';
  const output = typeof entry.details?.outputPath === 'string' && !isClipboardOutputPath(entry.details.outputPath) ? ` - ${entry.details.outputPath}` : '';
  return `${entry.message}${output}`;
}

function formatReview(entry?: AppLogEntry): string {
  if (!entry) return '';
  if (entry.message.toLowerCase().includes('review')) {
    return entry.message;
  }
  return 'No review was required for this step.';
}

function valueRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function formatRegion(value: unknown): string {
  const region = valueRecord(value);
  if (!region) return '';
  const x = Number(region.x);
  const y = Number(region.y);
  const width = Number(region.width);
  const height = Number(region.height);
  if (![x, y, width, height].every(Number.isFinite)) {
    return '';
  }
  return `region x:${x} y:${y} w:${width} h:${height}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
