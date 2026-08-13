/**
 * 030 US4 (#236) — ONE FAILURE BANNER, EVERY PANEL TYPE.
 *
 * ══ THE DEFECT ══
 *
 * An editor that cannot read its file and a terminal that cannot start its shell say so in two
 * different shapes, built from two pieces of markup that know nothing about each other:
 * `editor/unloadable-banner.tsx` and the `terminal-panel__starting` failure strip. Two designs for
 * one idea is one too many (SC-009), and a third panel type would have made it three — the
 * component this spec describes is the thing a new panel type USES rather than copies (FR-039).
 *
 * ══ WHAT THIS SPEC IS ══
 *
 * The RED half of US4. Every assertion below describes `packages/ui/src/renderer/common/
 * panel-failure-banner.tsx` (contracts/panel-failure-banner.md), which does not exist yet, so every
 * test here MUST fail — and must fail at the banner, not at its setup. Each test therefore proves
 * the panel really is in its failure state FIRST, through {@link inFailureState}, which accepts
 * either the shared banner or the per-type surface it replaces. That guard is what makes "the
 * banner is missing" the only thing left for the assertion to be reporting.
 *
 * ══ THREE CONTROLS, IN ORDER (US5, T069apre) ══
 *
 * US4 shipped with two and this file asserted two, exhaustively, so that US5's *Copy details* would
 * have to be INSERTED into a stated order rather than appended after whatever was already there. It
 * is now `['Try again', 'Copy details', 'Clear panel type']`, still exhaustive — which is also how
 * "not dismissible" (FR-046) is stated: a close button would be a fourth name in that list, so the
 * positive assertion carries the negative one and cannot pass vacuously the way
 * `expect(closeButton).toHaveCount(0)` would.
 *
 * The pointer sentence moves with it (T069pre/T069b). US4's transitional `Details are in the
 * diagnostic log.` named the only route that was unconditionally true while no copy control existed;
 * the final `Copy the details here, or see the notification.` leads with the control that always
 * works, and offers the notice second because it may have been dismissed, timed out or silenced.
 *
 * ══ HOW THE TWO FAILURES ARE PRODUCED, WITHOUT A SECOND LAUNCH ══
 *
 * Both panel types have to be broken in ONE app, because the whole claim is that they render the
 * same component; comparing two banners from two runs compares two screenshots of a hope.
 *
 * TERMINAL — `notice-logging.e2e.ts`'s ghost project: a project whose root folder never existed. The
 * daemon cannot lock the missing working directory and refuses the attach with a classified cause,
 * so the panel reaches the start-failure state with no shell ever spawning and no rename dance.
 *
 * EDITOR — the remount route `editor-coordinator.ts#verifyPath` documents. Open the file, switch the
 * project AWAY (nothing is mounted to hear what happens next), take its folder, then switch back:
 * the mount re-resolves the path, fails, and sets `unloadable` — and ONLY `unloadable`. The
 * watcher route (`markDeleted`) would reach the same banner while also marking the buffer dirty,
 * which would put a save/discard prompt in front of T054's Cancel and make that test about
 * something else. `beforeAll` asserts the panel is NOT dirty for exactly that reason.
 *
 * ══ TIER: SERIAL (T057) ══
 *
 * Registered in `parallel-plan.json`'s serial list for both of that file's mechanisms. FOCUS: T056b
 * drives the terminal panel's own context menu, and throng closes menus on blur, so a second headed
 * app closes this one underneath the assertion. CPU: T055's retry-success starts a REAL `cmd`, which
 * starves at high worker counts. Every other terminal here fails to start and spawns no shell.
 */
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  cleanupTemp,
  commitPanelRename,
  createProject,
  firstPanelId,
  openApp,
  runApp as runOwnApp,
  settle,
  type OpenApp,
} from './harness.js';

/** The shared banner's root (contract: `data-testid="panel-failure-{panelId}"`). */
function banner(win: Page, panelId: string): Locator {
  return win.getByTestId(`panel-failure-${panelId}`);
}

/**
 * A banner control, addressed by its ACCESSIBLE NAME rather than by a test id.
 *
 * FR-042/FR-042d fix the names — *Try again* and *Clear panel type*, identical in every panel type —
 * and the contract does not name test ids for the controls, only for the root. Keying on the name
 * asserts the requirement itself, works before and after the two per-type markups are deleted, and
 * cannot match a control whose accessible name is missing (which is the constitution's actual
 * complaint about an icon-only button).
 */
function control(win: Page, panelId: string, name: string): Locator {
  return banner(win, panelId).getByRole('button', { name, exact: true });
}

/** The banner's controls, in DOM order, as the names a keyboard or screen-reader user hears. */
async function controlNames(win: Page, panelId: string): Promise<string[]> {
  return banner(win, panelId)
    .locator('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''));
}

/**
 * SETUP GUARD — the panel really is in its failure state, however that state is currently drawn.
 *
 * Deliberately a UNION of the shared banner and the per-type surface it replaces. Before US4 lands
 * the legacy arm matches; after T060/T062 delete that markup the banner arm matches; at no point can
 * it pass while the panel is healthy, because `toHaveCount(1)` cannot be satisfied by nothing.
 *
 * Without this, every failure in this file would read "panel-failure-… not found" whether the banner
 * was missing or the app had simply never got the panel into trouble — and telling those two apart
 * is the entire value of writing the RED half first.
 */
async function inFailureState(win: Page, panelId: string, kind: 'editor' | 'terminal'): Promise<void> {
  const legacy = kind === 'editor' ? `editor-unloadable-${panelId}` : `terminal-start-failed-${panelId}`;
  await expect(
    win.locator(`[data-testid="panel-failure-${panelId}"], [data-testid="${legacy}"]`),
    `panel ${panelId} never reached its ${kind} failure state — this is a SETUP failure, not the banner`,
  ).toHaveCount(1, { timeout: 90_000 });
}

/** A real project root holding `src/code.txt`. */
function makeRealRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'code.txt'), 'ORIGINAL-CONTENT\n');
  return root;
}

/** A project root that has never existed — the cheapest terminal start failure there is. */
function ghostRoot(name: string): string {
  return `C:/throng-e2e-missing/${name.toLowerCase()}`;
}

/** Reopen a project from the sidebar; a no-op when it is already the open one. */
async function enterProject(win: Page, name: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 30_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  /*
   * ACTIVE, not merely present — `createProject` in the harness carries the same guard, for the
   * same measured reason: the OUTGOING project's panels stay on screen for a beat after the click,
   * so `.panel-box` is visible throughout and settling on it proves nothing.
   *
   * Keyed on `data-active` rather than on the name, because `hasText` is a substring match over the
   * whole row and a file that accumulates projects can resolve it to more than one.
   */
  const active = win.locator('.project-item[data-active="true"]');
  await expect(active).toHaveCount(1, { timeout: 30_000 });
  await expect(active).toContainText(name, { timeout: 30_000 });
  await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Switch to `name` and return ITS panel — settled on the workspace having actually swapped.
 *
 * The active-project guard above is necessary and not sufficient: `data-active` flips when the store
 * does, and the layout arrives over IPC afterwards, so a panel id read in between belongs to the
 * workspace that is about to be destroyed. Every testid built from it then waits out its whole
 * budget for an element that can never exist, and the failure reads as "the banner is missing" from
 * a run in which the banner was never asked for.
 *
 * MEASURED, in this file: with only the guard above, one run in four captured the Ghost project's
 * terminal panel while asking for the Real project's editor, and reported a setup failure 90 seconds
 * later. Polling until the id is no longer the OTHER project's is the condition that was actually
 * being waited for.
 */
async function panelOfProject(win: Page, name: string, otherPid: string): Promise<string> {
  await enterProject(win, name);
  let id = '';
  await expect
    .poll(
      async () => {
        id = await firstPanelId(win);
        return id;
      },
      { timeout: 30_000, message: `the workspace never swapped to ${name}` },
    )
    .not.toBe(otherPid);
  return id;
}

/** The editor panel of project `Real`. */
async function editorPanel(win: Page): Promise<string> {
  return panelOfProject(win, 'Real', ghostPid);
}

/** The terminal panel of project `Ghost`. */
async function terminalPanel(win: Page): Promise<string> {
  return panelOfProject(win, 'Ghost', realPid);
}

/** Turn `panelId` into an editor showing `src/code.txt`. */
async function editorOn(win: Page, panelId: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  await expect(win.getByTestId(`editor-${panelId}`)).toBeVisible({ timeout: 20_000 });
  const tree = win.getByTestId('file-explorer-tree');
  await tree.getByText('src', { exact: true }).dblclick();
  await tree.getByText('code.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${panelId}`).locator('.cm-content')).toContainText(
    'ORIGINAL-CONTENT',
    { timeout: 20_000 },
  );
}

/** Configure `panelId` as a `cmd` terminal into a folder that is not there. */
async function failingTerminalOn(win: Page, panelId: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${panelId}`).click();
  await inFailureState(win, panelId, 'terminal');
}

/** Name a panel through its header — no context menu, so nothing here steals a menu from a test. */
async function renamePanel(win: Page, panelId: string, to: string): Promise<void> {
  await win.getByTestId(`panel-handle-${panelId}`).dblclick();
  const input = win.getByTestId(`panel-rename-input-${panelId}`);
  await expect(input).toBeVisible();
  await input.fill(to);
  await commitPanelRename(win);
}

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * ONE APP, TWO BROKEN PANELS — everything except the two tests that must seed state before launch.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

test.describe.configure({ mode: 'serial' });

let h: OpenApp;
let realRoot = '';
/** The two panel ids, captured once — {@link panelOfProject} settles on the swap against them. */
let realPid = '';
let ghostPid = '';

test.beforeAll(async () => {
  test.setTimeout(300_000);
  realRoot = makeRealRoot('throng-pfb-real-');
  h = await openApp();
  const win = h.win;
  await settle(win);

  // A real project with a real file, opened into a real editor.
  await createProject(win, 'Real', realRoot);
  realPid = await firstPanelId(win);
  await editorOn(win, realPid);
  // Named, so T054's "it kept its title" is a statement about a title somebody chose.
  await renamePanel(win, realPid, 'Docs');

  // A second project whose root never existed: the terminal cannot start, and no shell is spawned.
  await createProject(win, 'Ghost', ghostRoot('pfb'));
  ghostPid = await firstPanelId(win);
  await failingTerminalOn(win, ghostPid);

  // Take the editor's folder while `Real` is CLOSED — nothing is mounted to hear it, so the editor
  // learns on its next mount and is `unloadable` WITHOUT being dirty (see the file header).
  renameSync(join(realRoot, 'src'), join(realRoot, 'src-moved'));

  const backPid = await editorPanel(win);
  await inFailureState(win, backPid, 'editor');
  // The buffer is clean. If this ever fails, T054's Cancel is about a dirty-close prompt instead of
  // about FR-043, and the whole file needs re-reading before its result means anything.
  await expect(
    win.getByTestId(`panel-unsaved-${backPid}`),
    'the editor came up DIRTY — the watcher saw the folder go, so this is markDeleted, not verifyPath',
  ).toHaveCount(0);
});

test.afterAll(async () => {
  await h?.close();
  if (realRoot) cleanupTemp(realRoot);
});

/**
 * T053 — ONE COMPONENT, BOTH PANEL TYPES.
 *
 * The claim is not "both have a retry button". It is that both are drawn by the same code, so the
 * evidence has to be structural: the same root test id shape, the same class list, the same role,
 * the same controls with the same accessible names in the same order. Two independently-written
 * banners can agree on their labels; they cannot agree on their class list by accident.
 *
 * The glyph checks are 029 FR-004b's, kept verbatim in spirit: an icon token the active theme does
 * not define renders NOTHING, silently, and the control becomes an invisible button. That has
 * already happened once in 029.
 */
test('an editor and a terminal that failed are drawn by the same banner, with the same three controls', async () => {
  test.setTimeout(240_000);
  const win = h.win;

  const editorPid = await editorPanel(win);
  await inFailureState(win, editorPid, 'editor');
  await expect(banner(win, editorPid)).toBeVisible();
  const editorShape = await banner(win, editorPid).evaluate((el) => ({
    className: el.className,
    role: el.getAttribute('role'),
    buttons: el.querySelectorAll('button').length,
  }));
  const editorControls = await controlNames(win, editorPid);

  const termPid = await terminalPanel(win);
  await inFailureState(win, termPid, 'terminal');
  await expect(banner(win, termPid)).toBeVisible();
  const termShape = await banner(win, termPid).evaluate((el) => ({
    className: el.className,
    role: el.getAttribute('role'),
    buttons: el.querySelectorAll('button').length,
  }));
  const termControls = await controlNames(win, termPid);

  // Same component (FR-039): same markup shape, not merely the same words.
  expect(termShape, 'the two panel types are still drawn by two different banners').toEqual(editorShape);

  /*
   * The control set, EXHAUSTIVELY and in order (FR-042, FR-042d, FR-051).
   *
   * Exhaustive is doing two jobs. Copy sits in the MIDDLE — inserted into the order US4 stated, not
   * appended after it — and the list states FR-046's "not dismissible" as a positive fact: a close
   * button would be a fourth name here. Written as `toHaveCount(0)` on a close button instead, that
   * half would pass vacuously for as long as no banner exists at all.
   */
  expect(editorControls).toEqual(['Try again', 'Copy details', 'Clear panel type']);
  expect(termControls).toEqual(['Try again', 'Copy details', 'Clear panel type']);
  expect(editorShape.buttons, 'the banner is missing a control (FR-051)').toBe(3);

  /*
   * Every control is a themeable icon with a hover title (FR-042b, Constitution VI).
   *
   * Each panel is inspected while ITS OWN project is open. The two broken panels deliberately live
   * in two different projects (see the file header), and throng mounts one project's workspace at a
   * time — MEASURED here: with `Ghost` open, the DOM holds Ghost's panel and nothing of `Real`. So a
   * single loop over both ids asked for an element that cannot exist and reported "the editor has no
   * Try again control" about a banner that was never on screen. The claim is unchanged; only the
   * moment each half of it is read.
   */
  for (const kind of ['editor', 'terminal'] as const) {
    const pid = kind === 'editor' ? await editorPanel(win) : await terminalPanel(win);
    await inFailureState(win, pid, kind);
    for (const name of ['Try again', 'Copy details', 'Clear panel type']) {
      const c = control(win, pid, name);
      await expect(c).toBeVisible();
      await expect(c).toHaveAttribute('title', /.+/);
      const glyph = (await c.innerText()).trim();
      expect(glyph, `${name} on ${pid} rendered nothing — an invisible control`).not.toBe('');
      expect(glyph.length, `${name} on ${pid} should be an icon, not a word`).toBeLessThanOrEqual(2);
      expect(glyph, `${name} on ${pid} should be an icon, not a word`).not.toMatch(/[A-Za-z]/);
    }
  }
});

/**
 * T056f / T069pre — the pointer sentence, in both panel types, in its FINAL wording.
 *
 * User-facing text with no test is the defect the second analysis pass fixed for FR-055. FR-040
 * requires a consistent pointer and FR-041 constrains what it may promise. US4's transitional
 * sentence named the diagnostic log because it was the only route that existed; now that the copy
 * control does, the pointer leads with it — Copy always works, and the notice is the secondary route
 * precisely because it may have been dismissed, timed out or silenced.
 *
 * The severity-silenced case is where that distinction stops being theoretical, so it is asserted
 * under *Never display* below (T069pre) rather than assumed here.
 */
test('both banners point at their own copy control, in the same words', async () => {
  test.setTimeout(240_000);
  const win = h.win;
  const POINTER = 'Copy the details here, or see the notification.';

  const editorPid = await editorPanel(win);
  await inFailureState(win, editorPid, 'editor');
  await expect(banner(win, editorPid)).toContainText(POINTER);

  const termPid = await terminalPanel(win);
  await inFailureState(win, termPid, 'terminal');
  await expect(banner(win, termPid)).toContainText(POINTER);

  // The transitional sentence is GONE, not merely joined — a banner carrying both would be pointing
  // at two routes and committing to neither.
  expect(await banner(win, termPid).innerText()).not.toContain('diagnostic log');
});

/**
 * T056c — the editor's banner still NAMES THE PATH IT COULD NOT READ (FR-040a).
 *
 * 027 (#161) FR-011 makes this load-bearing rather than decorative: an editor holding a recovered
 * buffer over a path throng could not open looks entirely ordinary, and a Ctrl+S would write the
 * remembered text back over that path. "Delegate the detail to the notice" is the obvious way to
 * lose it while the banner still looks right, which is why it is asserted on its own.
 */
test('the editor banner names the file it could not read', async () => {
  test.setTimeout(240_000);
  const win = h.win;

  const editorPid = await editorPanel(win);
  await inFailureState(win, editorPid, 'editor');
  await expect(banner(win, editorPid)).toContainText('code.txt');
  // The headline says what could not be done, in the editor's own words (FR-040, contract).
  await expect(banner(win, editorPid)).toContainText('This file could not be read');
});

/**
 * T056a / T069apre — ALL THREE controls are reachable and OPERABLE by keyboard, in the order they
 * are displayed (FR-042a, the banner half of SC-009a).
 *
 * Focus first, then Tab, then a real key on the control — the idiom `notice-a11y.e2e.ts` uses. Each
 * step answers a different question, and none of them answers the others:
 *   • focus() lands        → the control is focusable at all
 *   • Tab walks the set    → the DISPLAYED order IS the tab order, and no control traps focus
 *   • Enter activates      → it is a real button, not a div with an onClick a keyboard cannot reach
 *
 * The traversal is re-run across the whole set rather than the pair US4 could reach: a control
 * inserted in the MIDDLE is exactly the change that can leave the tab order disagreeing with the
 * drawn order, and FR-042a/SC-009a name the copy control explicitly.
 *
 * Enter goes to *Try again*, never to *Clear panel type*: the retry cannot succeed (the folder is
 * still gone), so the panel is in exactly the same state afterwards and the tests after this one are
 * unaffected. A blind Enter at Clear would silently clear the panel type and leave the rest of the
 * file failing in a file it is not about.
 */
test('the banner controls are reachable and operable by keyboard, in displayed order', async () => {
  test.setTimeout(240_000);
  const win = h.win;

  const editorPid = await editorPanel(win);
  await inFailureState(win, editorPid, 'editor');
  const retry = control(win, editorPid, 'Try again');
  const copy = control(win, editorPid, 'Copy details');
  const clear = control(win, editorPid, 'Clear panel type');
  for (const c of [retry, copy, clear]) await expect(c).toBeVisible();

  // None has been taken out of the tab order — the quiet way an icon button stops being reachable.
  for (const c of [retry, copy, clear]) {
    expect(await c.evaluate((el) => (el as HTMLElement).tabIndex)).toBeGreaterThanOrEqual(0);
    await expect(c).toBeEnabled();
  }

  await retry.focus();
  await expect
    .poll(() => win.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '(none)'))
    .toBe('Try again');

  // Tab walks the SET, in the displayed order — the assertion the middle insertion could break.
  for (const next of ['Copy details', 'Clear panel type']) {
    await win.keyboard.press('Tab');
    await expect
      .poll(() => win.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '(none)'), {
        message: `Tab did not reach ${next} — the tab order is not the displayed order`,
      })
      .toBe(next);
  }

  /*
   * Operable: Enter on the focused control really retries, and the retry really fails (FR-045).
   *
   * Asserted as "the banner's text CHANGED, and now says the retry failed". The headline already
   * contains "could not", so matching that alone would pass against a banner that did nothing at
   * all — the same shape of false green a `toHaveCount(0)` on a dead id gives. `still` and `failed`
   * appear in neither the headline nor the pointer sentence, and the controls carry their names as
   * attributes rather than as text.
   */
  const beforeRetry = await banner(win, editorPid).innerText();
  await retry.press('Enter');
  await expect(banner(win, editorPid)).toBeVisible();
  await expect
    .poll(() => banner(win, editorPid).innerText(), {
      timeout: 20_000,
      message: 'a keyboard retry changed nothing on the banner — it may not have run at all',
    })
    .not.toBe(beforeRetry);
  await expect(
    banner(win, editorPid),
    'a keyboard retry that failed said nothing about having failed',
  ).toContainText(/still|failed/i);
});

/**
 * T056b / T069bpre — ALL THREE banner commands are also COMMANDS IN THE PANEL'S OWN MENU (FR-042c).
 *
 * A discrete command acting on a Panel that exists only as an icon on a banner is unreachable from
 * where users look for panel commands; 029 FR-004d set the precedent for the terminal, and the
 * editor half is new work, which binds it in the same increment.
 *
 * WHERE EACH MENU IS OPENED, and why they are different surfaces:
 *   • TERMINAL — a right-click on the panel BODY, the route `terminal-start-failure-controls.e2e.ts`
 *     established. The badge is a sibling with no handler of its own, so a right-click on it bubbles
 *     past and opens nothing.
 *   • EDITOR — a right-click on the panel HANDLE, which is where `Send to Tab` and `Destroy Panel`
 *     already live (`editor-menus.e2e.ts`). That is the editor panel's own menu.
 *
 * *Copy details* is not exempt for being "just a copy button": it is a discrete command acting on a
 * Panel, which is the whole test the rule applies, and a banner-only copy control is unreachable to
 * anyone who does not recognise the glyph.
 */
test('Try again, Copy details and Clear panel type are in the panel menu, for both panel types', async () => {
  test.setTimeout(240_000);
  const win = h.win;
  const menuItem = (label: string): Locator => win.getByTestId(`menu-item-${label}`);

  // ── Editor ─────────────────────────────────────────────────────────────────────────────────
  const editorPid = await editorPanel(win);
  await inFailureState(win, editorPid, 'editor');
  await expect(banner(win, editorPid)).toBeVisible();
  await win.getByTestId(`panel-handle-${editorPid}`).click({ button: 'right' });
  await expect(win.getByTestId('context-menu')).toBeVisible();
  await expect(menuItem('Try again')).toBeVisible();
  await expect(menuItem('Copy details')).toBeVisible();
  await expect(menuItem('Clear panel type')).toBeVisible();
  // Dismissed by clicking away, not by Escape — `context-menu.e2e.ts:113`'s pattern, and the one
  // that measurably beat a 10s Escape budget in `terminal-start-failure-controls.e2e.ts`.
  await win.getByTestId('tab-body').click({ position: { x: 5, y: 5 } });
  await expect(win.getByTestId('context-menu')).toHaveCount(0);

  // ── Terminal ───────────────────────────────────────────────────────────────────────────────
  const termPid = await terminalPanel(win);
  await inFailureState(win, termPid, 'terminal');
  await expect(banner(win, termPid)).toBeVisible();
  await win.locator('.panel-box').first().click({ button: 'right', position: { x: 20, y: 120 } });
  await expect(win.getByTestId('context-menu')).toBeVisible();
  await expect(menuItem('Try again')).toBeVisible();
  await expect(menuItem('Copy details')).toBeVisible();
  await expect(menuItem('Clear panel type')).toBeVisible();
  await win.getByTestId('tab-body').click({ position: { x: 5, y: 5 } });
  await expect(win.getByTestId('context-menu')).toHaveCount(0);
});

/**
 * T054 — CANCEL, in both panel types. Runs LAST of the shared-app tests: it clears both.
 *
 * FR-043 is the new capability, and SC-010 is the claim it makes: an editor panel that failed can be
 * returned to panel-type selection WITHOUT being destroyed. `core/src/editor/panel-type.ts` records
 * that `clearPanelType` was never wired for editors, so today the only way out of a stranded editor
 * is to destroy the panel and lose its position and its name.
 *
 * FR-044 is the opposite claim: the terminal's behaviour must not move at all. 029 FR-004a made
 * clearing the user's decision rather than something that happened to them, and this feature must
 * not undo that while tidying the markup around it.
 */
test('Clear panel type returns an editor to panel-type selection, and a terminal behaves as it did', async () => {
  test.setTimeout(240_000);
  const win = h.win;

  // ── Editor: the panel SURVIVES (FR-043 / SC-010). ──────────────────────────────────────────
  const editorPid = await editorPanel(win);
  await inFailureState(win, editorPid, 'editor');
  const box = win.locator('.panel-box').first();
  const idBefore = await box.getAttribute('data-panel-id');
  await expect(win.getByTestId(`panel-handle-${editorPid}`)).toContainText('Docs');

  const clear = control(win, editorPid, 'Clear panel type');
  await expect(clear).toBeVisible();
  await clear.click();

  await expect(win.getByTestId(`panel-type-form-${editorPid}`)).toBeVisible({ timeout: 20_000 });
  await expect(banner(win, editorPid)).toHaveCount(0);
  // Same panel, same place, same name — cleared, not destroyed and recreated.
  expect(await win.locator('.panel-box').first().getAttribute('data-panel-id')).toBe(idBefore);
  await expect(win.locator('.panel-box')).toHaveCount(1);
  await expect(win.getByTestId(`panel-handle-${editorPid}`)).toContainText('Docs');

  // ── Terminal: exactly 029's behaviour, unchanged (FR-044). ──────────────────────────────────
  const termPid = await terminalPanel(win);
  await inFailureState(win, termPid, 'terminal');
  const termIdBefore = await win.locator('.panel-box').first().getAttribute('data-panel-id');
  const termClear = control(win, termPid, 'Clear panel type');
  await expect(termClear).toBeVisible();
  await termClear.click();
  await expect(win.getByTestId(`panel-type-form-${termPid}`)).toBeVisible({ timeout: 20_000 });
  await expect(banner(win, termPid)).toHaveCount(0);
  expect(await win.locator('.panel-box').first().getAttribute('data-panel-id')).toBe(termIdBefore);
});

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * OWN-APP TESTS — one needs a config root seeded before launch, the other needs a workspace it is
 * free to repair and re-break without the shared app's later tests inheriting the wreckage.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * T055 — RETRY, and the two ways a banner ends (FR-045, FR-046).
 *
 * Four facts, in the one order that lets each be observed:
 *   1. a retry that FAILS leaves the banner up and says the retry failed;
 *   2. there is NO way to dismiss it while the condition holds — stated as the exhaustive control
 *      set, so it cannot pass by matching nothing;
 *   3. a condition that clears while the panel is NOT VISIBLE takes the banner with it — FR-046's
 *      untested second half, and the reason this is not simply "press retry twice";
 *   4. a retry that SUCCEEDS clears the banner along with the condition.
 *
 * (3) is the one worth spelling out. The panel is parked behind a second tab, the folder is put back
 * while nothing is mounted to notice, and the banner must be gone when the user returns — not still
 * standing over a path that reads perfectly well, and not waiting for a retry the user has no reason
 * to press. That is the state 027/#161 was reported as, from the other direction.
 *
 * ══ WHY (4) IS ON A TERMINAL AND THE REST ARE ON AN EDITOR ══
 *
 * Not variety — determinism. 027's fix made the editor watch a missing path and recover BY ITSELF
 * the moment it comes back, which is exactly (3). So "restore the file, then press Try again" is a
 * race between the user's click and an auto-recovery that is trying to win it, and whichever way it
 * lands the assertion is about the wrong mechanism. A terminal whose project root does not exist has
 * no such watcher: create the folder and NOTHING happens until Try again is pressed. That makes the
 * click the only possible cause of the banner going, which is the whole of what FR-045 claims.
 */
test('retry clears the banner on success, reports failure on failure, and a hidden repair still ends it', async () => {
  test.setTimeout(300_000);
  const root = makeRealRoot('throng-pfb-retry-');
  // Deliberately NOT created: the terminal half needs a project root that comes into existence
  // between the failure and the retry, and nothing else may bring it back.
  const laterRoot = join(tmpdir(), `throng-pfb-later-${Date.now()}`);
  try {
    await runOwnApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'Retry', root);
      const pid = await firstPanelId(win);
      await editorOn(win, pid);

      // A second tab, so the panel can be genuinely out of sight later. Made now, while the editor
      // still works, so nothing about the failure has to survive a tab creation.
      await win.getByTestId('tab-add').click();
      const chips = win.getByTestId('tab-strip').locator('.tab-chip');
      await expect(chips).toHaveCount(2, { timeout: 20_000 });
      await chips.nth(1).click();

      // Break the path with the editor unmounted, then come back to it: `unloadable`, not dirty.
      renameSync(join(root, 'src'), join(root, 'src-moved'));
      await chips.first().click();
      const brokenPid = await firstPanelId(win);
      await inFailureState(win, brokenPid, 'editor');
      await expect(banner(win, brokenPid)).toBeVisible();

      // ═══ 2 — NOT DISMISSIBLE (FR-046), as the complete list of what the banner offers. ═══
      expect(
        await controlNames(win, brokenPid),
        'the banner offers a way to close itself while its condition still holds',
      ).toEqual(['Try again', 'Copy details', 'Clear panel type']);

      // ═══ 1 — a retry that FAILS says so, and the banner stays. ═══
      //
      // "The text changed" first: the headline already contains "could not", so a message assertion
      // on its own would pass against a retry that never ran.
      const retry = control(win, brokenPid, 'Try again');
      await expect(retry).toBeVisible();
      const beforeRetry = await banner(win, brokenPid).innerText();
      await retry.click();
      await expect(banner(win, brokenPid)).toBeVisible();
      await expect
        .poll(() => banner(win, brokenPid).innerText(), {
          timeout: 20_000,
          message: 'the retry changed nothing on the banner — it may not have run at all',
        })
        .not.toBe(beforeRetry);
      await expect(
        banner(win, brokenPid),
        'the retry failed and the banner said nothing about it (FR-045)',
      ).toContainText(/still|failed/i);

      // ═══ 3 — the condition clears while the panel is NOT VISIBLE. ═══
      await chips.nth(1).click();
      await expect(win.getByTestId(`editor-${brokenPid}`)).toHaveCount(0);
      renameSync(join(root, 'src-moved'), join(root, 'src'));
      await chips.first().click();
      const returnedPid = await firstPanelId(win);
      // A negative on the same locator this test has already asserted VISIBLE twice above, which is
      // what stops it from being satisfied by a banner that never existed. The content assertion
      // below is the second, independent witness that the condition really did clear.
      await expect(
        banner(win, returnedPid),
        'the path came back while the panel was hidden, and the banner outlived its own condition',
      ).toHaveCount(0, { timeout: 30_000 });
      // …and it is the FILE that is on screen again, not a banner-less stale buffer.
      await expect(win.getByTestId(`editor-${returnedPid}`).locator('.cm-content')).toContainText(
        'ORIGINAL-CONTENT',
        { timeout: 30_000 },
      );

      // ═══ 4 — and a retry that SUCCEEDS ends the banner, on a condition only it can end. ═══
      //
      // A second project whose root does not exist yet. The terminal cannot start; the folder is
      // then created; and nothing in throng is watching for it, so the banner stands until Try again
      // is pressed. See the header for why this half cannot be done on an editor.
      await createProject(win, 'Later', laterRoot);
      const laterPid = await firstPanelId(win);
      await failingTerminalOn(win, laterPid);
      await expect(banner(win, laterPid)).toBeVisible();

      mkdirSync(laterRoot, { recursive: true });
      const retrySucceeds = control(win, laterPid, 'Try again');
      await expect(retrySucceeds).toBeVisible();
      await retrySucceeds.click();

      // The banner goes WITH the condition — and the terminal really did start, so this is a
      // success rather than a banner that gave up.
      await expect(banner(win, laterPid)).toHaveCount(0, { timeout: 60_000 });
      await expect(win.getByTestId(`terminal-${laterPid}`)).toContainText(basename(laterRoot), {
        timeout: 60_000,
      });
    });
  } finally {
    cleanupTemp(root);
    cleanupTemp(laterRoot);
  }
});

/**
 * T056 — THE BANNER IS NOT A NOTIFICATION, AND THE PREFERENCES CANNOT SILENCE IT (FR-005a/FR-041).
 *
 * US1 gave the user a switch that turns a whole severity off. The banner must be outside its reach:
 * it is a statement about a panel's condition, not an announcement of an event, and a panel that
 * silently pretended to be fine is precisely the failure 027/#161 reported.
 *
 * Seeded through the CONFIG ROOT rather than through the Preferences window — deliberately. Driving
 * the preferences UI would make this test depend on US1's controls to make a claim about US4's
 * component, and would open a second window whose focus theft is the very thing `parallel-plan.json`
 * exists to contain. All four severities, not just `error`: the point is that no setting reaches it.
 *
 * The absent notice is asserted SECOND, after the banner is on screen, so a run where nothing at all
 * happened cannot read as a pass.
 */
test('the banner appears with every severity set to Never display', async () => {
  test.setTimeout(240_000);
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-pfb-cfg-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({
      version: 1,
      notifications: {
        error: { mode: 'never', timeoutMs: 60000 },
        warning: { mode: 'never', timeoutMs: 60000 },
        info: { mode: 'never', timeoutMs: 60000 },
        success: { mode: 'never', timeoutMs: 60000 },
      },
    }),
    'utf8',
  );
  try {
    await runOwnApp(
      async (_app, win) => {
        await settle(win);
        await createProject(win, 'Silenced', ghostRoot('silenced'));
        const pid = await firstPanelId(win);
        await failingTerminalOn(win, pid);

        // The banner is there, whole — headline, pointer and all three controls.
        await expect(banner(win, pid)).toBeVisible({ timeout: 90_000 });
        expect(await controlNames(win, pid)).toEqual([
          'Try again',
          'Copy details',
          'Clear panel type',
        ]);

        /*
         * T069pre — THE FINAL POINTER SENTENCE, ASSERTED WHERE IT HAS TO BE TRUE.
         *
         * FR-041 forbids a pointer from promising a route that may not exist, and this is the case
         * that decides it: every severity is *Never display*, so there is no notice and never was
         * one. The sentence leads with Copy for exactly that reason — and the assertion below proves
         * the notice really is absent, so this is the sentence being read in the state it was
         * written for rather than in a comfortable one.
         */
        await expect(banner(win, pid)).toContainText('Copy the details here, or see the notification.');

        // …and it is genuinely alone: every severity is off, so no notice is on screen to have
        // carried the news instead. This is what FR-041 forbids the pointer from promising.
        await expect(win.getByTestId('notices').locator('.notice')).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfgRoot } },
    );
  } finally {
    cleanupTemp(cfgRoot);
  }
});
