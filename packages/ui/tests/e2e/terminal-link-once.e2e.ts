import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import {
  openApp,
  createProject as newProject,
  firstPanelId,
  cleanupTemp,
  stayedAbsent,
  TYPE_DELAY,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { skipIfElevated } from './admin.js';

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
 * ══ READ THIS BEFORE FIXING #198 ══
 *
 * These four cases PASS on this branch. That is not an oversight, and they are not written as
 * red tests, because **the reported double-open does not reproduce here**. Measured, on
 * `08d0fdc`, Windows PowerShell, normal screen buffer: one Ctrl+click on an OSC 8 hyperlink whose
 * display text is the URL produces exactly ONE `shell.openExternal`. Not two.
 *
 * The issue's stated cause is a code reading, not a count. It observes that two link mechanisms are
 * registered on the same terminal and both route to `openTerminalLink` — xterm's `linkHandler`
 * (OSC 8) at `use-terminal.ts:364`, and `WebLinksAddon` (plain-text detection) at `:526` — and
 * infers that cells satisfying both must fire both. xterm 6 does not work that way. Its
 * `Linkifier2` consults registered link PROVIDERS only when no OSC link already matched the
 * position (`if (…linkProviders.length && !i)` in `xterm.js`), and a single `_handleMouseUp`
 * activates `_currentLink` once. The OSC 8 link wins and the addon is never asked, so the two
 * mechanisms cannot both fire for one click on one set of cells.
 *
 * So the reported behaviour is real — it was observed — but its cause is somewhere this branch
 * does not reach from a scripted PowerShell link. Candidates NOT eliminated here, and worth
 * establishing before any fix is designed:
 *   - Claude Code runs on the ALTERNATE screen buffer, which `use-terminal.ts` treats specially in
 *     two places; the alt buffer could not be driven far enough in this harness to get a clickable
 *     link onto it.
 *   - Claude Code may print the URL more than once per line (an OSC 8 link followed by the bare
 *     URL), which would be two links and legitimately two targets — a different defect with a
 *     different fix.
 *   - A doubled `openExternal` upstream of the terminal (the window-open guard also routes to
 *     `shell.openExternal`).
 *
 * What these tests are therefore FOR: they pin "exactly once" at the `shell.openExternal` seam for
 * all three link shapes, so that whatever the fix turns out to be, it cannot double any of them,
 * and cannot fix the OSC 8 case by breaking plain-text detection (or vice versa). Fixing #198 by
 * de-duplicating blindly is the specific risk they exist to catch.
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
 */
async function runScript(win: Page, term: Locator, printed: string): Promise<void> {
  await term.click();
  await win.keyboard.type('powershell -NoProfile -ExecutionPolicy Bypass -File .\\lnk.ps1');
  await win.keyboard.press('Enter');
  await expect(term).toContainText(printed, { timeout: 25_000 });
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
  // sleep-justified: xterm's Linkifier2 resolves the hovered link internally with no DOM signal of its own; the one visible proxy, throng's hover tip, is gated by a separate longer linkHoverDelayMs (500ms default) and would over-wait and couple this to an unrelated setting.
  await win.waitForTimeout(300);
  if (opts.ctrl) await win.keyboard.down('Control');
  await win.mouse.down();
  await win.mouse.up();
  if (opts.ctrl) await win.keyboard.up('Control');
}

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
  const url = 'https://example.com/plain-text-url';
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
    });
  } finally {
    cleanupTemp(root);
  }
});

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

      await clickLink(win, url, { ctrl: false });

      // A bare `expect(await opens.urls()).toEqual([])` right here would be satisfied whether the
      // click genuinely opens nothing, or the app just hasn't gotten around to it yet — the exact
      // vacuous-negative trap `stayedAbsent` exists for. Fence on a real round-trip instead.
      await stayedAbsent(
        () => fenceOnEcho(win, term, 'LINKFENCE4'),
        async () => (await opens.urls()).length,
        'a plain click opened the browser',
      );
    });
  } finally {
    cleanupTemp(root);
  }
});

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
   */
  const ESC = String.fromCharCode(27);
  const ST = ESC + String.fromCharCode(92); // the string terminator that closes an OSC sequence
  writeFileSync(
    join(root, 'altlink.cjs'),
    [
      'const out = process.stdout;',
      `out.write(${JSON.stringify(ESC + '[?1049h')});`,
      `out.write(${JSON.stringify(ESC + '[H' + ESC + ']8;;' + uri + ST + 'ALTLINKTEXT' + ESC + ']8;;' + ST)});`,
      'process.stdin.resume();',
      'process.stdin.setRawMode && process.stdin.setRawMode(true);',
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
    });
  } finally {
    cleanupTemp(root);
  }
});
