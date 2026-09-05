import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

// Resolve @throng/* workspace imports to TypeScript source so tests run
// without a prior build (Red-Green-Refactor friendly).
const alias = {
  '@throng/core/testing': fileURLToPath(
    new URL('./packages/core/src/testing/index.ts', import.meta.url),
  ),
  '@throng/core': pkg('core'),
  '@throng/ipc-contract': pkg('ipc-contract'),
  '@throng/platform-windows': pkg('platform-windows'),
  '@throng/persistence': pkg('persistence'),
};

// esbuild must honour legacy decorators for InversifyJS (@injectable/@inject).
//
// `jsx: react-jsx` is what lets a .tsx file be transformed at all here. Without it esbuild emits
// classic `React.createElement` calls against an import the renderer's sources do not make — the
// app builds fine because Vite is configured for the automatic runtime, so the gap only appears
// the first time a test renders a component, as `ReferenceError: React is not defined`.
const esbuild = {
  target: 'es2022',
  jsx: 'automatic',
  tsconfigRaw: {
    compilerOptions: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
      jsx: 'react-jsx',
    },
  },
} as const;

// Shared config for the OS-heavy test layers (integration + contract). Both spawn
// real OS processes (node-pty shells, directory-lock holders) and mutate shared
// on-disk artifacts (e.g. daemon/dist/BUILD_ID in the build-id tests), so their
// files MUST run serially in ONE worker: concurrent files race that shared state
// and can hit the Windows "AttachConsole failed" limit under load.
//
// `maxWorkers: 1` is what forces that, and it is stated alongside
// `fileParallelism: false` deliberately rather than relying on either alone.
//
// This was `poolOptions: { forks: { singleFork: true } }` until Vitest 4 REMOVED
// `poolOptions` in favour of top-level options — which meant the serialization these
// layers depend on was being requested through an option the runner no longer read.
// It announced itself only as a deprecation line above every integration and contract
// run. Both suites still passed, because a race that needs load to appear does not
// appear every time; that is precisely what makes silently-dropped serialization
// worth fixing rather than living with.
const osSerial = {
  fileParallelism: false,
  pool: 'forks',
  maxWorkers: 1,
  /*
   * 60 s, RAISED from 30 (#359). Not the same fix as #355 below, and the difference is the whole
   * argument: that layer was INHERITING vitest's 5 s default, so stating a budget was itself the
   * correction. Here a budget was already stated deliberately, so raising it needs a reason.
   *
   * The reason is that THIS LAYER DOES NOT SCALE WITH CPU, and the 30 s was set as though it did.
   * These tests are dominated by real OS process work — a daemon started and stopped per test,
   * ConPTY spawns, and process-tree probing to decide whether a shell is busy. That is syscall-
   * and I/O-bound, so it degrades far harder on slow or virtualised hardware than compute does.
   *
   * Measured, same commit, `terminal-reattach.integration.test.ts`:
   *
   *   closeIdle/killAll test   4.7 s here          >30 s (timed out) on a slow Windows box
   *   whole file (2 tests)     6.0 s here          38.5 s there
   *
   * That is ~6.4x, against the 1.9-4.1x the compute-bound stages show on the same machine — and
   * it matches the gate's own numbers, where the integration stage ran 9m01s at 12% MEAN CPU. It
   * was waiting, not computing. So 30 s looked like a 6x margin and was really a 1x one.
   *
   * Do NOT buy headroom back by shortening `ping -n 12` in that test. The ping is not a cost the
   * test pays — it is killed by `killAll` long before its 12 seconds elapse, and it exists only
   * so the daemon has a genuinely multi-second child to classify as busy. Shortening it races the
   * classification poll it was sized to outlast, and trades the test's meaning for a runtime it
   * was not spending anyway.
   */
  testTimeout: 60_000,
  hookTimeout: 60_000,
} as const;

export default defineConfig({
  resolve: { alias },
  esbuild,
  test: {
    // Consolidate all vitest scratch under one %TEMP%/throng_e2e_<runhash>/
    // folder (created here when a layer is run directly, or inherited from the
    // top-level wrapper). Runs once, before any worker is forked.
    globalSetup: ['./scripts/vitest-global-setup.mjs'],
    projects: [
      {
        resolve: { alias },
        esbuild,
        test: {
          name: 'unit',
          include: ['packages/**/tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        esbuild,
        test: {
          // The component layer: a renderer component rendered into a DOM and asked
          // what it produces — markup, computed style, focus movement inside it,
          // keyboard handling, accessibility attributes. No application, no window,
          // no daemon, no shell, so it runs in the default parallel pool and costs
          // milliseconds where the same assertion cost a ~2s Electron launch.
          //
          // It exists because it did not, and its absence was load-bearing: two unit
          // tests (icon-call-sites, panel-identity-key) are source-text guards that
          // say so in their own comments, and ~40% of the E2E suite asserted things
          // that had nowhere cheaper to live. jsdom over happy-dom because the
          // assertions moving here need getComputedStyle fidelity more than speed.
          //
          // What it CANNOT see, and what therefore stays at E2E (FR-049): compositing,
          // hardware rendering, and operating-system focus.
          name: 'component',
          include: ['packages/**/tests/component/**/*.test.ts'],
          environment: 'jsdom',
          setupFiles: ['./packages/ui/tests/component/setup.ts'],
          /*
           * 15 s, STATED rather than inherited (#355).
           *
           * This was vitest's default 5 s — not a value anyone chose, sitting in the same file as
           * `osSerial`, whose author took the trouble to declare 30 s and say why. It was doing
           * real work: on a machine roughly 2.5-3x slower per core than a current desktop, the two
           * most expensive tests in this layer fail on it, and they fail with `Test timed out in
           * 5000ms` rather than on any assertion.
           *
           * They are expensive for a reason that is not going away. Per-file fixed costs here —
           * constructing a jsdom, importing React and a component tree — come to roughly DOUBLE the
           * assertion time across the layer. On top of that `preferences-themes-tab` mounts a row
           * per theme token (193 of them) and then types eight characters through `userEvent`,
           * reconciling that list on each one, before waiting out the filter's real 150 ms
           * debounce. All single-threaded JavaScript with no I/O to overlap, so it scales with
           * per-core speed and nothing else.
           *
           * Which is why the alternative does not work: capping workers reaches the same green,
           * because each test gets a larger share of a core, but costs 3.8x the wall clock (504 s
           * against 132 s) — six extra minutes on every run to avoid writing this line down.
           * Parallelism changes how many tests run at once, never how long one of them takes.
           *
           * 15 s and not 30 s: triple the old ceiling covers hardware several times slower, while
           * staying well short of letting a genuine hang sit unnoticed. A hung test is hung, not
           * three times slow, so tripling the budget costs the signal nothing — whereas the
           * inherited 5 s was already producing false failures on real hardware.
           */
          testTimeout: 15_000,
        },
      },
      {
        resolve: { alias },
        esbuild,
        test: {
          name: 'integration',
          include: ['packages/**/tests/integration/**/*.test.ts'],
          environment: 'node',
          ...osSerial,
        },
      },
      {
        resolve: { alias },
        esbuild,
        test: {
          // Contract tests are a runner sub-suite of the integration layer
          // (FR-015), not a fourth conceptual test layer. Same OS-heavy
          // serialization as integration (see `osSerial`).
          name: 'contract',
          include: ['packages/**/tests/contract/**/*.test.ts'],
          environment: 'node',
          ...osSerial,
        },
      },
    ],
  },
});
