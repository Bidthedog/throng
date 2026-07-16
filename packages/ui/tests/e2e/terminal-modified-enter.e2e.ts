import { copyFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';
import { tmpDir, registerTempCleanup } from './temp-file-helpers.js';

/**
 * #90 — terminal keyboard fidelity for a modified Enter. Drives the REAL key path (xterm +
 * attachCustomKeyEventHandler + ConPTY) end to end. What a modified Enter SHOULD become depends on
 * how the program on the other end reads input, so there are two observable cases:
 *
 *   - a PowerShell prompt (win32-input-mode): a modified Enter must insert a soft line break AND
 *     ADVANCE THE CURSOR to the continuation line. Asserted against PSReadLine's real render — a bare
 *     LF here strands the cursor on the first line (the follow-up bug this proves fixed).
 *   - a program that NEGOTIATED the kitty protocol (e.g. Claude Code): a distinct CSI-u sequence,
 *     which takes precedence over win32-input. Its exact bytes are captured by a Node program on the
 *     other end; marker chars between presses make every byte attributable — which is how the
 *     original trailing-`\r` bug (`\x1b[13;2u\r`) was caught.
 *
 * The third encoding — a bare `\n` when NEITHER protocol is active — is covered by unit tests, not
 * here: no in-app raw-byte prompt can reach the `\n` branch to observe it, because ConPTY swallows a
 * child's attempt to turn win32-input off once a console shell has enabled it. The kitty case uses
 * cmd only because it is always present and can host `node`.
 */

const KITTY = fileURLToPath(new URL('./fixtures/kitty-echo.mjs', import.meta.url)); // enables kitty

// Both cases leave a shell sitting at a prompt with the project root as its CWD, which locks the
// directory on Windows until the process has fully gone. Removing it inline would race that lock and
// fail the test in teardown with every assertion green (017 FR-013a/FR-014), so the removal is
// tracked and best-effort.
registerTempCleanup();

/**
 * Does THIS machine's console host actually ask for win32-input-mode?
 *
 * The PowerShell case below can only work where it does: throng sends the win32 key event *only* to a
 * program that requested the mode (`CSI ? 9001 h`), and falls back to a bare LF otherwise — so where
 * nothing requests it, PSReadLine gets the LF, strands the cursor, and the assertion legitimately
 * fails. That is not a throng bug to fix in the test; it is the environment lacking the mechanism the
 * fix is built on. Observed on the `windows-2022` CI image (build 20348) while a Windows 11 dev box
 * negotiates it fine.
 *
 * So gate on the precondition ITSELF rather than on a proxy: spawn a real powershell.exe over ConPTY
 * and see whether `?9001h` comes back. Guessing from an OS build number or an elevation check would
 * only be modelling the cause — this measures the thing the fix actually depends on, and starts
 * running by itself the day the platform gains it. node-pty is a plain-Node native module and this is
 * a plain-Node process, so requiring it here is safe (Electron's main process must not).
 */
async function negotiatesWin32Input(): Promise<boolean> {
  const pty = createRequire(import.meta.url)('node-pty') as {
    spawn(file: string, args: string[], opts: Record<string, unknown>): {
      onData(cb: (d: string) => void): void;
      kill(): void;
    };
  };
  return await new Promise<boolean>((resolve) => {
    const p = pty.spawn('powershell.exe', ['-NoLogo', '-NoProfile'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 20,
      cwd: process.cwd(),
    });
    const done = (v: boolean): void => {
      clearTimeout(timer);
      try {
        p.kill();
      } catch {
        // already gone — nothing to clean up
      }
      resolve(v);
    };
    const timer = setTimeout(() => done(false), 20000); // no request within a prompt's lifetime → absent
    p.onData((d) => {
      if (d.includes('?9001h')) done(true);
    });
  });
}

/** Open a terminal on `cmd`, run `node <fixture>`, and return the terminal locator + a byte reader. */
async function runFixture(win: Page, root: string, ready: string) {
  await createProject(win, 'ME', root);
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  const term = win.getByTestId(`terminal-${pid}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(basename(root), { timeout: 20000 }); // prompt up before typing
  await term.click();
  await win.keyboard.type('node k.mjs', { delay: 40 });
  await win.keyboard.press('Enter');
  await expect(term).toContainText(ready, { timeout: 30000 });
  await term.click();
  return term;
}

async function readCapture(root: string): Promise<string> {
  const capFile = join(root, 'cap.bin');
  await expect.poll(() => readFileSync(capFile).toString('latin1'), { timeout: 15000 }).toContain('d');
  return readFileSync(capFile).toString('latin1');
}
const between = (got: string, l: string, r: string) => got.slice(got.indexOf(l) + 1, got.indexOf(r));

test('at a PowerShell prompt, a modified Enter inserts a soft line break and the cursor advances', async () => {
  test.skip(
    !(await negotiatesWin32Input()),
    "this console host never requests win32-input-mode, so there is no key event to send and throng correctly falls back to a bare LF — the cursor advance it buys is not available here to observe (seen on windows-2022 / build 20348)",
  );
  const root = tmpDir('throng-me-pwsh-');
  await runApp(async (_app, win) => {
    await createProject(win, 'ME', root);
    const pid = await firstPanelId(win);
    await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win.getByTestId('terminal-flavour').selectOption('windows-powershell');
    await win.getByTestId(`panel-type-confirm-${pid}`).click();
    const term = win.getByTestId(`terminal-${pid}`);
    await expect(term).toBeVisible();
    await expect(term).toContainText(basename(root), { timeout: 30000 }); // PS prompt (cwd) is up
    await term.click();
    // Type a token, a modified Enter, then a second token. PSReadLine shows a `>> ` continuation
    // line; the second token must land ON it (cursor advanced). The old bare-LF bug left the cursor
    // on the first line, so the second token merged with the first and the continuation showed the
    // FIRST token instead. We drive Ctrl+Enter specifically — the reported key, and the one whose
    // PSReadLine binding (InsertLineAbove) would open a line ABOVE the one being typed; it only does
    // the right thing because throng forces Shift, making it InsertLineBelow.
    await win.keyboard.type('AAA', { delay: 60 });
    await win.keyboard.press('Control+Enter');
    await win.keyboard.type('BBB', { delay: 60 });
    const screen = () => term.evaluate((el) => el.textContent ?? '');
    await expect.poll(screen, { timeout: 15000 }).toMatch(/>>\s*BBB/); // BBB on the continuation line
    expect(await screen()).not.toMatch(/AAABBB/); // never merged onto one line
  });
});

test('a program that negotiates the kitty protocol gets a distinct CSI-u sequence', async () => {
  const root = tmpDir('throng-me-kitty-');
  copyFileSync(KITTY, join(root, 'k.mjs'));
  await runApp(async (_app, win) => {
    await runFixture(win, root, 'KITTY_ECHO_READY');
    // a <Shift+Enter> b <Ctrl+Enter> c <Enter> d
    await win.keyboard.type('a', { delay: 40 });
    await win.keyboard.press('Shift+Enter');
    await win.keyboard.type('b', { delay: 40 });
    await win.keyboard.press('Control+Enter');
    await win.keyboard.type('c', { delay: 40 });
    await win.keyboard.press('Enter');
    await win.keyboard.type('d', { delay: 40 });

    const got = await readCapture(root);
    expect(between(got, 'a', 'b')).toBe('\x1b[13;2u'); // Shift+Enter — distinct, NO trailing \r
    expect(between(got, 'b', 'c')).toBe('\x1b[13;5u'); // Ctrl+Enter — distinct
    expect(between(got, 'c', 'd')).toBe('\r'); // plain Enter — unchanged
  });
});
