import { defineConfig } from '@playwright/test';

/** 061 FR-060 — the measurement script's own config, so it stays out of every E2E lane. */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.measure.ts',
  globalSetup: '../../../../scripts/playwright-global-setup.mjs',
  globalTeardown: '../../../../scripts/playwright-global-teardown.mjs',
  workers: 1,
  retries: 0,
  reporter: 'line',
});
