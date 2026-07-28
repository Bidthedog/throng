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
      async (_app, win) => {
        await createProject(win, project, root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await expect(win.getByTestId('terminal-flavour')).toBeVisible();
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        if (opts.startupCommand !== undefined) {
          await win.getByTestId('terminal-startup-command').fill(opts.startupCommand);
        }
        const remember = win.getByTestId('terminal-remember-command');
        if (opts.remember) await remember.check();
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText(basename(root), {
          timeout: 25_000,
        });
        await body({ win, pid, data, term });
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
