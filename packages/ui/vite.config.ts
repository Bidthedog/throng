import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer build pipeline (research D2). The renderer is a React 18 app bundled
// by Vite; main and preload stay on `tsc`. Output goes to `dist/renderer` so the
// Electron main process can `loadFile` it. `base: './'` keeps asset URLs relative
// for `file://` loading inside Electron.
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  plugins: [react()],
  // Force a single React/ReactDOM instance regardless of how npm hoists the
  // workspace tree. Without this, a stale nested `react` in a package's
  // node_modules bundles a second React copy, leaving hook consumers (e.g.
  // @dnd-kit) with a null dispatcher — "Cannot read properties of null
  // (reading 'useMemo')" at render.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the heavy third-party libs into their own chunks so the app chunk
        // stays small (and each vendor is cached independently). This also clears
        // Vite's 500 kB single-chunk warning. Route by module path (not package
        // name) so shared deps land in exactly one chunk — no empty chunks.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@xterm')) return 'xterm';
          if (/\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('@dnd-kit')) return 'dnd';
          return 'vendor'; // react-arborist (+ its react-dnd deps), inversify, …
        },
      },
    },
  },
});
