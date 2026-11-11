// Static web build of the studio for judges without an API key or the app.
// No SDK, no camera: it runs the labelled synthetic sitting and plays back
// recorded sessions. Deployable to GitHub Pages.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  define: { __WEB_BUILD__: 'true' },
  build: { outDir: '../../dist-web', emptyOutDir: true },
});
