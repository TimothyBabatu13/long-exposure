import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      // The SDK loads a native runtime through koffi, so it must stay external.
      externalizeDeps: true,
      rolldownOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads cannot require() from node_modules: bundle everything
      // (including @smartspectra/node-sdk/preload) into one CommonJS file.
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: resolve('src/preload/index.ts') },
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    define: { __WEB_BUILD__: 'false' },
    build: {
      rolldownOptions: { input: { index: resolve('src/renderer/index.html'), harness: resolve('src/renderer/harness.html') } },
    },
  },
});
