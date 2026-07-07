import { basename } from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { skipIfElevated } from './admin.js';

// US3 (T067/T069, partial): a terminal opened in one session is kept alive by the
// detached daemon across an app restart, reattaches on relaunch, and — crucially —
// is still counted so closing again shows the app-close warning. This is the
// "pre-existing terminal" path (one persistent daemon, two app launches).

const mainEntry = fileURLToPath(new URL('../../dist/main/main.js', import.meta.url));
const daemonEntry = fileURLToPath(new URL('../../../daemon/dist/main.js', import.meta.url));

/** Direct terminal.list count over the pipe (out-of-band daemon assertion). */
function daemonSessionCount(pipe: string): Promise<number> {
  return new Promise((resolve) => {
    const s = connect(pipe);
    let buf = '';
    const done = (n: number): void => { s.removeAllListeners(); s.destroy(); resolve(n); };
    const t = setTimeout(() => done(-1), 3000);
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'terminal.list', params: {} }) + '\n'));
    s.on('data', (c: string) => { buf += c; const nl = buf.indexOf('\n'); if (nl < 0) return; clearTimeout(t); try { done(JSON.parse(buf.slice(0, nl)).result.sessions.length); } catch { done(-2); } });
    s.on('error', () => { clearTimeout(t); done(-3); });
  });
}

const requestClose = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());

test('a pre-existing terminal reattaches after restart and still warns on close', async () => {
  skipIfElevated();
  const pipe = `\\\\.\\pipe\\throng-reattach-${process.pid}-${Date.now()}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'reattach-data-'));
  const cfg = mkdtempSync(join(tmpdir(), 'reattach-cfg-'));
  const userData = mkdtempSync(join(tmpdir(), 'reattach-ud-'));
  const root = mkdtempSync(join(tmpdir(), 'reattach-root-'));

  const daemon = spawn(process.execPath, [daemonEntry], {
    env: { ...process.env, THRONG_PIPE_NAME: pipe, THRONG_DATABASE_PATH: join(dataDir, 'throng.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((res) => daemon.stdout!.on('data', (c: string) => c.includes('listening') && res()));

  const launch = (): Promise<ElectronApplication> =>
    electron.launch({ args: [mainEntry, `--user-data-dir=${userData}`], env: { ...process.env, THRONG_PIPE_NAME: pipe, THRONG_CONFIG_ROOT: cfg } });
  const stubDialog = (app: ElectronApplication): Promise<void> =>
    app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });

  try {
    // ---- Launch 1: open a live terminal, close with "Leave running" ----
    const app1 = await launch();
    const win1 = await app1.firstWindow();
    await stubDialog(app1);
    await win1.getByTestId('project-new').click();
    await win1.getByTestId('project-root-input').fill(root);
    await win1.getByTestId('project-name-input').fill('Persist');
    await win1.getByTestId('project-save').click();
    const pid = await win1.locator('.panel-box').first().evaluate((el) => (el as HTMLElement).dataset.panelId ?? '');
    await win1.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
    await win1.getByTestId('terminal-flavour').selectOption('cmd');
    await win1.getByTestId(`panel-type-confirm-${pid}`).click();
    await expect(win1.getByTestId(`terminal-${pid}`)).toContainText(basename(root), { timeout: 15000 });
    await win1.waitForTimeout(1500); // let the layout autosave
    expect(await daemonSessionCount(pipe)).toBe(1);

    await requestClose(app1);
    await expect(win1.getByTestId('app-close-dialog')).toBeVisible({ timeout: 8000 });
    // The dialog must NOT auto-dismiss (regression: an autofocused button used to
    // self-activate the instant it appeared) — it is still up after a beat.
    await win1.waitForTimeout(800);
    await expect(win1.getByTestId('app-close-dialog')).toBeVisible();
    const closed1 = app1.waitForEvent('close', { timeout: 10000 });
    // "Leave running" quits the app; fire the DOM click directly (Playwright's
    // click() races the synchronous app-close and reports "page closed"). The app's
    // own close event is what we await.
    await win1.getByTestId('app-close-leave').evaluate((el) => (el as HTMLButtonElement).click());
    await closed1;
    expect(await daemonSessionCount(pipe)).toBe(1); // survived the UI close

    // ---- Launch 2: reattach to the pre-existing session ----
    const app2 = await launch();
    const win2 = await app2.firstWindow();
    await stubDialog(app2);
    const projItem = win2.locator('.project-item', { hasText: 'Persist' });
    await projItem.click();
    await expect(win2.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15000 });
    expect(await daemonSessionCount(pipe)).toBe(1); // reattached, not duplicated

    // Closing again MUST warn about the pre-existing terminal — and the reattached
    // session must still carry its display labels (project / flavour) in the details.
    await requestClose(app2);
    await expect(win2.getByTestId('app-close-dialog')).toBeVisible({ timeout: 8000 });
    await win2.getByTestId('app-close-details').locator('summary').click();
    await expect(win2.getByTestId('app-close-details')).toContainText('Persist');
    await expect(win2.getByTestId('app-close-details')).toContainText('Command Prompt');
    const closed2 = app2.waitForEvent('close', { timeout: 12000 });
    await win2.getByTestId('app-close-terminate').click();
    await closed2;
    await expect.poll(() => daemonSessionCount(pipe), { timeout: 8000 }).toBe(0);
  } finally {
    try { daemon.kill(); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 500));
    for (const d of [dataDir, cfg, userData, root]) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
