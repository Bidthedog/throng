import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { skipIfElevated } from './admin.js';

// US1 / Plan Phase A (FR-001..008, SC-001/002/010): a new Panel shows an
// extensible type-selection form instead of "Empty Panel"; choosing Terminal
// swaps in its inputs; Clear resets; Confirm assigns the type. In Phase C, Confirm
// also launches the live terminal, and closing it reverts the Panel to the form.
// (Reload persistence is covered by terminal-persistence.e2e.ts / US3.)

test('replaces Empty Panel with the type form; swaps inputs; Clear resets; Confirm types + launches', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-form-'));
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'Typed', root);
      const pid = await firstPanelId(win);

      // The body is the type-selection form, not the old "Empty Panel" placeholder.
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible();
      await expect(win.getByTestId(`panel-body-${pid}`)).not.toContainText('Empty Panel');

      // No type selected yet → Confirm is blocked (FR-005).
      const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeDisabled();

      // Selecting Terminal reveals its inputs (FR-003).
      const select = win.getByTestId(`panel-type-select-${pid}`);
      await select.selectOption('terminal');
      await expect(win.getByTestId('terminal-flavour')).toBeVisible();
      await expect(win.getByTestId('terminal-params')).toBeVisible();
      await expect(confirm).toBeEnabled();

      // Clear returns to the initial empty state (FR-004).
      await win.getByTestId(`panel-type-clear-${pid}`).click();
      await expect(win.getByTestId('terminal-flavour')).toHaveCount(0);
      await expect(confirm).toBeDisabled();

      // Re-select (cmd flavour) and Confirm → the form + type control go away and a
      // live terminal opens (FR-006/014).
      await select.selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toHaveCount(0);
      await expect(win.getByTestId(`panel-type-select-${pid}`)).toHaveCount(0);
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      // The Panel header marks its type with an icon; the type AND flavour are in
      // its hover title (012 — the former text pill was replaced by the icon).
      const kind = win.getByTestId(`panel-kind-${pid}`);
      await expect(kind).toHaveAttribute('title', /Terminal/);
      await expect(kind).toHaveAttribute('title', /Command Prompt/);
      // Wait for cmd's prompt (its cwd) so it is ready for input.
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // Close the shell → the Panel reverts to the form (FR-020) and the root unlocks.
      await term.click();
      await win.keyboard.type('exit');
      await win.keyboard.press('Enter');
      await expect(win.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});

test('the type form renders and confirms in a sub-workspace window (FR-008)', async () => {
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-form-sub-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'SubForm', root);
      const pid = await firstPanelId(win);

      // Sync (clone) the untyped Panel into a new sub-workspace window.
      await win.getByTestId(`panel-handle-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toBeVisible();
      await win.getByTestId('menu-item-Sync to').click();
      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('menu-item-New Sub-workspace').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');
      await expect(child.getByTestId('subworkspace-window')).toBeVisible();

      // The same type-selection form renders in the child window and confirms there.
      await expect(child.getByTestId(`panel-type-form-${pid}`)).toBeVisible();
      await child.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await child.getByTestId('terminal-flavour').selectOption('cmd');
      const confirm = child.getByTestId(`panel-type-confirm-${pid}`);
      await expect(confirm).toBeEnabled();
      await confirm.click();
      const term = child.getByTestId(`terminal-${pid}`);
      await expect(term).toBeVisible();
      await expect(term).toContainText(basename(root), { timeout: 15000 });

      // Close the shell so the root unlocks before teardown.
      await term.click();
      await child.keyboard.type('exit');
      await child.keyboard.press('Enter');
      await expect(child.getByTestId(`panel-type-form-${pid}`)).toBeVisible({ timeout: 15000 });
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
});
