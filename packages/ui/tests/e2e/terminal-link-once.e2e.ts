import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';

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

/** Run the printed script and wait for `printed` to appear in the terminal. */
async function runScript(win: Page, term: Locator, printed: string): Promise<void> {
  await term.click();
  await win.keyboard.type('.\\lnk.ps1');
  await win.keyboard.press('Enter');
  await expect(term).toContainText(printed, { timeout: 25_000 });
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
  await win.waitForTimeout(300);
  if (opts.ctrl) await win.keyboard.down('Control');
  await win.mouse.down();
  await win.mouse.up();
  if (opts.ctrl) await win.keyboard.up('Control');
}

test('Ctrl+clicking an OSC 8 link whose text IS the url opens the browser exactly once', async () => {
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
      // Held past the click so a SECOND, later open would still be caught.
      await win.waitForTimeout(1000);
      expect(await opens.urls()).toEqual([url]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Ctrl+clicking a PLAIN-TEXT url opens exactly once', async () => {
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
      await win.waitForTimeout(1000);
      expect(await opens.urls()).toEqual([url]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('Ctrl+clicking an OSC 8 link with non-url text opens its TARGET, exactly once', async () => {
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
      await win.waitForTimeout(1000);
      expect(await opens.urls()).toEqual([url]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

test('a PLAIN click on a link opens nothing — it keeps its terminal meaning', async () => {
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

      await win.waitForTimeout(1200);
      expect(await opens.urls()).toEqual([]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
