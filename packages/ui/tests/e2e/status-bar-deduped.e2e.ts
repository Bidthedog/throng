import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { runApp, createProject, cleanupTemp} from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 026 / #166 — the status bar must stop duplicating the title bar's identity.
 *
 * Since the frameless custom title bar landed, `AppTitleBar` composes its identity from the SAME
 * `activeContextLabel(layout)` call the status bar uses, plus the project name, plus a trailing
 * `[ADMIN]` marker, plus the project colour as the bar's own colour — and `TitleManager` sends the
 * identical string to the OS taskbar. So the status bar's dot, project name, `Tab · Panel` context
 * and ADMIN pill are all a second copy of what is already on screen two rows up.
 *
 * The ONE thing the status bar carries that the title bar does not is the project's root folder
 * path. That stays; the duplicates go; the bar itself stays, at its current height, as the home for
 * status content added later.
 *
 * RED on master: every removed element is still rendered.
 *
 * This spec deliberately asserts the TITLE BAR is unchanged in the same run. The failure mode a
 * "drop the duplicate" change invites is deleting the wrong copy, and a test that only looks at the
 * status bar cannot see that happen.
 */

const osTitle = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

/** The status bar's rendered height — pinned so "remove the text" cannot become "collapse the bar". */
const barHeight = (win: Page): Promise<number> =>
  win.getByTestId('status-bar').evaluate((el) => el.getBoundingClientRect().height);

/*
 * ── ONE REMOVED (035 T055) ──
 *
 * `:70` "when elevated, [ADMIN] is on the title bar only — the status bar has no pill" → two
 * component tests against the same elevated daemon:
 *
 *   the STATUS bar has no pill  → `component/status-bar-content.test.ts:203` (already there)
 *   the TITLE bar has the mark  → `component/app-title-bar-identity.test.ts` (new)
 *
 * The status-bar half was migrated earlier and stopped there deliberately; its own note says why —
 * the marker is composed in `AppTitleBar` and reaches `TitleBar` as a plain `identity` prop, so
 * proving it "would need that composition extracted; that is a production refactor, not a test
 * migration, and the E2E keeps both halves until someone makes it."
 *
 * The refactor turned out to be one word: `AppTitleBar` is exported. Nothing else changed. Mounting
 * it tests the composition rather than a copy of it, which matters here more than usual — the bug
 * #166 is about is a marker reaching the WRONG bar, and only the real wiring can be wrong that way.
 * A pure `identityOf(...)` helper would have been the weaker answer.
 *
 * Red-proven: never-marked (2 red), always-marked (1), marker-replaces-identity (1). The last is
 * the one a single "is [ADMIN] there" test cannot see: an identity REPLACED by the marker rather
 * than extended by it loses the project name — and `TitleManager` sends the same string to the OS
 * taskbar, so it would be lost there too.
 *
 * ── WHAT STAYS ──
 *
 * `:36`, tagged `@reserve:window`: it is about the frameless window's own chrome and the
 * relationship between two real bars in one real window.
 */
test('the status bar keeps only the project root path; the title bar keeps the identity', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  skipIfElevated(); // this case asserts NO admin pill; the elevated case is the test below
  const root = mkdtempSync(join(tmpdir(), 'throng-statusdedupe-'));
  try {
    await runApp(async (app, win) => {
      await createProject(win, 'DedupeProj', root);

      // The bar itself survives, with its testid and a real height.
      const bar = win.getByTestId('status-bar');
      await expect(bar).toBeVisible();
      expect(await barHeight(win)).toBeGreaterThan(0);

      // The one non-duplicated fact stays, and is still the project's root folder.
      await expect(win.getByTestId('status-project-path')).toHaveText(`(${root})`);

      // The four duplicates are gone.
      await expect(win.getByTestId('status-project-dot')).toHaveCount(0);
      await expect(win.getByTestId('status-context')).toHaveCount(0);
      await expect(win.getByTestId('status-admin-pill')).toHaveCount(0);
      await expect(bar).not.toContainText('DedupeProj');

      // The title bar is untouched — same project name, same Tab · Panel context, same colour.
      const identity = win.getByTestId('title-bar-identity');
      await expect(identity).toContainText('DedupeProj');
      await expect(identity).toContainText('Tab 1 · Panel 1');

      // And so is the OS window/taskbar title (TitleManager).
      await expect.poll(() => osTitle(app), { timeout: 5000 }).toBe('DedupeProj · Tab 1 · Panel 1 — throng');
    });
  } finally {
    cleanupTemp(root);
  }
});

