import { test, expect } from '@playwright/test';
import { createProject, firstPanelId, runApp } from './harness.js';
import { skipIfElevated } from './admin.js';

// FR-025a/d (Phase G): the "run as administrator" control is enabled ONLY when the
// terminal-hosting daemon is elevated. The E2E daemon runs at normal integrity, so
// the always-runnable assertion is the DISABLED state + its hover hint, and that an
// unelevated terminal shows no ADMIN pill. The enabled/checked → ADMIN-pill path
// requires an actually-elevated runner and is documented as skipped there.

test('the "run as admin" checkbox is disabled with a hover hint when the daemon is not elevated', async () => {
  skipIfElevated();
  await runApp(async (_app, win) => {
    await createProject(win, 'Admin', 'C:/c/admin');
    const a = await firstPanelId(win);

    await win.getByTestId(`panel-type-select-${a}`).selectOption('terminal');
    const check = win.getByTestId('terminal-admin');
    await expect(check).toBeVisible();
    // Not elevated → the control is disabled…
    await expect(check).toBeDisabled();
    // …and its label explains how to enable it (relaunch as administrator).
    const title = await check.evaluate(
      (el) => el.closest('label')?.getAttribute('title') ?? '',
    );
    expect(title.toLowerCase()).toContain('administrator');

    // No ADMIN pill is shown for an unelevated (untyped, here) Panel.
    await expect(win.getByTestId(`panel-admin-${a}`)).toHaveCount(0);
  });
});
