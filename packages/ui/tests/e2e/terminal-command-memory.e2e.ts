import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';

/**
 * 025 US2 — the command-memory rule, driven through the real app (T032).
 *
 * The six worked examples are already unit-tested against `captureDecision`, but that proves the
 * RULE, not the pipeline: the value fed to it is produced by a daemon observation, an IPC
 * notification, a renderer store and a layout write, and three separate defects lived in exactly
 * that stretch while the unit tests stayed green. So these assert against the **persisted layout**,
 * which is what a later launch actually reads.
 *
 * `observedCommand` is the raw observation, persisted as it changes so an abrupt end still
 * captures. `startupCommand` is the decided value. Asserting on both is what distinguishes
 * "nothing was seen" from "it was seen and correctly not promoted".
 */

const LONG_RUNNING = 'ping -t 127.0.0.1';

/** Ask the main process to close the primary window, firing the real close handshake. */
async function requestClose(app: import('@playwright/test').ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

function layoutJson(dataDir: string, project: string): string | undefined {
  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(join(dataDir, 'throng.db'), { readonly: true });
    const row = db
      .prepare(
        `SELECT w.layout_json AS json FROM workspace_layout w
           JOIN projects p ON p.id = w.project_id WHERE p.name = ?`,
      )
      .get(project) as { json?: string } | undefined;
    return row?.json;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

async function expectLayout(
  dataDir: string,
  project: string,
  predicate: (json: string) => boolean,
  message: string,
): Promise<void> {
  await expect
    .poll(() => {
      const json = layoutJson(dataDir, project);
      return json !== undefined && predicate(json);
    }, { timeout: 20_000, message })
    .toBe(true);
}

/** Set up a terminal with the given startup command and memory state, then run `body`. */
async function withTerminal(
  project: string,
  opts: { startupCommand?: string; remember: boolean },
  body: (ctx: {
    app: import('@playwright/test').ElectronApplication;
    win: import('@playwright/test').Page;
    pid: string;
    data: string;
    term: import('@playwright/test').Locator;
  }) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'throng-cmdmem-'));
  const data = mkdtempSync(join(tmpdir(), 'throng-cmdmem-data-'));
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, project, root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await expect(win.getByTestId('terminal-flavour')).toBeVisible();
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        if (opts.startupCommand !== undefined) {
          await win.getByTestId('terminal-startup-command').fill(opts.startupCommand);
        }
        // Command memory now ships ON, so the OFF case must actively UNCHECK it. Asserting the
        // shipped state here rather than ticking blindly means a silently flipped default fails.
        const remember = win.getByTestId('terminal-remember-command');
        await expect(remember).toBeChecked();
        if (!opts.remember) await remember.uncheck();
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText(basename(root), {
          timeout: 25_000,
        });
        await body({ app, win, pid, data, term });
      },
      { dataDir: data },
    );
  } finally {
    for (const d of [root, data]) {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }
}

/** Type a command into the focused terminal and wait for evidence it is running. */
async function runInTerminal(
  win: import('@playwright/test').Page,
  term: import('@playwright/test').Locator,
  line: string,
  evidence: string,
): Promise<void> {
  await term.click();
  await win.keyboard.type(line);
  await win.keyboard.press('Enter');
  await expect(term).toContainText(evidence, { timeout: 25_000 });
}

test('memory ON: a command started IN the terminal is observed and persisted (US2 row 2)', async () => {
  test.setTimeout(120_000);
  await withTerminal('MemRow2', { remember: true }, async ({ win, data, term }) => {
    await runInTerminal(win, term, LONG_RUNNING, 'Reply from');
    // The raw observation must reach the persisted layout while it is still running — this is what
    // survives an end that never runs teardown code.
    await expectLayout(
      data,
      'MemRow2',
      (j) => /"observedCommand":"[^"]*ping[^"]*"/i.test(j),
      'the running command was never observed into the persisted layout',
    );
  });
});

test('memory ON: stopping the command leaves nothing to promote (US2 rows 3 and 4)', async () => {
  test.setTimeout(120_000);
  await withTerminal('MemRow34', { startupCommand: '', remember: true }, async ({ win, data, term }) => {
    await runInTerminal(win, term, LONG_RUNNING, 'Reply from');
    await expectLayout(data, 'MemRow34', (j) => /"observedCommand":"[^"]*ping/i.test(j), 'never observed');

    // Ctrl+C stops it. The observation must fall back to "nothing running" rather than sticking,
    // because a command that has already finished must never be promoted (FR-017).
    await term.click();
    await win.keyboard.press('Control+c');
    await expectLayout(
      data,
      'MemRow34',
      (j) => /"observedCommand":null/.test(j),
      'a stopped command was still recorded as running',
    );
    // ...and the saved startup command is untouched — never filled in by a command that ended.
    const json = layoutJson(data, 'MemRow34') ?? '';
    expect(json, 'a stopped command was promoted to the startup command').not.toMatch(
      /"startupCommand":"[^"]*ping/i,
    );
  });
});

test('memory OFF: a running command is never recorded at all (US2 row 6)', async () => {
  test.setTimeout(120_000);
  await withTerminal('MemRow6', { remember: false }, async ({ win, data, term }) => {
    await runInTerminal(win, term, LONG_RUNNING, 'Reply from');
    // Give the observation at least a couple of poll intervals to prove it is genuinely not being
    // written, rather than merely slower than the assertion.
    await win.waitForTimeout(4000);
    const json = layoutJson(data, 'MemRow6') ?? '';
    expect(json, 'the layout row was never written at all').not.toBe('');
    expect(json, 'a command was recorded despite memory being off').not.toMatch(/"observedCommand":"/);
    expect(json).toMatch(/"rememberCommand":false/);
  });
});

test('memory ON: a later command replaces the earlier one (US2 row 5)', async () => {
  test.setTimeout(120_000);
  await withTerminal('MemRow5', { remember: true }, async ({ win, data, term }) => {
    await runInTerminal(win, term, LONG_RUNNING, 'Reply from');
    await expectLayout(data, 'MemRow5', (j) => /"observedCommand":"[^"]*ping/i.test(j), 'never observed');

    await term.click();
    await win.keyboard.press('Control+c');
    await expectLayout(data, 'MemRow5', (j) => /"observedCommand":null/.test(j), 'did not clear');

    // A different long-runner takes over; the observation must follow it, not stay on the ping.
    await runInTerminal(win, term, 'findstr /R x', '');
    await expectLayout(
      data,
      'MemRow5',
      (j) => /"observedCommand":"[^"]*findstr/i.test(j),
      'the observation did not follow the newer command',
    );
  });
});

test('a command that takes over REPLACES the startup command the user typed (US2 row 2)', async () => {
  test.setTimeout(180_000);
  // Reported from real use: start a terminal on `ping`, stop it, run something else, end the
  // terminal — and the something else was never saved as the Panel's Startup Command. Each piece
  // was covered (the rule, the observation, the recovery) but not this shape: a startup command
  // ALREADY set, replaced, on the end path that stranded it. Two runs, because that is the
  // user's experience: the terminal is ended in one session and read back in the next.
  const root = mkdtempSync(join(tmpdir(), 'throng-cmdover-'));
  const data = mkdtempSync(join(tmpdir(), 'throng-cmdover-data-'));
  try {
    await runApp(
      async (app, win) => {
        await createProject(win, 'MemOver', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await expect(win.getByTestId('terminal-flavour')).toBeVisible();
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId('terminal-startup-command').fill(LONG_RUNNING);
        await expect(win.getByTestId('terminal-remember-command')).toBeChecked();
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        // The startup command runs on its own — nothing is typed.
        await expect(term).toContainText('Reply from', { timeout: 25_000 });

        // Interrupt it, as a user would. The shell must survive this (FR-005).
        await term.click();
        await win.keyboard.press('Control+c');
        await expectLayout(data, 'MemOver', (j) => /"observedCommand":null/.test(j), 'the interrupted command still reads as running');

        // A different long-runner takes the foreground.
        await runInTerminal(win, term, 'findstr /R x', '');
        await expectLayout(data, 'MemOver', (j) => /"observedCommand":"[^"]*findstr/i.test(j), 'the replacement was never observed');

        // End it the way a user does with something still running.
        await requestClose(app);
        await expect(win.getByTestId('app-close-dialog')).toBeVisible({ timeout: 10_000 });
        await win.getByTestId('app-close-terminate').click();
      },
      { dataDir: data },
    );

    // Reopen. The stranded observation is recovered — and must be PERSISTED, so the Panel's
    // settings agree with what it relaunched (FR-025). Recovering it for the launch alone left
    // the saved command showing the old value forever, which is what was reported.
    await runApp(
      async (_app, win) => {
        // The recovery runs as the Panel mounts, so the project has to be open — which is also
        // exactly when the user would look at the setting.
        await win.locator('.project-item', { hasText: 'MemOver' }).click();
        const pid = await firstPanelId(win);
        await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 25_000 });
        await expectLayout(
          data,
          'MemOver',
          (j) => /"startupCommand":"[^"]*findstr/i.test(j),
          'the command that took over the terminal never replaced the saved startup command',
        );
      },
      { dataDir: data },
    );
  } finally {
    for (const d of [root, data]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});
