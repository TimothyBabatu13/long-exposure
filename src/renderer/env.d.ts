import type { StudioBridge } from '../shared/types';

declare global {
  interface Window {
    /** Present only inside the Electron app. Absent in the web build. */
    studio?: StudioBridge;
  }
  const __WEB_BUILD__: boolean;
}

export {};
