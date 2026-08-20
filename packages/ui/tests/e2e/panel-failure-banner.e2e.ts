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
 * SETUP GATE — WAIT until the panel has reached its failure state, before acting on it.
 *
 * This began as a UNION of the shared banner and the two per-type surfaces it replaces, so that a
 * red in the RED half could be read as "the banner is missing" rather than "the app never got the
 * panel into trouble". T060a/T062 deleted that markup, so `editor-unloadable-{pid}` and
 * `terminal-start-failed-{pid}` name nothing and the union's second arm could only ever match
 * nothing — which made the "this is a SETUP failure, not the banner" message misleading, because
 * the two are now the same element. `default-themes.e2e.ts:181` records the same cleanup.
 *
 * It stays as a named function rather than dissolving into `expect(banner(…)).toBeVisible()` at
 * every call site, because what it carries is the 90-second budget: a terminal start failure has to
 * go out to the daemon and back, and every caller needs the same wait before it acts.
 */
async function inFailureState(win: Page, panelId: string, kind: 'editor' | 'terminal'): Promise<void> {
  await expect(
    win.locator(`[data-testid="panel-failure-${panelId}"]`),
    `panel ${panelId} never reached its ${kind} failure state`,
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
/*
 * MOVED to `packages/ui/tests/component/panel-failure-banner.test.ts` (034 FR-045) — five tests:
 *   - the editor and terminal banners share a root class, a role and a control set (FR-039, SC-009)
 *   - both point at their own Copy control, in the same words (FR-041, FR-051)
 *   - the editor names the file it could not read (FR-040a)
 *   - the editor says the text below is not the file, and the terminal says no such thing (026 P3)
 *   - every control is reachable by Tab, in displayed order, and operable from the keyboard
 *
 * `PanelFailureBanner` was ALREADY an exported component taking props — no production change was
 * needed, only a `NotificationProvider` around it, because `useCopyToClipboard` reaches `useNotify`
 * and that hook throws rather than defaulting. Five app launches, and a real unreadable file and a
 * real failed shell to produce them, for questions about markup that render in jsdom.
 *
 * The structural argument survives intact, which mattered more than the saving. This file's own
 * reasoning is that two independently-written banners can agree on their LABELS by coincidence and
 * cannot agree on a CLASS LIST by accident, so it compared class list, role and control names
 * rather than words. The component test compares exactly the same three things — and that claim is
 * as true in jsdom as in Electron, because it is a claim about two calls to one component.
 *
 * Ten tests replace the five, adding what was too expensive to ask before: that there are exactly
 * three controls and none of them is a dismiss or a close (FR-046 — *Clear panel type* is not a
 * close button), and that the raw system error NEVER renders (FR-034), which reaches the user only
 * through Copy and the diagnostic log.
 *
 * Red-proved, six mutations, six reds: dropping the path, dropping the per-type note, leaking the
 * system error into the pointer line, removing the Copy control, making Clear panel type inert, and
 * giving the terminal a different root class. Two of the six needed re-aiming for CRLF before they
 * applied at all.
 *
 * WHAT STAYS BELOW: everything about the banner's CONDITION and its wiring — that a real unreadable
 * file and a real failed shell raise it, that its three actions also appear in the panel menu, that
 * Try again from the menu reports a failed retry, that Clear panel type returns an editor to the
 * type selector, that a retry which SUCCEEDS makes the banner go (the caller drops it, not this
 * component), and that it appears with every severity set to Never display.
 */

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

/**
 * T056c — the editor's banner still NAMES THE PATH IT COULD NOT READ (FR-040a).
 *
 * 027 (#161) FR-011 makes this load-bearing rather than decorative: an editor holding a recovered
 * buffer over a path throng could not open looks entirely ordinary, and a Ctrl+S would write the
 * remembered text back over that path. "Delegate the detail to the notice" is the obvious way to
 * lose it while the banner still looks right, which is why it is asserted on its own.
 */

/**
 * 026 `contracts/editor-unloadable.md` P3 — THE TEXT UNDER THE BANNER IS NOT THE FILE.
 *
 * ══ WHY THIS TEST EXISTS ══
 *
 * Because its absence let a shipped requirement be deleted in silence. `unloadable-banner.tsx` said
 * *"What is shown here is not the file. Restore the path and it reloads by itself, or reload it
 * now."*; the shared banner renders headline + path + pointer, so the migration had nowhere to put
 * it and it went. Every test that touched the editor's failure state — this file's own path test,
 * `editor-stranded-recovery.e2e.ts` and `editor-stranded-restart.e2e.ts` — asserted visibility and
 * the path, which is exactly the part that survived.
 *
 * ══ WHY IT IS NOT MERELY WORDING ══
 *
 * `unloadable` guards NO save path in the renderer: 026 P6's save-while-unloadable confirmation is
 * not implemented here. So this sentence is the only thing in the panel warning that a Ctrl+S will
 * write a REMEMBERED buffer back over a path throng could not read — the same scenario FR-040a
 * gives as its own reason for keeping the path visible. Losing it leaves the path on screen and the
 * reason for looking at it gone.
 *
 * ══ AND IT IS PER-TYPE, WHICH IS THE OTHER HALF ══
 *
 * The terminal must NOT acquire it. A terminal that could not start has no remembered buffer and
 * nothing on screen pretending to be one, so the sentence would be false there — and a note that
 * appeared in both panel types would be the shared component's wording rather than the editor's,
 * which is how the two banners start diverging in content while agreeing in shape.
 */

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

/*
 * ONE TEST REMOVED (035 T055) — "Try again, Copy details and Clear panel type are in the panel menu,
 * for both panel types", now `packages/ui/tests/unit/menu-icon-tokens.test.ts`.
 *
 * It spent a 240-second budget driving a real editor into a real unreadable-file state and a real
 * terminal into a real start failure, then right-clicked each and dismissed each menu — to check
 * that three labels were present, twice.
 *
 * Both menus gate those rows on a plain boolean: `editorFailure` for the panel header,
 * `startFailure` for the terminal content menu. Producing the failure was the expensive half, and it
 * is not the claim.
 *
 * ── STRONGER THERE, AND THE REASON IS THE INTERESTING PART ──
 *
 * Every assertion this test made was a PRESENCE check against a panel it had deliberately broken
 * first. A builder that emitted those three rows unconditionally would have passed it completely —
 * while offering "Try again" to a panel with nothing wrong. The unit version asserts the negative
 * for both panel types, and that is the case `editor-rows-always` reddens and nothing else does.
 *
 * It also asserts FR-042d directly: both surfaces name the commands IDENTICALLY. This test wrote the
 * same three literals twice, which happens to check that without saying so.
 *
 * Red-proven: editor-rows-gone (2 red), editor-rows-always (1 red — the negative case),
 * label-drift (2 red).
 */

/**
 * FR-042c × FR-045 — A RETRY FROM THE **MENU** REPORTS ITS FAILURE, IN BOTH PANEL TYPES.
 *
 * ══ THE DEFECT ══
 *
 * FR-042c makes the menu item the SAME command as the banner's control; FR-045 requires a failed
 * retry to remain and say so. Each menu ran the underlying operation directly instead — the editor's
 * `getEditorActions(id).reloadFromDisk()`, the terminal's `retryStart()` — so neither ever reached
 * the banner's retry state. The re-attempt really happened and the banner said nothing about it: the
 * user is left with a banner that has not moved and no way to tell a retry that failed from a click
 * that never landed. `terminal-panel.tsx` records that exact "did my click do anything?" failure as
 * the reason the design exists, so the requirement held on the button and nowhere else.
 *
 * The test above asserts the menu items EXIST. Existence is what was already true; this asserts they
 * are the same command.
 *
 * ══ WHY EACH HALF STARTS BY SWITCHING PROJECTS ══
 *
 * NOT to reach the panel — to REMOUNT it. The retry-failure sentence is the banner's own state, and
 * two earlier tests in this serial file leave it showing on the editor's banner. Asserting it after a
 * menu click would then pass against a banner that ignored the click completely, which is the same
 * vacuous green this whole file is written to avoid. Throng mounts one project's workspace at a
 * time, so `terminalPanel` → `editorPanel` unmounts and rebuilds the banner, and the assertion that
 * the sentence is ABSENT first is what makes its later presence mean something.
 */
test('Try again from the panel MENU reports a failed retry, in both panel types', { tag: ['@extended', '@window'] }, async () => {
  test.setTimeout(240_000);
  const win = h.win;
  // The fixed wording (FR-040b), asserted verbatim rather than as /still|failed/: the whole point is
  // that the menu reaches the BANNER'S state, and only the banner writes this sentence.
  const RETRY_FAILED = 'That did not work — the condition is still there.';

  // ── Editor: right-click the panel HANDLE, where its own menu lives. ─────────────────────────
  await terminalPanel(win); // leave `Real`, so entering it below rebuilds the editor's banner
  const editorPid = await editorPanel(win);
  await inFailureState(win, editorPid, 'editor');
  await expect(
    banner(win, editorPid),
    'the banner came back already reporting a failed retry — this test cannot prove anything',
  ).not.toContainText(RETRY_FAILED);

  await win.getByTestId(`panel-handle-${editorPid}`).click({ button: 'right' });
  await expect(win.getByTestId('context-menu')).toBeVisible();
  await win.getByTestId('menu-item-Try again').click();
  await expect(win.getByTestId('context-menu')).toHaveCount(0);

  // The folder is still gone, so the re-read fails — and the banner has to SAY so, exactly as it
  // does when its own icon is pressed.
  await expect(banner(win, editorPid)).toBeVisible();
  await expect(
    banner(win, editorPid),
    'a menu retry that failed left the banner standing in silence (FR-042c/FR-045)',
  ).toContainText(RETRY_FAILED, { timeout: 20_000 });

  // ── Terminal: right-click the panel BODY, the route 029 established. ────────────────────────
  // Coming from `Real`, so this switch IS the terminal panel's remount — its banner is new, and the
  // absence assertion below is a fact about it rather than about whatever the last test left behind.
  const termPid = await terminalPanel(win);
  await inFailureState(win, termPid, 'terminal');
  await expect(banner(win, termPid)).not.toContainText(RETRY_FAILED);

  await win.locator('.panel-box').first().click({ button: 'right', position: { x: 20, y: 120 } });
  await expect(win.getByTestId('context-menu')).toBeVisible();
  await win.getByTestId('menu-item-Try again').click();
  await expect(win.getByTestId('context-menu')).toHaveCount(0);

  await expect(banner(win, termPid)).toBeVisible();
  await expect(
    banner(win, termPid),
    'a menu retry that failed left the banner standing in silence (FR-042c/FR-045)',
  ).toContainText(RETRY_FAILED, { timeout: 60_000 });
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
test('Clear panel type returns an editor to panel-type selection, and a terminal behaves as it did', { tag: ['@extended', '@window'] }, async () => {
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
test('retry clears the banner on success, reports failure on failure, and a hidden repair still ends it', { tag: ['@extended', '@window'] }, async () => {
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
test('the banner appears with every severity set to Never display', { tag: ['@extended', '@window'] }, async () => {
  test.setTimeout(240_000);
  const cfgRoot = mkdtempSync(join(tmpdir(), 'throng-pfb-cfg-'));
  writeFileSync(
    join(cfgRoot, 'settings.json'),
    JSON.stringify({
      version: 1,
      notifications: {
        error: { mode: 'never', timeoutMs: 30000 },
        warning: { mode: 'never', timeoutMs: 30000 },
        info: { mode: 'never', timeoutMs: 30000 },
        success: { mode: 'never', timeoutMs: 30000 },
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
