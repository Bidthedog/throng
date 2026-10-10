import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite's "Some chunks are larger than 500 kB" is only a WARNING, so it scrolled past on every build
 * while the app chunk grew through it (047 took it to 525 kB). This makes the same condition, at
 * Vite's own `chunkSizeWarningLimit`, fail the build — and so the gate's build stage and every PR.
 * The fix is a chunk rule in `chunkFor` below, never a raised limit.
 */
function failOnOversizedChunks(): Plugin {
  let limitKb = 500;
  return {
    name: 'throng:fail-on-oversized-chunks',
    apply: 'build',
    configResolved(config) {
      limitKb = config.build.chunkSizeWarningLimit;
    },
    generateBundle(_options, bundle) {
      const oversized = Object.values(bundle)
        .filter((out) => out.type === 'chunk')
        .map((chunk) => ({ name: chunk.fileName, kb: Buffer.byteLength(chunk.code) / 1000 }))
        .filter((c) => c.kb > limitKb);
      if (oversized.length > 0) {
        this.error(
          `chunks over ${limitKb} kB — split them with a rule in chunkFor (vite.config.ts): ` +
            oversized.map((c) => `${c.name} ${c.kb.toFixed(2)} kB`).join(', '),
        );
      }
    },
  };
}

/**
 * The Markdown preview pipeline's libraries (R21): loaded by dynamic import on the first preview mount.
 * `chunkFor` routes them to the `preview` chunk and `failOnEagerPreview` proves that chunk stays lazy.
 */
const PREVIEW_VENDOR = /\/node_modules\/(markdown-it|linkify-it|mdurl|uc\.micro|punycode\.js|entities|dompurify|yaml)\//;

/**
 * The Mermaid diagram renderer and the packages it pulls in (054 R5, FR-047): imported only by
 * `preview/diagram/mermaid-renderer.ts`'s dynamic `import('mermaid')`, so a preview without a diagram —
 * and the app's startup — never loads it. `dompurify` is shared with the preview pipeline and stays in
 * `preview`.
 */
const DIAGRAM_VENDOR =
  /\/node_modules\/(mermaid|@mermaid-js\/[^/]+|@braintree\/sanitize-url|@iconify\/[^/]+|@upsetjs\/venn\.js|chevrotain|@chevrotain\/[^/]+|langium|vscode-[a-z-]+|cose-base|cytoscape[a-z-]*|d3|d3-[a-z-]+|dagre-d3-es|dayjs|delaunator|elkjs|es-toolkit|hachure-fill|internmap|katex|khroma|layout-base|lodash-es|marked|path-data-parser|points-on-curve|points-on-path|robust-predicates|roughjs|rw|stylis|ts-dedent|uuid)\//;

/** Both lazily-loaded vendor sets, as the eager guard below checks them. */
const LAZY_VENDOR = [
  { pattern: PREVIEW_VENDOR, what: 'the Markdown preview pipeline loads with the app (R21)' },
  { pattern: DIAGRAM_VENDOR, what: 'the Mermaid diagram renderer loads with the app (054 FR-047)' },
];

/**
 * A chunk rule cannot make code lazy, only a dynamic import can — and one chunk rule that swept the
 * lazily-imported Markdown body into an eagerly-loaded chunk turned every such import into a no-op,
 * loading the whole pipeline with the app (Rolldown said so only as an INEFFECTIVE_DYNAMIC_IMPORT
 * warning). This fails the build when any entry reaches a `PREVIEW_VENDOR` or `DIAGRAM_VENDOR` module
 * through static imports alone.
 */
function failOnEagerPreview(): Plugin {
  return {
    name: 'throng:fail-on-eager-preview',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle)
          .filter((out) => out.type === 'chunk')
          .map((chunk) => [chunk.fileName, chunk]),
      );
      const eager = new Set<string>();
      const pending = [...chunks.values()].filter((c) => c.isEntry).map((c) => c.fileName);
      while (pending.length > 0) {
        const name = pending.pop()!;
        if (eager.has(name)) continue;
        eager.add(name);
        pending.push(...(chunks.get(name)?.imports ?? []));
      }
      for (const { pattern, what } of LAZY_VENDOR) {
        const offenders = [...eager].filter((name) =>
          chunks.get(name)!.moduleIds.some((id) => pattern.test(id.replace(/\\/g, '/'))),
        );
        if (offenders.length > 0) {
          this.error(
            `${what} — eager chunks holding it: ` +
              `${offenders.join(', ')}. Keep the modules behind its dynamic imports out of eager chunks in chunkFor.`,
          );
        }
      }
    },
  };
}

/**
 * The `@lezer/*` packages that are the parser RUNTIME rather than a language: the LR engine, the
 * syntax-tree model and the highlight tags. Every grammar depends on them, so they stay in one
 * shared chunk; everything else under `@lezer/` is a language's parse tables and rides with it.
 */
const SHARED_LEZER = new Set(['common', 'lr', 'highlight']);

// Renderer build pipeline (research D2). The renderer is a React 19 app bundled
// by Vite; main and preload stay on `tsc`. Output goes to `dist/renderer` so the
// Electron main process can `loadFile` it. `base: './'` keeps asset URLs relative
// for `file://` loading inside Electron.
export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  plugins: [react(), failOnOversizedChunks(), failOnEagerPreview()],
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
    /*
     * Vite 8 bundles with Rolldown. Its `manualChunks` compatibility layer pulls every captured module's
     * dependencies into the same chunk, which put `@codemirror/view` in `core` and the shared lezer
     * runtime in whichever grammar came first — making that grammar eager. The native `codeSplitting`
     * groups with `includeDependenciesRecursively: false` keep each module where the rules below put it;
     * `strictExecutionOrder` and `preserveEntrySignatures: false` are what Rolldown requires alongside it
     * so the split chunks still run in import order.
     */
    rolldownOptions: {
      preserveEntrySignatures: false,
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [{ name: chunkFor, debugName: 'chunkFor' }],
        },
      },
    },
  },
});

/**
 * The chunk a module belongs to, or `null` for the app's own code (Rolldown's automatic chunking).
 *
 * Split the heavy third-party libs into their own chunks so the app chunk stays small (and each vendor is
 * cached independently). This also clears Vite's 500 kB single-chunk warning. Route by module path (not
 * package name) so shared deps land in exactly one chunk — no empty chunks. Ids are normalised to `/`
 * first: on Windows they can carry backslashes.
 */
function chunkFor(rawId: string): string | null {
  const id = rawId.replace(/\\/g, '/');
  // `@throng/core` — the domain layer every window kind shares, most of it the settings and theme
  // metadata. Its own chunk, like a vendor, so no window's app chunk carries it (044: the workspace
  // chunk passed 500 kB).
  if (/\/packages\/core\//.test(id)) return 'core';
  // The preview panel and its providers — the app's own code, but its largest self-contained area.
  // Its own chunk keeps the app chunk under 500 kB (047 took it to 525 kB).
  // The Markdown provider's body sits behind `view.ts`'s dynamic imports (R21), so it gets a chunk of
  // its own: in `app-preview`, which the app loads eagerly, those imports would load nothing new.
  if (/\/src\/renderer\/preview\/providers\/markdown\/(?!view\.ts$)/.test(id)) return 'app-preview-markdown';
  // 054 FR-047 — the two diagram modules that import a lazy vendor (mermaid; DOMPurify for the SVG profile)
  // are reached only by the block registry's `import()`, so they get a chunk of their own. The diagram's
  // React components and the rasteriser import neither and ride with whatever imports them.
  if (/\/src\/renderer\/preview\/diagram\/(mermaid-renderer|svg-sanitise)\.ts$/.test(id)) return 'app-preview-diagram';
  if (/\/src\/renderer\/preview\//.test(id)) return 'app-preview';
  // The terminal panel and its stores — the next largest self-contained area, split for the same
  // reason (053's title templates took the app chunk to 501 kB).
  if (/\/src\/renderer\/terminal\//.test(id)) return 'app-terminal';
  if (!id.includes('node_modules')) return null;
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
  // The Markdown preview pipeline (R21): loaded by dynamic import on the first preview
  // mount, so it must not ride in the eagerly-loaded `vendor` chunk. `@lezer/highlight`
  // stays in the shared `lezer` chunk above — the editor already pays for it eagerly.
  if (PREVIEW_VENDOR.test(id))
    return 'preview';
  // The Mermaid renderer (054 FR-047): behind `mermaid-renderer.ts`'s dynamic import, never `vendor`.
  if (DIAGRAM_VENDOR.test(id)) return 'diagram';
  return 'vendor'; // react-arborist (+ its react-dnd deps), inversify, …
}
