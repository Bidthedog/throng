import { test, expect } from '@playwright/test';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApp } from './harness.js';

// US8 / FR-031 (config foundation): on first run the app creates the user-scoped
// config documents under the config root with documented defaults. The root is
// overridden to a temp dir via THRONG_CONFIG_ROOT so the real profile is untouched.

test('creates default settings/keybindings/theme files on first run', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'throng-cfgroot-'));
  try {
    await runApp(
      async () => {
        await expect.poll(() => existsSync(join(cfg, 'settings.json'))).toBe(true);
        await expect.poll(() => existsSync(join(cfg, 'keybindings.json'))).toBe(true);
        await expect.poll(() => existsSync(join(cfg, 'themes', 'throng.json'))).toBe(true);

        // The settings file is valid JSON carrying the documented schema.
        const settings = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'));
        expect(settings).toHaveProperty('confirmations');
        expect(settings).toHaveProperty('behaviour.submenuHoverMs');
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});
