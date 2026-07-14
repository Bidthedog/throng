import { expect, test } from '@playwright/test';
import { createProject, runApp } from './harness.js';

/**
 * 018 / US6 — an error notice PERSISTS, and therefore must not become an obstacle.
 *
 * Severity governing persistence is the right model: an error that silently auto-vanished while the user
 * was looking elsewhere would be a worse defect than the nine idioms it replaced. But persistence has a
 * consequence the model has to answer for. The notices sit in a FIXED layer over the bottom-right of the
 * window — which, in the preferences window, is directly on top of the settings rows.
 *
 * A card that accepted pointer events would therefore park itself over the very controls the user needs
 * in order to FIX the failure it is reporting, and their clicks would land on the message instead. The
 * notice is something to READ; only its dismiss control is something to press.
 *
 * The hit-test is the assertion, rather than "some control I happened to pick still works": it holds
 * whatever the notice lands on top of, which is the actual requirement.
 */

test('a persistent error notice does not win the hit-test; its dismiss control does (US6)', async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha');

    // Raise a real, PERSISTENT error notice — a project on a root that is already taken.
    await win.getByTestId('project-new').click();
    await win.getByTestId('project-root-input').fill('C:/code/alpha');
    await win.getByTestId('project-name-input').fill('Beta');
    await win.getByTestId('project-save').click();

    const notice = win.getByTestId('project-error');
    await expect(notice).toBeVisible();
    // It is an ERROR: it waits for the user rather than timing out while they read it.
    await win.waitForTimeout(1200);
    await expect(notice).toBeVisible();

    // Whatever the card is sitting on top of, the card is not what a click at that point would hit.
    const swallows = await win.evaluate(() => {
      const card = document.querySelector('[data-testid="project-error"]');
      if (!card) return 'NO-NOTICE';
      const r = card.getBoundingClientRect();
      // The message area, deliberately away from the dismiss control in the top-right corner.
      const hit = document.elementFromPoint(r.left + 12, r.bottom - 8);
      return hit === null ? 'NOTHING' : (card.contains(hit) ? 'THE-NOTICE' : 'THROUGH');
    });
    expect(swallows, 'the notice is swallowing clicks meant for the app beneath it').toBe('THROUGH');

    // …and the one thing on the card that IS pressable still is.
    await win.getByTestId('project-error-dismiss').click();
    await expect(notice).toHaveCount(0);
  });
});
