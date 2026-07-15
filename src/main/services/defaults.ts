import type { AppSettings } from '../../shared/types';

export const defaultSettings: AppSettings = {
  ai: {
    provider: 'ollama',
    endpoint: 'http://localhost:11434',
    preferredModel: 'llava:7b'
  },
  capture: {
    defaultMode: 'full-screen'
  },
  safety: {
    requireScriptConfirmation: true,
    autoTrustWorkflowSaving: false,
    capabilityApprovals: {}
  }
};
