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
  testTimeout: 30_000,
  hookTimeout: 30_000,
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
