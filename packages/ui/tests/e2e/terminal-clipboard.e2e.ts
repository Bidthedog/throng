import { basename } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { skipIfElevated } from './admin.js';

// Clipboard support (005): a program running inside the terminal — Claude Code,
// tmux, vim — copies to the system clipboard by emitting an OSC 52 escape sequence.
// xterm.js ignores OSC 52 unless a handler is registered, so before this fix the
// copy silently no-op'd ("it says copied but nothing is on the clipboard"). Here we
// drive a real Windows PowerShell terminal to emit `ESC ] 52 ; c ; <base64> BEL`
// and assert the decoded text reaches the OS (Electron) clipboard.

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

// base64("throngClip42") — what the shell will OSC-52 onto the clipboard.
const EXPECTED = 'throngClip42';
const B64 = 'VGhyb25nQ2xpcDQy';

test('an OSC 52 sequence from inside the terminal writes to the system clipboard', async () => {
  skipIfElevated();
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
      env: { ...process.env, THRONG_PIPE_NAME: pipe, THRONG_CONFIG_ROOT: cfg },
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
    const pid = await win
      .locator('.panel-box')
      .first()
      .evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
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
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});
