import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { LINK_HINT_MS } from '@throng/core';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  charPoint,
  cleanupTemp,
  linkMarkedText,
  narrowTerminalWindow,
  openedPaths,
  runTypedCommand,
  stayedAbsent,
  TYPE_DELAY,
  TERMINAL_OUTPUT_TIMEOUT_MS,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { osc8HalfRuns, skipIfElevated } from './admin.js';

/*
 * ONE app for this file, not one per test.
 *
 * Each test used to launch its own Electron app, daemon and window — roughly two seconds apiece, and
 * 604 such launches across the suite — to run assertions that never needed a pristine app. Only a
 * test that seeds state BEFORE launch genuinely does, and those keep their own app via `runOwnApp`.
 *
 * The shims below exist so the test bodies below are unchanged:
 *   runApp        runs the body against the shared window. It refuses options rather than ignoring
 *                 them: a dropped config root does not fail, it passes for the wrong reason.
 *   createProject appends a counter, because a shared app accumulates projects and duplicate names
 *                 make `.project-item` ambiguous.
 *
 * Serial mode is required — shared window, shared database — and it means a failure skips the rest
 * rather than running them against whatever state the failure left behind.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win'], ctx: { pipeName: string; userDataDir: string }) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win, {
    pipeName: shared.pipeName,
    userDataDir: shared.userDataDir,
  });
};

let projectSeq = 0;
const createProject = (win: OpenApp['win'], name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);


/**
 * 026 / #198 — one Ctrl+click on a terminal link opens the browser exactly once.
 *
 * ══ RESOLVED (2026-09-17) — the sixth case at the end of this file ══
 *
 * The second open was never throng's. Claude Code's full-screen UI arms mouse reporting and opens a
 * link it is Ctrl+clicked on, and xterm forwarded that press to it while also activating the link
 * itself. None of the five cases below armed the mouse, which is why each saw exactly one open. The
 * sixth does, and asserts the press is no longer forwarded. The history below is kept because it
 * records what was ruled out, and how.
 *
 * ══ READ THIS BEFORE FIXING #198 ══
 *
 * These cases PASS on this branch. That is not an oversight, and they are not written as
 * red tests, because **the reported double-open does not reproduce here**. Measured twice, both
 * times exactly ONE `shell.openExternal` per Ctrl+click:
 *   - `08d0fdc`, Windows PowerShell, normal screen buffer — the original four cases.
 *   - `a5dfd00` (2026-09-05), all FIVE cases including the alternate screen, 5/5 in 15.7s at one
 *     worker with retries off. Re-measured because the first figure predated twenty-odd commits to
 *     `use-terminal.ts`, `main.ts` and the window-open guard, which made it evidence about a tree
 *     nobody was running any more.
 *
 * The issue's stated cause is a code reading, not a count. It observes that two link mechanisms are
 * registered on the same terminal and both route to `openTerminalLink` — xterm's `linkHandler`
 * (OSC 8, now `use-terminal.ts:404`) and `WebLinksAddon` (plain-text detection, now `:779`; the
 * issue cites `:364` and `:526`, which the file has long since moved past) — and infers that cells
 * satisfying both must fire both. xterm 6 does not work that way. Both mechanisms are registered
 * link PROVIDERS on ONE `Linkifier`: `OscLinkProvider` is registered by the terminal itself at
 * index 0, `WebLinksAddon` calls `registerLinkProvider` after it, `_checkLinkProviderResult` only
 * uses a provider's link when every higher-priority provider came back empty, and `_handleMouseUp`
 * activates the single `_currentLink` once. The OSC 8 link wins and the addon's is dropped, so the
 * two mechanisms cannot both fire for one click on one set of cells.
 *
 * So the reported behaviour is real — it was observed — but its cause is somewhere this branch
 * does not reach. Every candidate has since been eliminated, and none by a fix:
 *   - ~~The ALTERNATE screen buffer~~ — the fifth case below drives a full-screen program that takes
 *     the alt screen and prints an OSC 8 link into it; still exactly once.
 *   - ~~A doubled `openExternal` upstream~~ — by reading. The window-open guard routes to
 *     `shell.openExternal` only from `setWindowOpenHandler`, which fires for `window.open`;
 *     `openTerminalLink` calls the IPC seam directly and never opens a window. That seam's
 *     `ipcMain.on` is registered once, inside `app.whenReady()`. throng's own hover tip is a
 *     `role=tooltip` div with no click handler.
 *   - ~~Two adjacent links under one pointer~~ (an OSC 8 link followed by the bare URL, which would
 *     be two legitimate targets) — the reporter confirmed on 2026-09-05 that **both tabs showed the
 *     SAME url**. So it was one link opened twice, not two links opened once each.
 *   - ~~The xterm upgrade fixed it~~ — the obvious "fixed elsewhere" theory, and it is FALSE.
 *     `@xterm/xterm` has been `^6` since the repository's first commit (285d2cab, 2026-07-07), three
 *     weeks BEFORE this was filed, so the single-`_currentLink` de-duplication was present the whole
 *     time. The doubling happened despite it.
 *
 * ══ Where that leaves it ══
 *
 * Unreproducible by the reporter as of 2026-09-05, and unreproducible here. No commit between the
 * report and now touches link activation: the only changes to `use-terminal.ts` in that window are
 * 028's redraw/keys, 029's failure paths, 033's settings, #295's title-on-unmount and #290's
 * keyboard-mode ownership. **So "it was fixed elsewhere" has no evidence behind it, and this file
 * does not claim it.**
 *
 * Two explanations survive that the suite cannot distinguish, both worth checking FIRST if it ever
 * recurs, because neither is a defect in the code these fences cover:
 *   - **Two physical mouseups for one intended click.** xterm activates on a mouseup matching its
 *     mousedown, so a doubled click — a failing mouse micro-switch, an accessibility or driver
 *     setting — is two legitimate activations of one link, and would look exactly like this.
 *   - **A transient second live view of the same panel**, each with its own xterm and its own
 *     Linkifier. Nothing found says this happened, and one click reaches one element, so it is the
 *     weaker of the two.
 *
 * What these five fences are FOR is therefore unchanged and, if anything, sharper: they pin "exactly
 * once" at the `shell.openExternal` seam so a regression that genuinely doubles it fails loudly,
 * rather than being argued about from a code reading again.
 *
 * What these tests are therefore FOR: they pin "exactly once" at the `shell.openExternal` seam for
 * every link shape, so that whatever the fix turns out to be, it cannot double any of them, and
 * cannot fix the OSC 8 case by breaking plain-text detection (or vice versa). Fixing #198 by
 * de-duplicating blindly is the specific risk they exist to catch — and with the mechanism above
 * established, a de-duplicating fix would not be removing a second open, it would be papering over
 * whichever one is real.
 *
 * ══ On the gesture ══
 *
 * `mouse.click(x, y, { modifiers: ['Control'] })` does NOT activate an xterm link — it records
 * zero opens. xterm arms `_mouseDownLink` from `_currentLink` on mousedown and only activates on
 * mouseup if the two still agree, so the pointer must genuinely rest on the link first. The
 * explicit move → down → up below is the gesture that works; anything shorter tests nothing, and
 * silently.
 */

/** Record every `shell.openExternal` the main process performs, and stop it reaching a browser. */
async function captureOpens(app: ElectronApplication): Promise<{
  urls: () => Promise<string[]>;
  reset: () => Promise<void>;
}> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened?: string[] };
    g.__opened = [];
    shell.openExternal = (url: string) => {
      g.__opened!.push(url);
      return Promise.resolve();
    };
  });
  return {
    urls: () => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? []),
    reset: () =>
      app.evaluate(() => {
        (globalThis as { __opened?: string[] }).__opened = [];
      }),
  };
}

/**
 * A PowerShell script that prints one OSC 8 hyperlink: `ESC ]8;; <uri> ST <text> ESC ]8;; ST`.
 *
 * Written to a FILE and invoked as `.\lnk.ps1` on purpose. Typing the sequence at the prompt puts
 * the URL into the echoed command line, and a wait on the URL then matches the echo rather than the
 * output — the test proceeds before the link exists and clicks on the typed text instead. That is
 * exactly how the first draft of this spec failed for the wrong reason.
 */
function writeLinkScript(root: string, uri: string, text: string): void {
  const esc = '$e';
  writeFileSync(
    join(root, 'lnk.ps1'),
    `$e=[char]27\nWrite-Host ("${esc}" + "]8;;${uri}" + "${esc}" + "\\" + "${text}" + "${esc}" + "]8;;" + "${esc}" + "\\")\n`,
  );
}

/** A PowerShell script that prints a bare URL — no OSC 8 wrapper, addon detection only. */
function writePlainScript(root: string, uri: string): void {
  writeFileSync(join(root, 'lnk.ps1'), `Write-Host "${uri}"\n`);
}

/** Open a PowerShell terminal in the first panel and wait for its prompt. */
async function openTerminal(win: Page, root: string): Promise<Locator> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
  const confirm = win.getByTestId(`panel-type-confirm-${pid}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  // The prompt shows the project root — proof the shell is live before anything is typed at it.
  await expect(term).toContainText(root.split(/[\\/]/).pop()!, { timeout: 25_000 });
  return term;
}

/**
 * Run the printed script and wait for `printed` to appear in the terminal.
 *
 * INVOKED THROUGH AN EXPLICIT POLICY BYPASS, not as a bare `.\lnk.ps1`.
 *
 * `Restricted` is the DEFAULT execution policy on Windows client, so a bare invocation only works
 * on a machine somebody has already relaxed — which a developer box usually is and a freshly
 * installed one is not. On the gate runner it produced, instead of the link:
 *
 *   .\lnk.ps1 : File ...\lnk.ps1 cannot be loaded because running scripts is disabled on this
 *   system. + FullyQualifiedErrorId : UnauthorizedAccess
 *
 * and the test then spent its whole 25s budget waiting for output that was never coming. That is an
 * undeclared dependency on machine configuration, and the fix belongs here rather than in a setup
 * document nobody re-reads: a test that passes only on a hand-configured host is one that will fail
 * on the next host, for a reason that has nothing to do with what it checks.
 *
 * The script must still be a FILE — see `writeLinkScript` above for why typing the sequence at the
 * prompt breaks the test. This changes only HOW it is launched, and deliberately keeps the URL out
 * of the typed command line, which is the property that docblock depends on.
 *
 * Typed through `runTypedCommand`, which waits for the shell to echo the script's NAME before it
 * presses Enter — so `script` must be a name this terminal has not shown yet, or that wait is met by
 * an earlier line.
 */
async function runScript(win: Page, term: Locator, printed: string, script = 'lnk.ps1'): Promise<void> {
  await runTypedCommand(win, term, `powershell -NoProfile -ExecutionPolicy Bypass -File .\\${script}`, {
    echoed: script,
    output: printed,
    timeout: 25_000,
  });
}

/**
 * A real fence for "no SECOND open occurred after this gesture" (FR-016/FR-017): run an
 * unrelated command through the SAME live shell and require its echo.
 *
 * `shell.openExternal` is reached by an IPC hop off the click's own event handling, and there is
 * no dedicated acknowledgement for "that hop, if it happened, is done" — so a positive event is
 * needed to prove the opportunity has passed, rather than a guessed idle period. A full daemon
 * round-trip (keystroke → pty → shell → echoed output → renderer) is exactly the harness's own
 * worked example of a fence ("the shell has echoed the following command" — see `stayedAbsent`'s
 * doc comment in harness.ts): falsifiable, and it throws rather than resolving if the shell has
 * stopped answering.
 */
async function fenceOnEcho(win: Page, term: Locator, marker: string): Promise<void> {
  /*
   * TYPE_DELAY, not `{ delay: 0 }`, and the first version of this fence is why.
   *
   * At zero delay the keystrokes race the PTY and arrive out of ORDER. Measured: the fence typed
   * `LINKFENCE1` and the shell echoed **`KNFILENCE1`** — the same letters, scrambled — so the
   * assertion waited out its full twenty seconds for a string that was never going to appear, and
   * the test went flaky rather than failing outright. It is the harness's default for exactly this,
   * and every other terminal spec here already uses it.
   *
   * The irony is worth leaving in the file: a fence added to make a wait honest introduced a race
   * of its own, by typing faster than the thing it was fencing on could listen.
   */
  await win.keyboard.type(`echo ${marker}`, { delay: TYPE_DELAY });
  await win.keyboard.press('Enter');
  await expect(term).toContainText(marker, { timeout: 20_000 });
}

/**
 * Click the rendered cells holding `text`, optionally with Ctrl held.
 *
 * xterm is on its DOM renderer here (no canvas/webgl addon is loaded), so the printed line is a
 * real element and its box is the click target. The row is a full terminal line, so a cell width
 * divides out of its box; clicking a few cells in lands inside the link rather than on its edge.
 */
async function clickLink(win: Page, text: string, opts: { ctrl: boolean }): Promise<void> {
  const row = win.locator('.xterm-rows > div', { hasText: text }).last();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const box = (await row.boundingBox())!;
  const cols = await win.evaluate(() => document.querySelectorAll('.xterm-rows > div')[0]?.textContent?.length ?? 80);
  const x = box.x + (box.width / Math.max(cols, 40)) * 4;
  const y = box.y + box.height / 2;

  // Rest on the link so xterm resolves it, THEN press. See the gesture note in the header.
  await win.mouse.move(x, y);
  // sleep-justified: xterm's Linkifier2 resolves the hovered link internally with no DOM signal of its own. The visible proxy is the status bar's link readout, but it appears only once throng's OWN resolution answers, which is a strictly later event than the one this wait is for — so waiting on it would couple every press to a main-process round trip that the press does not need.
  await win.waitForTimeout(300);
  if (opts.ctrl) await win.keyboard.down('Control');
  await win.mouse.down();
  await win.mouse.up();
  if (opts.ctrl) await win.keyboard.up('Control');
}

/*
 * Why this one passes on the gate's Server 2022 runner, whose ConPTY carries no OSC 8 around its text
 * (`osc8HalfRuns` in admin.ts): the link TEXT is the url, so the plain-text provider finds the same
 * url in the same cells and the Ctrl+click opens it once all the same. Its claim — exactly ONE open
 * for a url that both mechanisms could match — holds either way, so it is not guarded. The cases
 * below whose text is NOT the url (`CLICKTHELABEL`, the alt screen, the mouse-owning program) are
 * `skipIfElevated`, and every GitHub runner is elevated, which is why they have never failed there.
 */
test('Ctrl+clicking an OSC 8 link whose text IS the url opens the browser exactly once', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-link1-'));
  const url = 'https://example.com/osc8-same-text';
  try {
    writeLinkScript(root, url, url);
    await runApp(async (app, win) => {
      await createProject(win, 'LinkOnce', root);
      const term = await openTerminal(win, root);
      const opens = await captureOpens(app);
      await runScript(win, term, url);
      await opens.reset();

      await clickLink(win, url, { ctrl: true });

      await expect.poll(() => opens.urls(), { timeout: 5000 }).toEqual([url]);
      // A SECOND, later open would still be caught — fenced on a real round-trip through the
      // same terminal rather than a guessed idle period. See fenceOnEcho's doc comment.
      await fenceOnEcho(win, term, 'LINKFENCE1');
      expect(await opens.urls()).toEqual([url]);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('Ctrl+clicking a PLAIN-TEXT url opens exactly once', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-link2-'));
  // Balanced parentheses belong to the url (#198: Wikipedia's `Bash_(Unix_shell)` opened as `Bash_`).
  const url = 'https://example.com/wiki/Plain_(text_url)';
  try {
    writePlainScript(root, url);
    await runApp(async (app, win) => {
      await createProject(win, 'LinkPlain', root);
      const term = await openTerminal(win, root);
      const opens = await captureOpens(app);
      await runScript(win, term, url);
      await opens.reset();

      await clickLink(win, url, { ctrl: true });

      await expect.poll(() => opens.urls(), { timeout: 5000 }).toEqual([url]);
      // A SECOND, later open would still be caught — see fenceOnEcho's doc comment.
      await fenceOnEcho(win, term, 'LINKFENCE2');
      expect(await opens.urls()).toEqual([url]);

      /*
       * ══ 045 T186 — a Ctrl+click on the SECOND row of a wrapped link opens it exactly once ══
       *
       * FR-130 made a wrapped link one link on every row it occupies, which is two claims: it is
       * DRAWN on every row (terminal-links.e2e.ts) and it is FOLLOWED from every row, once. The
       * second row is where the two used to part company — xterm reports an OSC 8 link one row at a
       * time, and a plain-text provider that read only the physical row would find no link there at
       * all. Answers O9 for each kind: a web url, a detected path and an OSC 8 hyperlink.
       */
      await ctrlClickSecondRows(app, win, term, root, opens);
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * T186's half of the PLAIN-TEXT declaration, kept out of its body so the #198 fence above reads as it
 * always has. The window is narrowed so each link wraps, and restored afterwards: this file shares
 * one app, and every later test would otherwise run at the minimum width.
 */
async function ctrlClickSecondRows(
  app: ElectronApplication,
  win: Page,
  term: Locator,
  root: string,
  opens: { urls: () => Promise<string[]>; reset: () => Promise<void> },
): Promise<void> {
  const outside = mkdtempSync(join(tmpdir(), 'throng-link2-out-'));
  // OUTSIDE the project, so a follow is an OS reveal the harness records — an in-project file would
  // open in a throng editor, whose second open is indistinguishable from its first (FR-053).
  const outsideFile = join(outside, `wrapped_${'abcdefghij'.repeat(8)}.txt`);
  writeFileSync(outsideFile, 'outside the project\n', 'utf8');
  const web = `https://example.com/wrapped/${'uvwxyzabcd'.repeat(9)}`;
  const oscUri = 'https://example.com/osc8-wrapped-target';
  const oscText = `OSCWRAP_${'klmnopqrst'.repeat(10)}`;
  // A name of its own: `runScript` waits for the shell to echo it, and `lnk.ps1` is already on screen.
  const script = 'lnk2w.ps1';
  writeFileSync(
    join(root, script),
    [
      '$e=[char]27',
      "Clear-Host",
      "Write-Host 'WRAP2WEB'",
      `Write-Host '${web}'`,
      "Write-Host 'WRAP2PATH'",
      `Write-Host '${outsideFile}'`,
      "Write-Host 'WRAP2OSC'",
      `Write-Host ("$e" + "]8;;${oscUri}" + "$e" + "\\" + "${oscText}" + "$e" + "]8;;" + "$e" + "\\")`,
      "Write-Host 'WRAP2END'",
      '',
    ].join('\n'),
  );

  // Narrowed, and returned only once the pty has taken the new width and the prompt has answered at
  // it — typing straight into the resize lost the whole line on the gate runner (see the helper).
  const restore = await narrowTerminalWindow(app, win, term, 600, 'WIDTHSETTLED2');
  try {
    await runScript(win, term, 'WRAP2END', script);
    await win.mouse.move(2, 2);
    const rows = win.locator('.xterm-rows > div');
    const texts = (await rows.allTextContents()).map((t) => t.replace(/\u00a0/g, ' ').trimEnd());
    /** The screen index of a link's SECOND row: the row after the one following its marker. */
    const secondRow = (marker: string): Locator => {
      const at = texts.findIndex((t) => t === marker);
      expect(at, `no ${marker} row in ${JSON.stringify(texts)}`).toBeGreaterThanOrEqual(0);
      // ANTI-VACUITY: the link wrapped — its second row is still the link, not the next marker.
      expect(texts[at + 2], `the link after ${marker} did not wrap`).not.toMatch(/^WRAP2/);
      return rows.nth(at + 2);
    };

    /**
     * Rest on the second row until throng marks it as the hovered link — a positive signal rather
     * than a duration, and the same one for all three kinds. A file link needs its answer from main
     * first (FR-006), and the next query only happens when the pointer re-enters the line, so each
     * poll arrives from the line below.
     */
    const armSecondRow = async (row: Locator, label: string): Promise<LinkPoint> => {
      const box = (await row.boundingBox())!;
      const point = { x: box.x + Math.min(box.width / 3, 60), y: box.y + box.height / 2, row: box.height };
      await expect
        .poll(
          async () => {
            await enterLink(win, point);
            return linkMarkedText(row, { hover: true });
          },
          { timeout: 30_000, intervals: [600], message: `the second row of ${label} is never the hovered link` },
        )
        .not.toBe('');
      return point;
    };
    const ctrlPressHere = async (): Promise<void> => {
      await win.keyboard.down('Control');
      await win.mouse.down();
      await win.mouse.up();
      await win.keyboard.up('Control');
    };

    // A web url.
    await opens.reset();
    await armSecondRow(secondRow('WRAP2WEB'), 'the web url');
    await ctrlPressHere();
    await expect.poll(() => opens.urls(), { timeout: 5000 }).toEqual([web]);

    // A detected path, outside the project: one OS reveal.
    await resetOpenedPaths(app);
    await armSecondRow(secondRow('WRAP2PATH'), 'the detected path');
    await ctrlPressHere();
    await expect.poll(() => openedPaths(app), { timeout: 5000 }).toHaveLength(1);

    // An OSC 8 hyperlink: its TARGET, never its text. Only where the OS's ConPTY carries the
    // hyperlink around its text at all — below build 22000 it wraps nothing, so there is no link on
    // that row to follow, and the half is reported NOT RUN rather than failed or passed.
    const oscRuns = osc8HalfRuns('the wrapped OSC 8 second-row follow (T186)');
    if (oscRuns) {
      await opens.reset();
      await armSecondRow(secondRow('WRAP2OSC'), 'the OSC 8 hyperlink');
      await ctrlPressHere();
      await expect.poll(() => opens.urls(), { timeout: 5000 }).toEqual([oscUri]);
    }

    // A SECOND, later open of any of them would still be caught — see fenceOnEcho's doc comment.
    await fenceOnEcho(win, term, 'LINKFENCE2W');
    expect(await opens.urls()).toEqual([oscRuns ? oscUri : web]);
    const followed = await openedPaths(app);
    expect(followed, 'the wrapped detected path was followed more than once').toHaveLength(1);
    expect(samePathish(followed[0], outsideFile), `the wrapped path opened ${followed[0]}, not ${outsideFile}`).toBe(true);
  } finally {
    await restore();
    cleanupTemp(outside);
  }
}

test('Ctrl+clicking an OSC 8 link with non-url text opens its TARGET, exactly once', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-link3-'));
  const url = 'https://example.com/osc8-hidden-target';
  const label = 'CLICKTHELABEL';
  try {
    writeLinkScript(root, url, label);
    await runApp(async (app, win) => {
      await createProject(win, 'LinkLabel', root);
      const term = await openTerminal(win, root);
      const opens = await captureOpens(app);
      await runScript(win, term, label);
      await opens.reset();

      await clickLink(win, label, { ctrl: true });

      // The destination, never the visible text.
      await expect.poll(() => opens.urls(), { timeout: 5000 }).toEqual([url]);
      // A SECOND, later open would still be caught — see fenceOnEcho's doc comment.
      await fenceOnEcho(win, term, 'LINKFENCE3');
      expect(await opens.urls()).toEqual([url]);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a PLAIN click on a link opens nothing — it keeps its terminal meaning', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'throng-link4-'));
  const url = 'https://example.com/no-modifier';
  try {
    writeLinkScript(root, url, url);
    await runApp(async (app, win) => {
      await createProject(win, 'LinkPlainClick', root);
      const term = await openTerminal(win, root);
      const opens = await captureOpens(app);
      await runScript(win, term, url);
      await opens.reset();

      // 045 T280 (FR-164, FR-167) — resting on the link WITHOUT Ctrl already shows the hand and names
      // the target in the status bar. Neither waits for a modifier any more.
      const pid = ((await term.getAttribute('data-testid')) ?? '').replace(/^terminal-/, '');
      const linkRow = win.locator('.xterm-rows > div', { hasText: url }).last();
      await expectHoverWithoutCtrl(win, term, linkRow, url, pid);

      await clickLink(win, url, { ctrl: false });

      // 045 T280 (FR-165 – FR-165d) — the plain click raised the ONE hint, at the link's own
      // bottom-right in real cell geometry, fully on screen; and Ctrl hides it at once.
      await expectHintAtLinkThenCtrlHides(win, linkRow, url);

      // A bare `expect(await opens.urls()).toEqual([])` right here would be satisfied whether the
      // click genuinely opens nothing, or the app just hasn't gotten around to it yet — the exact
      // vacuous-negative trap `stayedAbsent` exists for. Fence on a real round-trip instead.
      await stayedAbsent(
        () => fenceOnEcho(win, term, 'LINKFENCE4'),
        async () => (await opens.urls()).length,
        'a plain click opened the browser',
      );

      // 045 T280 — D5's never-quiet half, in the declaration the hosted gate runs (no
      // `skipIfElevated()` here). See `markedWhileNeverQuiet`.
      await markedWhileNeverQuiet(win, term, root);
    });
  } finally {
    cleanupTemp(root);
  }
});

/** The computed cursor at a page point — what the user actually sees under the pointer. */
function cursorAt(win: Page, at: { x: number; y: number }): Promise<string> {
  return win.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? getComputedStyle(el).cursor : 'nothing';
  }, [at.x, at.y] as [number, number]);
}

/**
 * Rest on `text` in `row` until throng draws it as THE hovered link, arriving from the line below on
 * every probe (the only thing that re-queries xterm's providers — see `armFileLink`). Answers where.
 */
async function hoverUntilMarked(win: Page, row: Locator, text: string, what: string): Promise<LinkPoint> {
  const box = (await row.boundingBox())!;
  const at: LinkPoint = { ...(await charPoint(row, text, 4)), row: box.height };
  await expect
    .poll(
      async () => {
        await enterLink(win, at);
        return linkMarkedText(row, { hover: true });
      },
      { timeout: 30_000, intervals: [600], message: `${what} never became the hovered link` },
    )
    .not.toBe('');
  return at;
}

/**
 * 045 T280 (FR-164, FR-167) — the hand and the status-bar target on a hover with NO modifier held.
 * The hand is read twice: the class `link-marks.ts` puts on the panel, and the computed cursor under
 * the pointer, which is what `terminal.css` turns that class into.
 */
async function expectHoverWithoutCtrl(win: Page, term: Locator, row: Locator, text: string, pid: string): Promise<void> {
  const at = await hoverUntilMarked(win, row, text, text);
  expect(await term.evaluate((el) => el.classList.contains('terminal-link-pointer')), 'no hand without Ctrl (FR-164)').toBe(
    true,
  );
  expect(await cursorAt(win, at), 'the computed cursor over a hovered link').toBe('pointer');
  await expect(win.getByTestId(`terminal-status-link-readout-${pid}`)).toHaveText(text);
}

/**
 * 045 T280 (FR-165a – FR-165d) — the plain-click hint, read against the REAL rendered cells.
 *
 * Its anchor is the link's own last cell's bottom-right (`terminalLinkHintAnchor`, from xterm's cell
 * geometry), so the hint's top-left must sit on the right edge of the link's last glyph and the
 * bottom of its row — within one cell, since the anchor divides the screen's width by the columns
 * while the glyph box is the DOM renderer's. Then Ctrl hides it, and the hide is proven to be Ctrl's
 * rather than `LINK_HINT_MS` running out by timing it against that constant.
 */
async function expectHintAtLinkThenCtrlHides(win: Page, row: Locator, text: string): Promise<void> {
  const hint = win.getByTestId('link-hint');
  await expect(hint, 'a plain click on a link raised no hint').toBeVisible({ timeout: 5000 });
  const shownAt = Date.now();
  await expect(hint).toContainText('Ctrl');

  const rowBox = (await row.boundingBox())!;
  const last = await row.evaluate((el, want) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let all = '';
    while (walker.nextNode()) {
      nodes.push(walker.currentNode as Text);
      all += walker.currentNode.textContent ?? '';
    }
    const at = all.replace(/\u00a0/g, ' ').indexOf(want) + want.length - 1;
    let seen = 0;
    for (const node of nodes) {
      const length = (node.textContent ?? '').length;
      if (at < seen + length) {
        const range = document.createRange();
        range.setStart(node, at - seen);
        range.setEnd(node, at - seen + 1);
        const r = range.getBoundingClientRect();
        return { right: r.right, width: r.width };
      }
      seen += length;
    }
    return null;
  }, text);
  expect(last, `the row does not hold ${text}`).not.toBeNull();
  const box = (await hint.boundingBox())!;
  const viewport = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  // Fully on screen (FR-165c).
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  // At the link's bottom-right (FR-165b) — never over its own text.
  expect(Math.abs(box.x - last!.right), `hint left ${box.x} vs link end ${last!.right}`).toBeLessThanOrEqual(last!.width);
  expect(Math.abs(box.y - (rowBox.y + rowBox.height)), `hint top ${box.y} vs row bottom`).toBeLessThanOrEqual(
    rowBox.height / 2,
  );

  // FR-165d — Ctrl hides it at once.
  await win.keyboard.down('Control');
  try {
    await expect(hint, 'Ctrl did not hide the hint').toHaveCount(0, { timeout: 1000 });
  } finally {
    await win.keyboard.up('Control');
  }
  expect(Date.now() - shownAt, 'the hint went on its own timer, not on Ctrl').toBeLessThan(LINK_HINT_MS);
}

/**
 * 045 T280 — D5's never-quiet half: a program that prints its links and then repaints a status line
 * IN PLACE, on the normal screen, without ever pausing — Claude Code's own shape (a user's claude does
 * not take the alternate screen; see the throng-testing skill).
 *
 * The at-rest mark must arrive WHILE the output is still flowing. The repaint cadence (30 ms) is well
 * inside `LINK_MARK_THROTTLE_MS`, so a design that waited for the output to go quiet would never mark
 * at all — which is what makes a bounded wait here falsifiable, rather than a race against the
 * throttle that an E2E round-trip could not time honestly. The counter the program prints is read
 * before and after each observation, so "output never paused" is measured, not assumed. The elapsed
 * time to the mark is printed on every run.
 */
async function markedWhileNeverQuiet(win: Page, term: Locator, root: string): Promise<void> {
  const ESC = String.fromCharCode(27);
  const ST = ESC + String.fromCharCode(92);
  const web = 'https://example.com/never-quiet';
  const oscUri = 'https://example.com/never-quiet-osc8';
  const oscText = 'SPINOSCLABEL';
  writeFileSync(
    join(root, 'spin.cjs'),
    [
      'const out = process.stdout;',
      "out.write('SPINTOP\\r\\n');",
      `out.write(${JSON.stringify(web + '\r\n')});`,
      `out.write(${JSON.stringify(`${ESC}]8;;${oscUri}${ST}${oscText}${ESC}]8;;${ST}\r\n`)});`,
      'let n = 0;',
      "const frames = '|/-+';",
      'const timer = setInterval(() => {',
      '  n += 1;',
      `  out.write(${JSON.stringify('\r' + ESC + '[2K')} + 'SPINNING ' + frames[n % 4] + ' ' + n + ' ');`,
      '}, 30);',
      'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
      'process.stdin.resume();',
      "process.stdin.on('data', (b) => {",
      "  if (!b.toString('latin1').includes('q')) return;",
      '  clearInterval(timer);',
      // Exit from the write's callback: a TTY write is asynchronous on Windows, and an immediate
      // `process.exit` can drop it.
      "  out.write('\\r\\nSPINSTOPPED\\r\\n', () => process.exit(0));",
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const spins = async (): Promise<number> => {
    const text = ((await term.locator('.xterm-rows').textContent()) ?? '').replace(/\u00a0/g, ' ');
    const m = /SPINNING \S (\d+)/.exec(text);
    return m ? Number(m[1]) : -1;
  };
  const stillFlowing = async (after: number, what: string): Promise<number> => {
    await expect
      .poll(spins, { timeout: 5000, message: `the program stopped repainting (${what}) — the case would be vacuous` })
      .toBeGreaterThan(after);
    return spins();
  };

  await runTypedCommand(win, term, 'node spin.cjs', { echoed: 'spin.cjs', output: 'SPINNING', timeout: 25_000 });
  try {
    await win.mouse.move(2, 2); // at REST: nothing hovered
    const webRow = win.locator('.xterm-rows > div', { hasText: web }).last();
    const n0 = await spins();
    const started = Date.now();
    await expect
      .poll(() => linkMarkedText(webRow), {
        timeout: 10_000,
        message: 'a link printed by a program that never goes quiet was never marked at rest (D5)',
      })
      .toBe(web);
    console.log(`[T280] at-rest mark under never-quiet output after ${Date.now() - started} ms`);
    expect(await linkMarkedText(webRow, { hover: true }), 'marked as hovered with nothing hovered').toBe('');
    const n1 = await stillFlowing(n0, 'while the mark arrived');

    if (osc8HalfRuns('the at-rest mark on an OSC 8 hyperlink under never-quiet output (T280)')) {
      const oscRow = win.locator('.xterm-rows > div', { hasText: oscText }).last();
      await expect
        .poll(() => linkMarkedText(oscRow), { timeout: 10_000, message: 'the OSC 8 hyperlink was never marked at rest' })
        .toBe(oscText);
    }

    // Hover and the hand, with the output still running.
    const at = await hoverUntilMarked(win, webRow, web, 'the never-quiet link');
    expect(await term.evaluate((el) => el.classList.contains('terminal-link-pointer'))).toBe(true);
    expect(await cursorAt(win, at)).toBe('pointer');
    await stillFlowing(n1, 'while hovered');
  } finally {
    await win.mouse.move(2, 2);
    await win.keyboard.press('q');
  }
  await expect(term).toContainText('SPINSTOPPED', { timeout: 25_000 });
  await fenceOnEcho(win, term, 'SPINFENCE');
}

/**
 * The box of the first link mark on `row`, or null. For "the SAME mark is gone" after a buffer
 * switch — a mark the new buffer legitimately draws elsewhere (a prompt path) is a different box.
 */
function markBoxOn(row: Locator): Promise<{ left: number; top: number; width: number } | null> {
  return row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = [...(el.closest('.xterm')?.querySelectorAll<HTMLElement>('.terminal-link-mark') ?? [])]
      .map((m) => m.getBoundingClientRect())
      .find((b) => b.width > 0 && b.top < r.bottom - r.height / 4 && b.bottom > r.top + r.height / 4);
    return hit ? { left: hit.left, top: hit.top, width: hit.width } : null;
  });
}

/**
 * 028 T004 (FR-050/055a) — the same guarantee on the ALTERNATE screen.
 *
 * The four fences above all run on the normal buffer, which is the one condition #198's reporter was
 * NOT in: the report came from a full-screen program. That difference is not cosmetic here — the
 * alternate screen is where this feature suppresses the replayed tail, forces redraws and re-encodes
 * keys, so it is exactly where a second `openExternal` could newly appear.
 *
 * The link is emitted by the program itself rather than typed, for the reason in the header: typing
 * an OSC 8 sequence at a prompt puts the URL in the echoed command line, and the test then clicks
 * the echo instead of the link.
 */
test('Ctrl+clicking a link on the ALTERNATE screen opens exactly once', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
  const root = mkdtempSync(join(tmpdir(), 'throng-link-alt-'));
  const uri = 'https://example.com/alt-screen-link';
  /*
   * A full-screen program that takes the alternate screen, prints one OSC 8 hyperlink into it, and
   * then sits still. It must NOT repaint on its own: a program that redraws spontaneously would
   * rebuild the link cells under the pointer and mask whatever throng did.
   *
   * 045 T280 — it repaints only when ASKED (`r`), after the exactly-once assertion, and `x` leaves
   * the alternate screen (`ESC[?1049l`) and exits: D5's buffer-switch half.
   */
  const ESC = String.fromCharCode(27);
  const ST = ESC + String.fromCharCode(92); // the string terminator that closes an OSC sequence
  const altLink = ESC + '[H' + ESC + ']8;;' + uri + ST + 'ALTLINKTEXT' + ESC + ']8;;' + ST;
  writeFileSync(
    join(root, 'altlink.cjs'),
    [
      'const out = process.stdout;',
      `out.write(${JSON.stringify(ESC + '[?1049h')});`,
      `out.write(${JSON.stringify(altLink)});`,
      'process.stdin.resume();',
      'process.stdin.setRawMode && process.stdin.setRawMode(true);',
      "process.stdin.on('data', (b) => {",
      "  const s = b.toString('latin1');",
      `  if (s.includes('r')) out.write(${JSON.stringify(altLink + ESC + '[3;1HREPAINTED')});`,
      "  if (s.includes('x')) {",
      // Exit from the write's callback: a TTY write is asynchronous on Windows, and an immediate
      // `process.exit` can drop it.
      `    out.write(${JSON.stringify(ESC + '[?1049l')}, () => process.exit(0));`,
      '  }',
      '});',
      'setInterval(() => {}, 1 << 30);',
    ].join(String.fromCharCode(10)),
    'utf8',
  );

  try {
    await runApp(async (app, win) => {
      const opens = await captureOpens(app);
      await createProject(win, 'LinkAlt', root);
      const term = await openTerminal(win, root);

      await term.click();
      await win.keyboard.type('node altlink.cjs');
      await win.keyboard.press('Enter');
      await expect(term).toContainText('ALTLINKTEXT', { timeout: 25_000 });

      await opens.reset();
      await clickLink(win, 'ALTLINKTEXT', { ctrl: true });
      // sleep-justified: no fence is available — altlink.cjs never reads stdin meaningfully (it only resumes it and sits in an interval), so unlike the shells above there is no echo to wait on as proof the opportunity has passed.
      await win.waitForTimeout(1500);

      // Exactly once, at the seam — the same claim the normal-screen fences make, in the condition
      // the reporter was actually in.
      expect(await opens.urls()).toEqual([uri]);

      /*
       * 045 T280 — D5's buffer-switch half: the link is marked at rest on the alternate screen, stays
       * marked through a repaint, and no mark survives the program leaving it. Only where ConPTY
       * carries OSC 8 at all (`osc8HalfRuns`); the switch itself is driven either way, so the program
       * always exits. At the hosted gate this whole declaration is `skipIfElevated`, and the half is
       * held by T233 (unit) and quickstart §10 row 9.
       */
      await win.mouse.move(2, 2);
      const altRow = win.locator('.xterm-rows > div', { hasText: 'ALTLINKTEXT' }).last();
      let altMark: { left: number; top: number; width: number } | null = null;
      if (osc8HalfRuns('the alternate-screen mark across a repaint and a buffer switch (T280)')) {
        await expect
          .poll(() => linkMarkedText(altRow), { timeout: 10_000, message: 'the alt-screen hyperlink was never marked at rest' })
          .toBe('ALTLINKTEXT');
        // The hover (solid) mark and the plain-click hint on the alternate screen too — xterm hides
        // every decoration while that buffer is active, which is what this half first caught.
        const altAt = await hoverUntilMarked(win, altRow, 'ALTLINKTEXT', 'the alt-screen hyperlink');
        expect(await cursorAt(win, altAt)).toBe('pointer');
        await win.mouse.down();
        await win.mouse.up();
        await expectHintAtLinkThenCtrlHides(win, altRow, 'ALTLINKTEXT');
        await win.mouse.move(2, 2);
        await win.keyboard.press('r');
        await expect(term).toContainText('REPAINTED', { timeout: 10_000 });
        // Checked only after that round-trip through the program, so a late open would be seen.
        expect(await opens.urls(), 'a plain click on the alt screen opened the link').toEqual([uri]);
        await expect
          .poll(() => linkMarkedText(altRow), { timeout: 10_000, message: 'a repaint lost the mark' })
          .toBe('ALTLINKTEXT');
        altMark = await markBoxOn(altRow);
        expect(altMark, 'no mark box to follow across the switch').not.toBeNull();
      }
      /*
       * Leaving the alternate screen is observed by the alternate screen's own text going, not by a
       * line printed after the switch: measured, a line written in the same breath as `ESC[?1049l`
       * does not survive the switch back — and what PSReadLine does at the prompt it returns to is
       * not this test's subject.
       */
      await win.keyboard.press('x');
      await expect(win.locator('.xterm-rows > div', { hasText: 'ALTLINKTEXT' })).toHaveCount(0, { timeout: 25_000 });
      if (altMark !== null) {
        const was = altMark;
        await expect
          .poll(
            () =>
              term.evaluate(
                (el, b) =>
                  [...el.querySelectorAll<HTMLElement>('.terminal-link-mark')]
                    .map((m) => m.getBoundingClientRect())
                    .filter(
                      (r) =>
                        r.width > 0 &&
                        Math.abs(r.left - b.left) < 1 &&
                        Math.abs(r.top - b.top) < 1 &&
                        Math.abs(r.width - b.width) < 1,
                    ).length,
                was,
              ),
            { timeout: 5000, message: 'the mark from the alternate screen survived the switch back' },
          )
          .toBe(0);
      }
    });
  } finally {
    cleanupTemp(root);
  }
});

/**
 * #198 — the case the five fences above never drove: a full-screen program that OWNS THE MOUSE.
 *
 * Claude Code arms mouse tracking (use-terminal.ts records it re-sending "its screen and mouse modes
 * after every resize"), and it acts on a click itself. With tracking armed, xterm's always-on
 * mousedown listener forwards the press to the pty — Ctrl is not a selection-forcing modifier, so
 * nothing holds it back — while the Linkifier ALSO activates the link on mouseup. One Ctrl+click is
 * then two opens: throng's, at the `shell.openExternal` seam, and the program's own, from the press
 * it was sent. The altlink fixture above never armed the mouse, which is why it stayed at one.
 *
 * The fixture is terminal-mouse-negotiation.e2e.ts's, in the shape measured to arm through ConPTY
 * (raw mode first, then 1049 + 1003 + 1006, under windows-powershell), plus an OSC 8 link. Every byte
 * it receives is logged; a mouse PRESS in that log is the program being asked to act on the click.
 *
 * 045 T122 prints two more links into the SAME armed program — a detected path and an OSC 8 `file:`
 * hyperlink naming a folder — because FR-043 widened the guard from web links to file links, and a
 * file link reaches it by a different route (a provider that resolves through main) than a web link
 * does. See the block inside the test for what each of the three kinds is counted at.
 */
function writeMouseLinkFixture(
  root: string,
  logPath: string,
  uri: string,
  /**
   * 045 T122 — the two FILE link kinds, printed by the SAME mouse-owning program so all three share
   * one armed ConPTY rather than three fixtures that each have to be measured to arm.
   */
  files: { readonly detectedPath: string; readonly folderUri: string; readonly folderText: string },
): void {
  const ESC = String.fromCharCode(27);
  const ST = ESC + String.fromCharCode(92);
  const osc8 = (target: string, text: string): string =>
    `${ESC}]8;;${target}${ST}${text}${ESC}]8;;${ST}`;
  const lines = [
    "const fs = require('node:fs');",
    `const LOG = ${JSON.stringify(logPath)};`,
    'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
    'process.stdin.resume();',
    "process.stdin.on('data', (b) => {",
    "  fs.appendFileSync(LOG, JSON.stringify(b.toString('latin1')) + '\\n');",
    '});',
    "process.stdout.write('\\x1b[?1049h');",
    "process.stdout.write('\\x1b[?1003h');",
    "process.stdout.write('\\x1b[?1006h');",
    `process.stdout.write(${JSON.stringify(ESC + '[H' + osc8(uri, uri) + '\r\n')});`,
    // Each link starts its own row at column 0, so `clickLink`/`armFileLink` land a few cells INTO
    // the link rather than on whatever preceded it.
    `process.stdout.write(${JSON.stringify(files.detectedPath + '\r\n')});`,
    `process.stdout.write(${JSON.stringify(osc8(files.folderUri, files.folderText) + '\r\n')});`,
    "process.stdout.write('MOUSELINK_READY\\r\\n');",
    'setInterval(() => {}, 1000);',
  ];
  writeFileSync(join(root, 'mouselink.js'), lines.join('\n'), 'utf8');
}

/** Every byte the fixture has received, in order. */
function receivedBytes(logPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as string)
    .join('');
}

/**
 * SGR mouse PRESSES of the left button (`CSI < b ; x ; y M` with b's motion bit clear and low bits 0),
 * whatever modifiers are folded into b. Motion reports (1003 sends them on every move) are excluded.
 */
function leftPresses(bytes: string): number[] {
  const out: number[] = [];
  for (const m of bytes.matchAll(new RegExp(String.fromCharCode(27) + '\\[<(\\d+);\\d+;\\d+M', 'g'))) {
    const b = Number(m[1]);
    if ((b & 32) === 0 && (b & 3) === 0) out.push(b);
  }
  return out;
}

/**
 * Rest the pointer on a FILE link until throng has RESOLVED it, and answer where to press.
 *
 * ══ WHY A FILE LINK NEEDS THIS AND A WEB LINK DOES NOT ══
 *
 * A web link is a link the moment it is matched. A file link is only a link once main has said the
 * location exists (FR-006), and that answer arrives asynchronously — `peekLink` is synchronous and
 * `undefined` means "not a link", never "wait" (FR-071). So the FIRST query over a path always
 * misses; it fires the request, and the link exists from the NEXT query onwards.
 *
 * ══ AND THE NEXT QUERY ONLY HAPPENS IF THE POINTER LEAVES THE LINE ══
 *
 * xterm caches its link providers' replies PER LINE, not per cell (`Linkifier._handleHover`), so
 * neither a sleep nor a nudge between cells asks again — the cache fills and nothing ever reads it.
 * The pointer therefore arrives from the line below on every pass. Measured on
 * `terminal-links.e2e.ts`, where a same-row nudge underlined nothing in 20 seconds while an https
 * URL in the same row underlined at once, the web scanner needing no round trip.
 *
 * The signal is the status bar's link readout, which is a positive fact rather than a duration: it is
 * written from `hoveredLink`, and a file link is in `hoveredLink` only once it has resolved.
 *
 * It used to be the hover TIP, which round five deleted — the maintainer asked for a link's hover to
 * be its address in a native HTML `title` and nothing else, and a native title is drawn by the OS
 * where Playwright cannot see it. The readout is written from the same `hoveredLink` on the same
 * beat, so it says exactly what the tip said about resolution, and it says it without the 500ms
 * show delay the tip was gated by.
 */
interface LinkPoint {
  readonly x: number;
  readonly y: number;
  /** One row's height: the distance the pointer leaves the line by. See `armFileLink`. */
  readonly row: number;
}

async function armFileLink(win: Page, text: string): Promise<LinkPoint> {
  const row = win.locator('.xterm-rows > div', { hasText: text }).last();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const box = (await row.boundingBox())!;
  // Measured per character rather than divided out of a column count — see `charPoint`.
  const point = await charPoint(row, text, 3);
  const at: LinkPoint = { ...point, row: box.height };
  const readout = win.locator('[data-testid^="terminal-status-link-readout-"]');
  /*
   * THREE PHASES, ONE PER PROBE, AND THE SPACING BETWEEN THEM IS THE POINT.
   *
   * Not a delay to wait out — round five's readout has none — but a ROUND TRIP. Resolving a file
   * link is IPC to the main process, so the pointer arriving on the link and the readout appearing
   * are two different beats. Each probe does one thing and the interval does the waiting: LEAVE (the
   * only thing that expires xterm's per-line provider cache, see above), ENTER (which fires the
   * resolution request), READ (600ms later, by which time it has answered).
   *
   * Nothing is slept on — a probe interval is a cadence, and if the link never resolves this still
   * fails rather than passing late.
   */
  const phases = ['away', 'onto', 'read'] as const;
  let probe = 0;
  await expect
    .poll(
      async () => {
        const phase = phases[probe++ % phases.length];
        if (phase === 'away') await win.mouse.move(at.x, at.y + at.row);
        else if (phase === 'onto') await win.mouse.move(at.x, at.y);
        return readout.count();
      },
      {
        timeout: 30_000,
        intervals: [600],
        message: `throng never resolved ${text} into a link`,
      },
    )
    .toBeGreaterThan(0);
  return at;
}

/** Arrive on the link from the line below, which is the only thing that re-queries the providers. */
async function enterLink(win: Page, at: LinkPoint): Promise<void> {
  await win.mouse.move(at.x, at.y + at.row);
  await win.mouse.move(at.x, at.y);
}

/**
 * Press and release the left button on a link, optionally with Ctrl held.
 *
 * It re-enters the link first, and that is load-bearing rather than tidy. xterm activates on a
 * mouseup whose mousedown armed the SAME `_currentLink`, and `_currentLink` is cleared by any
 * repaint — throng repaints an alt-screen program on a 2s interval by itself (028's self-heal), so a
 * link armed a few seconds ago is routinely disarmed by the time a test presses it. A move within
 * the cell does not restore it either: `Linkifier._handleMouseMove` only re-hovers when the CELL
 * changes. Measured here: the Ctrl+click recorded nothing at all while the same request driven
 * straight at main answered `{ ok: true }`, which is what pointed at the pointer rather than at the
 * link route.
 */
async function pressAt(win: Page, at: LinkPoint, opts: { ctrl: boolean }): Promise<void> {
  await enterLink(win, at);
  if (opts.ctrl) await win.keyboard.down('Control');
  await win.mouse.down();
  await win.mouse.up();
  if (opts.ctrl) await win.keyboard.up('Control');
}

/** Forget what the app has asked the OS to open. The harness stubs both routes at launch. */
async function resetOpenedPaths(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    (globalThis as unknown as { __throngOpenedPaths?: string[] }).__throngOpenedPaths = [];
  });
}

/**
 * One location, however it is spelled. The assertions below are about the COUNT — a link followed
 * exactly once — and a separator or a case difference between what `mkdtemp` returned and what
 * resolution joined would fail them for a reason that has nothing to do with #198.
 */
function samePathish(a: string, b: string): boolean {
  return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
}

test('Ctrl+clicking a link in a program that OWNS THE MOUSE opens it once, not also through the program (#198)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  skipIfElevated();
  /*
   * The project root is a FOLDER INSIDE the scratch directory rather than the scratch directory
   * itself, so `../outside.txt` names something real and OUTSIDE the project — which is what routes
   * the detected-path case to an OS destination this test can count, instead of to a throng editor
   * whose second open would be indistinguishable from its first (FR-055, FR-053).
   */
  const base = mkdtempSync(join(tmpdir(), 'throng-link-mouse-'));
  const root = join(base, 'project');
  mkdirSync(root);
  const outsideFile = join(base, 'outside.txt');
  writeFileSync(outsideFile, 'outside the project\n', 'utf8');
  const folder = join(root, 'linkdir');
  mkdirSync(folder);

  const logPath = join(root, 'received.log');
  const uri = 'https://example.com/mouse-owning-program';
  const detectedPath = '../outside.txt';
  const folderText = 'FOLDERLINKTEXT';
  const folderUri = `file:///${folder.replace(/\\/g, '/')}`;
  writeMouseLinkFixture(root, logPath, uri, { detectedPath, folderUri, folderText });
  try {
    await runApp(async (app, win) => {
      const opens = await captureOpens(app);
      await createProject(win, 'LinkMouse', root);
      const term = await openTerminal(win, root);

      await term.click();
      await win.keyboard.type('node mouselink.js', { delay: TYPE_DELAY });
      await win.keyboard.press('Enter');
      await expect(term).toContainText('MOUSELINK_READY', { timeout: TERMINAL_OUTPUT_TIMEOUT_MS });

      /*
       * ANTI-VACUITY: a PLAIN click must reach the program — that is what arming the mouse means, and
       * it has to keep working. Without this, a fixture whose mouse modes never survived ConPTY would
       * make the assertion below pass for free.
       */
      await clickLink(win, uri, { ctrl: false });
      await expect
        .poll(() => leftPresses(receivedBytes(logPath)).length, {
          timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
          message: 'the fixture never armed the mouse — the rest of this test would be vacuous',
        })
        .toBe(1);
      expect(await opens.urls()).toEqual([]);

      await opens.reset();
      await clickLink(win, uri, { ctrl: true });
      await expect.poll(() => opens.urls(), { timeout: 5000 }).toEqual([uri]);

      // Fence: a key typed AFTER the click travels the same pipe, so once it has arrived any press the
      // click produced has arrived too.
      await win.keyboard.press('q');
      await expect.poll(() => receivedBytes(logPath), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS }).toContain('q');

      // Exactly one open in total: throng's. The program was not ALSO handed the click to act on.
      expect(await opens.urls()).toEqual([uri]);
      expect(leftPresses(receivedBytes(logPath)), 'the Ctrl+click was forwarded to the program as well').toHaveLength(1);

      /*
       * ══ 045 T122 — the same guarantee for the two FILE link kinds (FR-043, SC-002, SC-005) ══
       *
       * FR-043 is the widening of #198's guard from web links to file links, and there is nowhere
       * below this to observe it: the claim is about a REAL xterm Linkifier deciding a path is a
       * link, a REAL ConPTY carrying the DEC mouse modes, and the bytes a REAL program is handed.
       * `terminal-hovered-link.test.ts` pins `keepsClickFromProgram` as a function; it cannot make
       * a program that owns the mouse exist to be spared the press.
       *
       * Both kinds are driven in the panel that is ALREADY armed, rather than in a fresh one: the
       * arming is the expensive and fragile part (raw mode, then 1049 + 1003 + 1006 through
       * ConPTY), and the anti-vacuity assertion above has just proved it holds for this panel.
       *
       * Each is counted at an OS seam the harness already stubs (`__throngOpenedPaths`), which is
       * what makes "exactly once" falsifiable. A second follow of the same file link would be a
       * second entry, exactly as a second `openExternal` is for the web cases above.
       */
      const detectedAt = await armFileLink(win, detectedPath);
      await resetOpenedPaths(app);

      // ANTI-VACUITY, per kind: a PLAIN click on a resolved file link must still reach the program.
      // FR-043 withholds the press only when Ctrl is held, and a guard that withheld every press
      // would pass the assertion after it while breaking every program that reads the mouse.
      await pressAt(win, detectedAt, { ctrl: false });
      await expect
        .poll(() => leftPresses(receivedBytes(logPath)).length, {
          timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
          message: 'a plain click on a detected path no longer reaches the program',
        })
        .toBe(2);
      expect(await openedPaths(app)).toEqual([]);

      await pressAt(win, detectedAt, { ctrl: true });
      await expect.poll(() => openedPaths(app), { timeout: 5000 }).toHaveLength(1);
      // The same fence as the web case: a key typed AFTER the click travels the same pipe, so once
      // it has arrived, any press the click produced has arrived too.
      await win.keyboard.press('k');
      await expect.poll(() => receivedBytes(logPath), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS }).toContain('k');
      const afterDetected = await openedPaths(app);
      expect(afterDetected, 'a detected path was followed more than once').toHaveLength(1);
      expect(
        samePathish(afterDetected[0], outsideFile),
        `the detected path opened ${afterDetected[0]}, not ${outsideFile}`,
      ).toBe(true);
      expect(
        leftPresses(receivedBytes(logPath)),
        'the Ctrl+click on a detected path was forwarded to the program as well',
      ).toHaveLength(2);

      /*
       * The second kind: an OSC 8 hyperlink whose target is a `file:` URI naming a FOLDER — the
       * maintainer's status line, and the report the feature started from (SC-005). A folder offers
       * only the file manager (FR-030), so one Ctrl+click is exactly one `openPath`.
       *
       * Only where the OS's ConPTY carries a hyperlink around its text — `osc8HalfRuns` in admin.ts.
       */
      if (!osc8HalfRuns('the OSC 8 file: folder hyperlink in a mouse-owning program (T122)')) return;
      const folderAt = await armFileLink(win, folderText);
      await resetOpenedPaths(app);

      await pressAt(win, folderAt, { ctrl: false });
      await expect
        .poll(() => leftPresses(receivedBytes(logPath)).length, {
          timeout: TERMINAL_OUTPUT_TIMEOUT_MS,
          message: 'a plain click on a file hyperlink no longer reaches the program',
        })
        .toBe(3);
      expect(await openedPaths(app)).toEqual([]);

      await pressAt(win, folderAt, { ctrl: true });
      await expect.poll(() => openedPaths(app), { timeout: 5000 }).toHaveLength(1);
      await win.keyboard.press('w');
      await expect.poll(() => receivedBytes(logPath), { timeout: TERMINAL_OUTPUT_TIMEOUT_MS }).toContain('w');
      const afterFolder = await openedPaths(app);
      expect(afterFolder, 'a folder hyperlink was followed more than once').toHaveLength(1);
      expect(
        samePathish(afterFolder[0], folder),
        `the folder hyperlink opened ${afterFolder[0]}, not ${folder}`,
      ).toBe(true);
      expect(
        leftPresses(receivedBytes(logPath)),
        'the Ctrl+click on a file hyperlink was forwarded to the program as well',
      ).toHaveLength(3);
    });
  } finally {
    cleanupTemp(base);
  }
});
