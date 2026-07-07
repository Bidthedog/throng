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
const esbuild = {
  target: 'es2022',
  tsconfigRaw: {
    compilerOptions: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  },
} as const;

// Shared config for the OS-heavy test layers (integration + contract). Both spawn
// real OS processes (node-pty shells, directory-lock holders) and mutate shared
// on-disk artifacts (e.g. daemon/dist/BUILD_ID in the build-id tests), so their
// files MUST run serially in ONE worker: concurrent files race that shared state
// and can hit the Windows "AttachConsole failed" limit under load. NOTE: per-project
// `fileParallelism: false` is NOT honoured by Vitest (it is effectively root-only) —
// `pool: 'forks'` + `singleFork` is what actually forces a single sequential worker.
// The high timeouts give OS-state polling (busy-detection, lock/PTY teardown) ample
// headroom, since node-pty's console-list helper is slow under full-suite load.
const osSerial = {
  fileParallelism: false,
  pool: 'forks',
  poolOptions: { forks: { singleFork: true } },
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
