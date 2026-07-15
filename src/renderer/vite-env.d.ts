/// <reference types="vite/client" />

import type { MaicroFlowApi } from '../preload/preload';

declare global {
  interface Window {
    maicroFlow: MaicroFlowApi;
  }
}
