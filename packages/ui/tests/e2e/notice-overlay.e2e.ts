import { expect, test } from '@playwright/test';
import { createProject, firstPanelId, mkdtempSync, tmpdir, join, runApp } from './harness.js';

/**
 * 018 / US6, SUPERSEDED BY #313 — an error notice persists, and is therefore an interactive surface.
 *
 * ══ WHAT THIS FILE USED TO ASSERT, AND WHY IT IS INVERTED ══
 *
 * It asserted `'THROUGH'`: that a click at the notice's message area does NOT land on the notice.
 * The reasoning, kept because it is the honest half of the trade: notices sit in a fixed layer over
 * the bottom-right of the window, an error persists until dismissed, and a card that took pointer
 * events would park itself over the very controls a user needs in order to FIX what it reports.
 *
 * #313 supersedes that, and 030 FR-032b with it, on the maintainer's ruling. The collision is real;
 * click-through is not a fix for it. It converts a VISIBLE obstruction into an INVISIBLE one — the
 * click reaches a control the user cannot see and did not aim at, nothing tells them it happened,
 * and the notice is drawn over whatever it did. "Nothing happened when I clicked the notice" is
 * legible and recoverable. "The panel I did not ask for was created" is neither.
 *
 * So the assertion below is now `'THE-NOTICE'`, and the same `elementFromPoint` probe that once
 * proved the click fell through proves it no longer does. Nothing about the mechanism changed, only
 * the expected value — which is the clearest possible record of a superseded decision.
 *
 * ══ WHY THESE TWO STAY AT E2E ══
 *
 * `packages/ui/tests/component/notice-pointer-events.test.ts` covers the cascade — it loads the real
 * `theme.css` into jsdom and proves `.notice` computes `pointer-events: auto`. That is the INPUT to
 * a hit test, and it is all a component test can reach: jsdom has no layout, so it cannot deliver a
 * click to one of two overlapping elements. These two tests are the hit test itself, in a real
 * window with real geometry — the constitution's real-layout reserve, exactly.
 */

test('a persistent error notice wins the hit-test over what it covers (#313, superseding 018 US6)', { tag: ['@extended', '@failure', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    await createProject(win, 'Alpha', 'C:/code/alpha');

    // Raise a real, PERSISTENT error notice — a project on a root that is already taken.
    await win.getByTestId('project-new').click();
    await win.getByTestId('project-root-input').fill('C:/code/alpha');
    await win.getByTestId('project-name-input').fill('Beta');
    await win.getByTestId('project-save').click();

    const notice = win.getByTestId('project-error');
    await expect(notice).toBeVisible();
    /*
     * It is an ERROR under the shipped default (`dismiss`): it waits for the user rather than timing
     * out while they read it. That `NotificationProvider` arms no timer at all for `mode: 'dismiss'`
     * — at any severity, for any duration, an hour included — is proven with a fake clock in
     * `packages/ui/tests/component/notice-dismissal-timer.test.ts` ("Dismiss only never arms a timer,
     * whatever the severity", 034 FR-045/SC-008). This spec no longer waits real seconds to gesture at
     * the same fact; it keeps the part only Electron can prove — the hit-test below.
     */

    // Whatever the card is sitting on top of, the card is what a click at that point hits.
    const swallows = await win.evaluate(() => {
      const card = document.querySelector('[data-testid="project-error"]');
      if (!card) return 'NO-NOTICE';
      const r = card.getBoundingClientRect();
      // The message area, deliberately away from the dismiss control in the top-right corner.
      const hit = document.elementFromPoint(r.left + 12, r.bottom - 8);
      return hit === null ? 'NOTHING' : card.contains(hit) ? 'THE-NOTICE' : 'THROUGH';
    });
    expect(swallows, 'the click fell through the notice to whatever is beneath it').toBe(
      'THE-NOTICE',
    );

    // …and the one thing on the card that was ALWAYS pressable still is. This is the remedy the
    // supersession rests on: if a notice covers something, it is dismissed, not clicked through.
    await win.getByTestId('project-error-dismiss').click();
    await expect(notice).toHaveCount(0);
  });
});

/**
 * The 60-click measurement, inverted (#313; acceptance criterion 4).
 *
 * 030 FR-032b's evidence was a notice listing two panels sitting over the panel-type form's Confirm
 * button, swallowing 60 retried clicks. That measurement is still true, and this test is what makes
 * it a REGRESSION GUARD rather than an anecdote — but it guards the opposite outcome, because the
 * finding that settled #313 is that **the panel-type form is not a modal**. It is ordinary panel
 * content, `.panel-type-form__actions` is `justify-content: flex-end; margin-top: auto`, and so
 * Confirm sits bottom-right of its panel while the notice column is pinned bottom-right of the
 * window. No z-ordering rule reaches that case; only dismissal does.
 *
 * The claim: a real click, at real coordinates where the two genuinely overlap, must not confirm the
 * panel. `elementFromPoint` above proves the hit test resolves to the notice; this proves the
 * DISPATCH does — that the button beneath does not fire.
 */
test('a click on a notice parked over the panel-type form does not confirm the panel (#313)', { tag: ['@core', '@failure', '@reserve:layout'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-313-'));
  await runApp(async (_app, win) => {
    await createProject(win, 'Alpha', root);
    const pid = await firstPanelId(win);

    // Arm the form so Confirm is live: a click that got through would really create the panel.
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await expect(win.getByTestId(`panel-type-confirm-${pid}`)).toBeEnabled();

    // The same persistent error notice as above — a second project on a root already taken.
    await win.getByTestId('project-new').click();
    await win.getByTestId('project-root-input').fill(root);
    await win.getByTestId('project-name-input').fill('Beta');
    await win.getByTestId('project-save').click();
    await expect(win.getByTestId('project-error')).toBeVisible();

    // Where do the two actually overlap? Measured, not assumed — if the layout ever separates them
    // this test says so in as many words rather than passing for the wrong reason.
    const point = await win.evaluate((panelId) => {
      const card = document.querySelector('[data-testid="project-error"]');
      const confirm = document.querySelector(`[data-testid="panel-type-confirm-${panelId}"]`);
      if (!card || !confirm) return null;
      const a = card.getBoundingClientRect();
      const b = confirm.getBoundingClientRect();
      const left = Math.max(a.left, b.left);
      const right = Math.min(a.right, b.right);
      const top = Math.max(a.top, b.top);
      const bottom = Math.min(a.bottom, b.bottom);
      if (right <= left || bottom <= top) return null;
      return { x: (left + right) / 2, y: (top + bottom) / 2 };
    }, pid);

    expect(
      point,
      'the notice and the panel-type Confirm button no longer overlap, so this test can no longer ' +
        'make its claim. That is a layout change worth understanding before this is deleted — see ' +
        'the 60-click measurement above `.notice__affected` in theme.css.',
    ).not.toBeNull();

    await win.mouse.click(point!.x, point!.y);

    // The notice absorbed it: the form is still a form, and no terminal was started.
    await expect(win.getByTestId(`panel-type-confirm-${pid}`)).toBeVisible();
    await expect(win.getByTestId(`terminal-${pid}`)).toHaveCount(0);
    // …and the notice is still there to be dismissed, which is the way past it.
    await expect(win.getByTestId('project-error')).toBeVisible();
  });
});
