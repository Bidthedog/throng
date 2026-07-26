import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The `@lezer/*` packages that are the parser RUNTIME rather than a language: the LR engine, the
 * syntax-tree model and the highlight tags. Every grammar depends on them, so they stay in one
 * shared chunk; everything else under `@lezer/` is a language's parse tables and rides with it.
 */
const SHARED_LEZER = new Set(['common', 'lr', 'highlight']);

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
          // One chunk per language grammar (016, FR-008). The grammars are imported
          // lazily by id, so a document only ever pays for the language it is in —
          // but only if each stays a separately-fetchable chunk. Folded into
          // `vendor` they would all load with the app and blow the 200 ms budget.
          const grammar = /\/node_modules\/@codemirror\/(lang-[a-z]+)\//.exec(id);
          if (grammar) return `grammar-${grammar[1]}`;
          if (id.includes('@codemirror/legacy-modes')) return 'grammar-legacy';
          /*
           * A LANGUAGE'S PARSER BELONGS WITH ITS LANGUAGE.
           *
           * `@codemirror/lang-x` is a thin wrapper; the actual parse tables live in `@lezer/x`, and
           * they are the bulk of a grammar by an order of magnitude (the `lang-python` wrapper is
           * 7 kB, `@lezer/python` is 160 kB of source). Sweeping every `@lezer/*` into one chunk
           * therefore put FOURTEEN parsers — cpp, markdown, php, javascript, rust, java, python,
           * sass, html, go, yaml, css, xml, json — into a single 624 kB bundle, which the shared
           * runtime below pulls in EAGERLY. So the split above was cosmetic: the wrappers were
           * lazy, and every parser behind them loaded at startup anyway, which is precisely what
           * the comment above says must not happen.
           *
           * Routed to the SAME chunk name as its wrapper, so a language is one file. Parsers shared
           * between languages (html and javascript are used by php and vue too) land in the chunk
           * of the language they are named for, and the others import it — one copy, fetched by
           * whichever arrives first.
           */
          const lezerLang = /\/node_modules\/@lezer\/([a-z0-9-]+)\//.exec(id);
          if (lezerLang && !SHARED_LEZER.has(lezerLang[1])) return `grammar-lang-${lezerLang[1]}`;
          // The shared parser RUNTIME — the LR engine, the tree model, the highlight tags. Small,
          // and genuinely needed before any document is open, so this one is eager by design.
          if (id.includes('@lezer/')) return 'lezer';
          return 'vendor'; // react-arborist (+ its react-dnd deps), inversify, …
        },
      },
    },
  },
});
