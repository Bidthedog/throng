import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  createProject,
  firstPanelId,
  openApp,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';

/**
 * Computed-style checks on the application's chrome, on ONE shared app (test-suite audit).
 *
 * MERGED from three files that each launched their own Electron app and daemon to read a few computed
 * styles — `scrollbars.e2e.ts` (018 / US3, FR-009 … FR-012), `select-popup.e2e.ts` (018, the native
 * <select> popup is ours to theme) and `project-browse-neutral.e2e.ts` (the create form's Browse button
 * is project-neutral). None seeds anything before launch, and what each reads is either window-wide and
 * independent of any project (the scrollbar tokens, a throwaway probe element) or read straight after the
 * test makes its own project.
 *
 * ORDER, which is what makes sharing safe:
 *  1. the scrollbar probe — no project at all, measures an element it creates and removes itself;
 *  2. the <select> popup — makes its own project and reads that project's first panel;
 *  3. the Browse button — makes a RED project (so `--accent` is red window-wide) and leaves the create form
 *     open; the test CANCELS it, so the next test's `project-new` opens a form rather than toggling one;
 *  4. the terminal scrollbar — LAST, because it starts a live `cmd` shell that can still hold its project
 *     root after teardown. That cleanup moves to `afterAll`, where the app has actually closed, keeping the
 *     swallow for the same reason it was written.
 * Test 4's `.terminal-panel .xterm-viewport` is window-wide, which is safe because no earlier test opens a
 * terminal. Every root is distinct and none nests inside another, so FR-029's root exclusivity (identical,
 * ancestor AND descendant roots are refused) is never engaged.
 */
const ownedRoots: string[] = [];
/** Register a project root for removal in `afterAll`, once the shared app has closed. */
function own(dir: string): string {
  ownedRoots.push(dir);
  return dir;
}

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;

test.beforeAll(async () => {
  shared = await openApp();
});

test.afterAll(async () => {
  await shared?.close();
  for (const dir of ownedRoots.splice(0)) {
    // Principle V: a test cleans up after itself — but a FAILURE to clean up is not a failure
    // of the test. The app has closed by here, yet on a slow runner the de-elevated cmd.exe
    // test 4 spawned can still hold a handle to the root for a moment, so rmSync throws EBUSY.
    try {
      cleanupTemp(dir);
    } catch {
      /* the OS reaps the temp dir; a locked handle here is not a product defect */
    }
  }
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

test('every scrollable surface gets a classic themed bar of the theme WIDTH (FR-010 / #130)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    // The provider writes the custom properties onto :root in an effect, so poll rather than
    // sampling the first frame. An UNDEFINED custom property resolves to the empty string — which
    // is exactly what would leave the engine's light-grey default bar in place, so "" is the
    // failure this asserts against.
    const token = (name: string) =>
      win.evaluate(
        (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name,
      );

    await expect.poll(() => token('--throng-colour-scrollbarTrack')).toMatch(/^#|rgb/);
    await expect.poll(() => token('--throng-colour-scrollbarThumb')).toMatch(/^#|rgb/);
    await expect.poll(() => token('--throng-size-scrollbar')).toMatch(/\d/);

    // #130 — the theme's px WIDTH must reach an ARBITRARY scrollable surface, not just the terminal.
    // This is the regression this test exists to catch: with the old global `scrollbar-color` on `*`,
    // Chromium rendered STANDARD overlay bars everywhere, which have NO layout width and ignore the
    // `::-webkit-scrollbar { width }` rule — so changing the theme's scrollbar width moved nothing.
    // Classic (webkit) bars occupy REAL layout width, so `offsetWidth − clientWidth` on a force-scrolled
    // throwaway element IS the bar's width. An overlay/inert bar measures 0 — the #130 failure — and a
    // classic bar measures the theme width. Proving it on an arbitrary element is the point: "every
    // scrollable surface", covered without a per-surface list to forget the next one from.
    const measured = await win.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:absolute;top:-9999px;left:-9999px;width:100px;height:100px;overflow-y:scroll';
      probe.innerHTML = '<div style="height:400px"></div>';
      document.body.appendChild(probe);
      const width = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      return width;
    });
    const themeWidth = Number.parseInt(await token('--throng-size-scrollbar'), 10);
    expect(themeWidth, 'the theme must define a concrete scrollbar width').toBeGreaterThan(0);
    expect(
      measured,
      'an arbitrary scrollable surface must show a CLASSIC bar of the theme width, not a 0-width overlay (#130)',
    ).toBe(themeWidth);
  });
});

/*
 * 018 — the drop-down popup of a native <select> is a MENU, and it did not obey the theme.
 *
 * Five <select> elements open a list that the BROWSER ENGINE rendered rather than us, so the hovered
 * row was highlighted in the SYSTEM accent — blue on a default Windows install, sitting in the middle
 * of a fully-themed dark application. No stylesheet could reach it. Exactly the same defect as the
 * native colour dialog (#64), and the source issues missed it.
 *
 * `appearance: base-select` makes the picker real DOM, which is what makes both the fix and this test
 * possible: a Playwright locator can now SEE the option list. It could not before.
 */
test('a drop-down’s popup is drawn by us, and its hover highlight is not the operating system’s blue', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-sel-')));
  await runApp(async (_app, win) => {
    await createProject(win, 'Selects', root);
    const pid = await firstPanelId(win);

    const select = win.getByTestId(`panel-type-select-${pid}`);
    await expect(select).toBeVisible();

    // The control must be opted OUT of the operating-system widget. This one assertion is the whole
    // fix: while the engine renders the popup, nothing we write can reach it, and the hovered row
    // stays the system's blue no matter how thoroughly the rest of the app is themed.
    await expect
      .poll(() => select.evaluate((el) => getComputedStyle(el).appearance))
      .toBe('base-select');

    // And the popup is real DOM now, so its rows are addressable and carry OUR colours — the hover
    // highlight resolves the theme's menu tokens, exactly like every other menu in the application.
    const highlight = await select
      .locator('option')
      .first()
      .evaluate((el) => {
        const root_ = getComputedStyle(document.documentElement);
        // Unset by default, so the highlight follows `--accent`: the ACTIVE PROJECT'S colour.
        const pinned = root_.getPropertyValue('--throng-colour-menuItemHoverSurface').trim();
        const accent = root_.getPropertyValue('--accent').trim();
        return { pinned, accent, optionColour: getComputedStyle(el).color };
      });

    expect(highlight.pinned, 'the menu highlight is unset, so it follows the project').toBe('');
    expect(highlight.accent, 'the project colour drives the highlight').toMatch(/^#|rgb/);
  });
});

// The create-project form's "Browse" button must be project-NEUTRAL — never tinted
// with the active project's accent colour (which is applied globally as --accent).
async function makeRedProject(win: Page): Promise<void> {
  await win.getByTestId('project-new').click();
  await win.getByTestId('project-name-input').fill('RedProj');
  await win.getByTestId('project-root-input').fill('C:/code/red');
  await win.getByTestId('project-colour-input').evaluate((el) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '#ff0000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.getByTestId('project-save').click();
  await expect(win.locator('.project-item', { hasText: 'RedProj' })).toBeVisible();
  // Creating a project opens it; settle on it being ACTIVE so `--accent` is the red one.
  const active = win.locator('.project-item[data-active="true"]');
  await expect(active).toHaveCount(1);
  await expect(active).toContainText('RedProj');
}

test('the create-project Browse button is not tinted with the active project colour', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  await runApp(async (_app, win) => {
    // A bright-red project → --accent becomes red for the whole window.
    await makeRedProject(win);
    const accent = (await win.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    )) as string;

    // Open the create form again; the Browse button must be neutral (not red),
    // at rest AND on hover.
    await win.getByTestId('project-new').click();
    try {
      const browse = win.getByTestId('project-pick-folder');
      await expect(browse).toBeVisible();

      const rest = await browse.evaluate((el) => getComputedStyle(el).color);
      await browse.hover();
      const hover = await browse.evaluate((el) => getComputedStyle(el).color);

      // Red resolves to rgb(255, 0, 0); the button text must never be that.
      expect(accent.toLowerCase()).toContain('ff0000');
      expect(rest).not.toBe('rgb(255, 0, 0)');
      expect(hover).not.toBe('rgb(255, 0, 0)');
      // Rest and hover colours match (no accent flip on hover).
      expect(hover).toBe(rest);
    } finally {
      // Shared app: put the create form away so the next test's `project-new` opens one rather than
      // toggling this one. Bounded and best-effort — a throw here would replace the body's failure.
      await win.getByTestId('project-cancel').click({ timeout: 2000 }).catch(() => {});
      await expect(win.getByTestId('project-form'))
        .toHaveCount(0, { timeout: 2000 })
        .catch(() => {});
    }
  });
});

/*
 * LAST, and it has to be: it starts a live `cmd` shell (see the file header).
 */
test('the terminal keeps its classic, non-overlay bar — MEASURED, not read from the stylesheet (FR-011)', { tag: ['@extended', '@window', '@reserve:layout'] }, async () => {
  const root = own(mkdtempSync(join(tmpdir(), 'throng-sb-')));
  await runApp(async (_app, win) => {
    // Open a real terminal: there is nothing to measure otherwise, and a test that passes because
    // it found nothing to check is the kind of test this whole feature exists to stop shipping.
    await createProject(win, 'Scrollbars', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('cmd');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    await expect(win.locator('.terminal-panel .xterm-viewport')).toBeVisible();
    // THE test of this story, and it must MEASURE.
    //
    // The terminal's scrollbar is load-bearing for LAYOUT, not just colour: it must occupy real
    // width so xterm's fit calculation wraps text BEFORE it. An overlay bar — which is what you get
    // by default — makes xterm wrap text UNDERNEATH the bar and the last column is overlapped.
    //
    // The hazard this feature actually created: setting the standard `scrollbar-color` property on
    // `*` makes Chromium ignore the `::-webkit-scrollbar-*` rules on that element, which would
    // silently turn the terminal's classic 12px bar into a thin overlay one. So `.xterm-viewport`
    // opts back out (terminal.css), and this test proves it — by measuring the gap between the
    // element's border box and its content box, which IS the scrollbar's real layout width.
    //
    // An earlier version of this test read `width: 12px` back out of the stylesheet text. It would
    // have passed with the rule completely inert, which makes it worse than no test at all.
    const scrollbarWidth = await win.evaluate(() => {
      const vp = document.querySelector('.terminal-panel .xterm-viewport');
      if (vp === null) return null;
      return (vp as HTMLElement).offsetWidth - (vp as HTMLElement).clientWidth;
    });

    // No terminal open in the default workspace → nothing to measure, and the assertion below would
    // be vacuous. Fail loudly rather than pass silently.
    expect(scrollbarWidth, 'expected a terminal viewport to measure').not.toBeNull();
    expect(
      scrollbarWidth,
      'the terminal scrollbar must occupy REAL layout width (non-overlay), or xterm wraps text underneath it',
    ).toBe(12);
  });
  // The root is deleted in `afterAll`, once the SHARED app has closed.
});
