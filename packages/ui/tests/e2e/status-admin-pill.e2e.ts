import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject } from './harness.js';

// Status-bar ADMIN pill (FR-025e): when throng runs elevated — the same
// daemon-capabilities signal that enables the per-terminal "Run as admin" checkbox
// (FR-025a) — the status bar shows a red "ADMIN" pill on its RIGHT side, and the
// active Tab · Panel context sits on the LEFT (after the project path). The elevated
// state is forced here via THRONG_FAKE_ELEVATED so the pill is verifiable without a
// real UAC/elevated run (mirrors the capabilities test seam the checkbox uses).

test('shows a red ADMIN pill on the right when elevated; context is on the left', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-adminpill-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'PillProj', root);

        // The pill is present, on the RIGHT, and reads ADMIN.
        const pill = win.getByTestId('status-admin-pill');
        await expect(pill).toBeVisible();
        await expect(pill).toHaveText('ADMIN');
        await expect(win.locator('.throng-status-bar__right').getByTestId('status-admin-pill')).toBeAttached();

        // It is highlighted in red (border colour resolves to a red channel-dominant rgb).
        const border = await pill.evaluate((el) => getComputedStyle(el).borderColor);
        const [r, g, b] = border.match(/\d+/g)!.map(Number);
        expect(r, `pill border ${border} should be red-dominant`).toBeGreaterThan(g + 40);
        expect(r).toBeGreaterThan(b + 40);

        // The active Tab · Panel context now lives in the LEFT section.
        await expect(win.locator('.throng-status-bar__left').getByTestId('status-context')).toBeAttached();
      },
      { env: { THRONG_FAKE_ELEVATED: '1' } },
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('shows no ADMIN pill when not elevated', async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-adminpill-off-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'PlainProj', root);
      await expect(win.getByTestId('status-admin-pill')).toHaveCount(0);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
