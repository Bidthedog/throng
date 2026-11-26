// The guide's screenshot generator (080 FR-023, R24): one spec, one worker, never part of the E2E suite.
// Run from the repository root: `npm run build && npm run guide:screenshots`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/guide-screenshots',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
});
