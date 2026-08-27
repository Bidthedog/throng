import { basename } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { cleanupTemp, shutdownApp } from './harness.js';

// Clipboard support (005): a program running inside the terminal — Claude Code,
// tmux, vim — copies to the system clipboard by emitting an OSC 52 escape sequence.
// xterm.js ignores OSC 52 unless a handler is registered, so before this fix the
// copy silently no-op'd ("it says copied but nothing is on the clipboard"). Here we
// drive a real Windows PowerShell terminal to emit `ESC ] 52 ; c ; <base64> BEL`
// and assert the decoded text reaches the OS (Electron) clipboard.

/**
 * ══ ONE APP FOR TWO OF THE THREE (034 FR-045) ══
 *
 * **Launches: 3 Electron apps + 3 daemons + 3 real PowerShells BEFORE → 2 apps + 2 daemons AFTER.**
 *
 * One launch out of three sounds thin. These are the batch's most expensive launches: an Electron
 * app, a daemon, a real Windows PowerShell through a ConPTY, and a wait for its first prompt.
 *
 * ══ WHY TEST 1 CANNOT JOIN, EVER ══
 *
 * Not a leaked mutation and not a global assertion — a PRE-LAUNCH SEED, in its least obvious form.
 * The clipboard implementation is chosen by the composition root from `process.env` at startup:
 * `THRONG_E2E_CLIPBOARD === 'memory'` binds `MemoryClipboard`, anything else binds
 * `ElectronClipboard`.
 *
 *  - **Test 1** launches WITHOUT the variable on purpose, because it asserts by wrapping Electron's
 *    own `clipboard.writeText` in the main process and reading `__clipWrites`. Under `memory` that
 *    seam is never reached, `__clipWrites` stays `[]`, and it fails 100% of the time — looking
 *    exactly like a broken OSC 52 handler.
 *  - **Tests 2 and 3** launch WITH it, and their own comments explain why at length: without it,
 *    Paste delivers THE DEVELOPER'S REAL CLIPBOARD, measured failing 3/3 on a dev box carrying
 *    multi-line text.
 *
 * The two requirements are mutually exclusive at launch, so test 1 keeps its own everything and is
 * reproduced below completely unchanged. This is also why the file keeps its own launches rather
 * than moving to `harness.openApp()`, which sets `THRONG_E2E_CLIPBOARD=memory` unconditionally and
 * would silently break test 1 if it were ever folded in later.
 *
 * ══ WHY 2 AND 3 ARE SAFE TOGETHER ══
 *
 * Identical launch environments. Each creates its own project under its own `mkdtemp` root (no
 * FR-029 root conflict, no name ambiguity), and only the ACTIVE project's layout renders — so when
 * test 3 creates its project, test 2's terminal panel unmounts. Every assertion in both is
 * additionally keyed to `terminal-${pid}` / `panel-${pid}`, so nothing here is window-wide except
 * test 2's `context-menu` `toHaveCount(1)`, which is the product's app-wide singleton and is the
 * point of that test. They seed the shared `MemoryClipboard` with different tokens, and each writes
 * before it reads.
 *
 * ══ TWO CONSEQUENCES, STATED BEFORE THEY SURPRISE ANYONE ══
 *
 *  - **Two live shells at once.** Test 2's PowerShell keeps running while test 3 starts its own,
 *    because the app is no longer killed between them. This file is already in
 *    `parallel-plan.json`'s serial tier for exactly this class of reason, so it runs at one worker
 *    and the extra shell is affordable — but it is a real change in resource shape.
 *  - **Test 2's temp root will not delete.** Its `cleanupTemp` now runs while its PowerShell still
 *    holds that folder as its cwd, so it hits EBUSY/EPERM and logs
 *    `[cleanup] EBUSY removing … — left for the temp sweep`. That is `cleanupTemp`'s documented,
 *    deliberate behaviour — it exists so a Windows file lock never reddens a passing test — and
 *    `globalTeardown` removes the whole per-run folder. Expect the log line; it is not a regression.
 *
 * ══ NO `mode: 'serial'` ══
 *
 * `fullyParallel: false` already keeps the file to one worker, in order. Tests 2 and 3 test
 * different mechanisms (the themed menu's Paste item vs #142's Ctrl+V path), and a real-shell flake
 * in the first must not hide a regression in the second — which is the specific bug #142 was filed
 * for.
 */

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

// base64("throngClip42") — what the shell will OSC-52 onto the clipboard.
const EXPECTED = 'throngClip42';
const B64 = 'dGhyb25nQ2xpcDQy';

test('an OSC 52 sequence from inside the terminal writes to the system clipboard', { tag: ['@extended', '@terminal', '@reserve:native'] }, async () => {
  const pipe = `\\\\.\\pipe\\throng-clip-${process.pid}-${Date.now()}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'clip-data-'));
  const cfg = mkdtempSync(join(tmpdir(), 'clip-cfg-'));
  const userData = mkdtempSync(join(tmpdir(), 'clip-ud-'));
  const root = mkdtempSync(join(tmpdir(), 'clip-root-'));

  const daemon = spawn(process.execPath, [daemonEntry], {
    env: { ...process.env, THRONG_PIPE_NAME: pipe, THRONG_DATABASE_PATH: join(dataDir, 'throng.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((res) => daemon.stdout!.on('data', (c: string) => c.includes('listening') && res()));

  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      // THRONG_TEST_SHELL_HISTORY: this file opens a REAL PowerShell and types into it, so without
      // it every command below lands in the developer's own PSReadLine history (#339).
      env: {
        ...process.env,
        THRONG_PIPE_NAME: pipe,
        THRONG_CONFIG_ROOT: cfg,
        THRONG_TEST_SHELL_HISTORY: 'off',
      },
    });
    const win = await app.firstWindow();
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });

    // Create a project and open a Windows PowerShell terminal in it.
    await win.getByTestId('project-new').click();
    await win.getByTestId('project-root-input').fill(root);
    await win.getByTestId('project-name-input').fill('Clip');
    await win.getByTestId('project-save').click();
    /*
     * The id is read from the TYPE SELECT, not from `.panel-box` (#299 sweep).
     *
     * A new project's panel is UNTYPED and shows a type select; the previous test's terminal
     * panel does not. `.panel-box` .first() cannot tell them apart, and settling on the
     * project item does not mean the panel has been swapped yet — so the read could return the
     * OUTGOING panel's id, after which every `panel-type-select-<id>` call waits out its full
     * budget against an element that will never exist. Measured as a 30s `selectOption`
     * timeout on CI, passing on retry.
     */
    const typeSelect = win.locator('[data-testid^="panel-type-select-"]');
    await expect(typeSelect).toHaveCount(1);
    const pid =
      (await typeSelect.getAttribute('data-testid'))?.slice('panel-type-select-'.length) ?? '';
    expect(pid).not.toBe('');
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    // Wait for the shell to be live (its prompt shows the project root).
    await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });

    // Capture what the OSC 52 handler writes AT `clipboard.writeText` in the main
    // process, rather than reading the OS clipboard back. The system clipboard is
    // shared global state — any other process (or a human at the keyboard) copying
    // during the poll would clobber it and flake the assertion. Intercepting the
    // write still exercises the full path (PowerShell → ConPTY → xterm OSC 52 handler
    // → preload bridge → main IPC → clipboard.writeText) and asserts the exact decoded
    // text arrived, deterministically.
    await app.evaluate(({ clipboard }) => {
      const w = globalThis as unknown as { __clipWrites?: string[] };
      w.__clipWrites = [];
      const orig = clipboard.writeText.bind(clipboard);
      clipboard.writeText = (text: string, type?: 'selection' | 'clipboard') => {
        w.__clipWrites!.push(text);
        return orig(text, type);
      };
    });

    // Make PowerShell emit the raw OSC 52 sequence on its stdout. Written to the PTY
    // as if typed; the sequence flows back as terminal output and the xterm OSC 52
    // handler decodes it to the clipboard.
    const cmd = `[Console]::Write([char]27 + ']52;c;${B64}' + [char]7)`;
    await win.evaluate(
      ({ panelId, line }) => window.throng?.terminal?.write(panelId, `${line}\r`),
      { panelId: pid, line: cmd },
    );

    await expect
      .poll(
        () =>
          app!.evaluate(() => (globalThis as unknown as { __clipWrites?: string[] }).__clipWrites ?? []),
        { timeout: 15000 },
      )
      .toContain(EXPECTED);
  } finally {
    // Destroy the windows to bypass the FR-015 app-close warning dialog (a running
    // terminal makes a plain app.close() stall on the unanswered prompt, leaving the
    // window hanging around). Destroy fires no `close` event, so the handshake is
    // skipped; app.close() then just finalises the exiting process.
    if (app) {
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const wnd of BrowserWindow.getAllWindows()) if (!wnd.isDestroyed()) wnd.destroy();
        })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 150));
      await app.close().catch(() => {});
    }
    try {
      daemon.kill();
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const d of [dataDir, cfg, userData, root]) {
      cleanupTemp(d);
    }
  }
});

/*
 * The two tests that need the IN-PROCESS clipboard seam share one app, one daemon and one window.
 *
 * `THRONG_E2E_CLIPBOARD: 'memory'` is set exactly as both tests already set it — the launch below is
 * their launch, hoisted, not a different one. What each test keeps for itself is the thing that
 * never depended on the app: its own `mkdtemp` project root, and its own `cleanupTemp` in a
 * `finally`.
 *
 * The per-test app-destroying `finally` blocks are gone: `shutdownApp` performs the same FR-015
 * handshake bypass those blocks were hand-rolling (destroy every BrowserWindow, then close), so the
 * `afterAll` covers it once instead of twice.
 */
test.describe('the two tests that need the in-process clipboard seam', () => {
  let daemon: ChildProcess;
  let app: ElectronApplication;
  let win: Page;
  let dataDir: string;
  let cfg: string;
  let userData: string;

  test.beforeAll(async () => {
    const pipe = `\\\\.\\pipe\\throng-clipshared-${process.pid}-${Date.now()}`;
    dataDir = mkdtempSync(join(tmpdir(), 'clipshared-data-'));
    cfg = mkdtempSync(join(tmpdir(), 'clipshared-cfg-'));
    userData = mkdtempSync(join(tmpdir(), 'clipshared-ud-'));

    daemon = spawn(process.execPath, [daemonEntry], {
      env: { ...process.env, THRONG_PIPE_NAME: pipe, THRONG_DATABASE_PATH: join(dataDir, 'throng.db') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((res) => daemon.stdout!.on('data', (c: string) => c.includes('listening') && res()));

    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      // The in-process clipboard seam, as `harness.ts` uses for every app it launches. Without it
      // these tests PASTE THE DEVELOPER'S REAL CLIPBOARD: Electron's clipboard does not work under
      // this harness, so the token written below never lands, and Paste delivers whatever the
      // machine happened to be holding. Measured on a dev box carrying multi-line text — the shell
      // showed a wall of PowerShell `>>` continuation prompts and the assertion failed 3/3, on a
      // clean master too. CI passes only because a fresh runner's clipboard is empty.
      env: {
        ...process.env,
        THRONG_PIPE_NAME: pipe,
        THRONG_CONFIG_ROOT: cfg,
        THRONG_E2E_CLIPBOARD: 'memory',
        // The same argument, one resource along: this file types into a REAL PowerShell, and
        // PSReadLine would write every one of those commands into the developer's own history
        // file, evicting theirs once its 4096-entry cap is passed (#339).
        THRONG_TEST_SHELL_HISTORY: 'off',
      },
    });
    win = await app.firstWindow();
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
  });

  test.afterAll(async () => {
    // `shutdownApp` destroys every BrowserWindow before closing, which is the FR-015 handshake
    // bypass each test used to hand-roll — necessary here too, because a live terminal makes a plain
    // `app.close()` stall on a prompt Playwright never answers.
    if (app) await shutdownApp(app);
    try {
      daemon.kill();
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const d of [dataDir, cfg, userData]) {
      cleanupTemp(d);
    }
  });

  // The terminal's right-click menu is the app's OWN themed ContextMenu (data-testid
  // `context-menu`), not the OS-native Electron menu it used to pop. Playwright cannot
  // even see a native OS menu, so its testid appearing is itself the proof the styling
  // bug is fixed — the menu is now a DOM element drawn from the theme like every other
  // menu. We also drive Paste end-to-end (clipboard → terminal.write) to prove the two
  // actions survived the move off the native menu.
  test('right-clicking the terminal opens the themed in-app menu, and Paste works', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
    const PASTE = 'throngPasteToken99';
    const root = mkdtempSync(join(tmpdir(), 'clipmenu-root-'));

    try {
      await win.getByTestId('project-new').click();
      await win.getByTestId('project-root-input').fill(root);
      await win.getByTestId('project-name-input').fill('ClipMenu');
      await win.getByTestId('project-save').click();
      /*
       * 034 FR-045 — settle on the new project being ACTIVE before reading a panel id.
       *
       * Creating a project swaps the entire workspace. With one app per test there was never a
       * previous project, so reading `.panel-box` immediately was safe; under a shared app it can
       * capture the OUTGOING project's panel — and every later `terminal-<dead id>` then waits out
       * the whole test budget for an element that can never exist. The harness's `createProject`
       * carries this settle for the same reason.
       */
      const activeProject = win.locator('.project-item[data-active="true"]');
      await expect(activeProject).toHaveCount(1);
      await expect(activeProject).toContainText('ClipMenu');
      /*
       * The id is read from the TYPE SELECT, not from `.panel-box` (#299 sweep).
       *
       * A new project's panel is UNTYPED and shows a type select; the previous test's terminal
       * panel does not. `.panel-box` .first() cannot tell them apart, and settling on the
       * project item does not mean the panel has been swapped yet — so the read could return the
       * OUTGOING panel's id, after which every `panel-type-select-<id>` call waits out its full
       * budget against an element that will never exist. Measured as a 30s `selectOption`
       * timeout on CI, passing on retry.
       */
      const typeSelect = win.locator('[data-testid^="panel-type-select-"]');
      await expect(typeSelect).toHaveCount(1);
      const pid =
        (await typeSelect.getAttribute('data-testid'))?.slice('panel-type-select-'.length) ?? '';
      expect(pid).not.toBe('');
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });

      // Right-click the terminal body → the app's themed menu, with Copy and Paste.
      await win.getByTestId(`terminal-${pid}`).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toHaveCount(1);
      await expect(win.getByTestId('menu-item-Copy')).toBeVisible();
      await expect(win.getByTestId('menu-item-Paste')).toBeVisible();

      // Seed the clipboard (in E2E this is the in-process seam), then Paste. The token is
      // typed into the shell via terminal.write and PowerShell echoes it, so it lands in
      // the terminal buffer — proving the Paste action still writes to the live shell.
      await win.evaluate(
        (text) => window.throng?.clipboard?.write({ text, mode: 'verbatim' }),
        PASTE,
      );
      await win.getByTestId('menu-item-Paste').click();
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(PASTE, { timeout: 15000 });
    } finally {
      // This root is still the live PowerShell's cwd, so Windows will refuse the unlink and
      // `cleanupTemp` will log `[cleanup] EBUSY … — left for the temp sweep`. That is its documented
      // behaviour and `globalTeardown` removes the whole per-run folder. See the file header.
      cleanupTemp(root);
    }
  });

  // #142: Ctrl+V must paste the clipboard into the terminal — and EXACTLY once. xterm 6.0 has
  // no key-driven paste: it pastes only from a DOM `paste` event, which Chromium fires from Ctrl+V
  // only when the app menu supplies an Edit role — and throng ships a Help-only menu, so Ctrl+V did
  // nothing at all. (The same xterm also binds its paste handler to BOTH the hidden textarea and its
  // parent element, so a single native paste is written to the pty twice — the "double paste" half of
  // the report.) We assert the fix at the pty boundary rather than by reading the buffer: intercept
  // the `throng:terminal:write` IPC in the main process and count how many writes carried the token.
  // Nothing pastes → 0 (the old bug); a correct single paste → exactly 1; a double paste → 2.
  test('#142: Ctrl+V pastes the clipboard into the terminal exactly once', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
    const PASTE = 'throngCtrlVToken77';
    const root = mkdtempSync(join(tmpdir(), 'ctrlv-root-'));

    try {
      await win.getByTestId('project-new').click();
      await win.getByTestId('project-root-input').fill(root);
      await win.getByTestId('project-name-input').fill('CtrlV');
      await win.getByTestId('project-save').click();
      // 034 FR-045 — the same settle as the test above, and this is the one that needs it: test 2's
      // terminal panel is still on screen for a beat after `project-save`, so a `.panel-box` read
      // taken now can return ITS id rather than this project's.
      const activeProject = win.locator('.project-item[data-active="true"]');
      await expect(activeProject).toHaveCount(1);
      await expect(activeProject).toContainText('CtrlV');
      /*
       * The id is read from the TYPE SELECT, not from `.panel-box` (#299 sweep).
       *
       * A new project's panel is UNTYPED and shows a type select; the previous test's terminal
       * panel does not. `.panel-box` .first() cannot tell them apart, and settling on the
       * project item does not mean the panel has been swapped yet — so the read could return the
       * OUTGOING panel's id, after which every `panel-type-select-<id>` call waits out its full
       * budget against an element that will never exist. Measured as a 30s `selectOption`
       * timeout on CI, passing on retry.
       */
      const typeSelect = win.locator('[data-testid^="panel-type-select-"]');
      await expect(typeSelect).toHaveCount(1);
      const pid =
        (await typeSelect.getAttribute('data-testid'))?.slice('panel-type-select-'.length) ?? '';
      expect(pid).not.toBe('');
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 20000 });

      // Seed the clipboard (in E2E this is the in-process seam), focus the terminal, and press Ctrl+V.
      await win.evaluate((text) => window.throng?.clipboard?.write({ text, mode: 'verbatim' }), PASTE);
      // Focus xterm's own hidden input surface directly — a click on the panel does not reliably move
      // keyboard focus onto it under Playwright, and the key must reach xterm's key handler to be pasted.
      const xtermInput = win.locator(`[data-testid="terminal-${pid}"] .xterm-helper-textarea`);
      await xtermInput.focus();
      await expect(xtermInput).toBeFocused();
      await win.keyboard.press('Control+V');

      // It must reach the shell at all — the old bug was that Ctrl+V did nothing. `toContainText`
      // matches on `textContent`, which is where xterm's DOM renderer puts the glyphs (its `innerText`
      // is empty because the row spans are absolutely positioned).
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(PASTE, { timeout: 15000 });

      // …and EXACTLY once. A double paste (xterm binds its paste handler to both the textarea and its
      // parent element) writes the token to the pty twice, echoing as two adjacent copies. Count on the
      // visible rows only — NOT the whole terminal, whose `.xterm-accessibility` mirror would duplicate
      // every glyph and make a single paste read as two.
      //
      // Scoped to THIS terminal and THIS token, which is why it survives a shared app: test 2's
      // terminal has unmounted (only the active project's layout renders) and its token is different.
      const tokenCount = (): Promise<number> =>
        win
          .locator(`[data-testid="terminal-${pid}"] .xterm-rows`)
          .textContent()
          .then((t) => (t?.match(new RegExp(PASTE, 'g')) ?? []).length);

      /*
       * The fence: a would-be duplicate write goes down the SAME `throng:terminal:write` channel as
       * the paste itself (that channel is exactly what the old bug shared between the two bound
       * handlers), so any second write is already queued ahead of whatever this test sends next. Send
       * a distinct token — not Enter, which would submit the pasted line and could scroll the row this
       * test is about to count out of `.xterm-rows` — and wait for ITS echo. By the time it lands, a
       * duplicate paste (if one happened) landed first.
       */
      const FENCE = 'clipboardFence7Q';
      await win.evaluate((args) => window.throng?.terminal?.write?.(args.id, args.text), {
        id: pid,
        text: FENCE,
      });
      await expect(win.getByTestId(`terminal-${pid}`)).toContainText(FENCE, { timeout: 15000 });

      expect(await tokenCount()).toBe(1);
    } finally {
      cleanupTemp(root);
    }
  });
});
