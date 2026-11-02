import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { runApp, openApp, createProject, switchProject, firstPanelId, cleanupTemp, type OpenApp } from './harness.js';
import { skipIfElevated } from './admin.js';

/*
 * ONE app for the two tests that run through `withTerminal` (row 2 and row 6), not one each: they differ in
 * their project and in the memory switch, nothing seeded before launch, and their only launch option is `dataDir`,
 * which is the one shared directory the layout is read back from. Serial mode: shared window, shared database.
 *
 * The last test keeps its own `runApp` calls: it ends an app and reopens a second against the SAME data directory,
 * which is the claim it makes, so it cannot share.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let sharedData: string;
test.beforeAll(async () => {
  sharedData = mkdtempSync(join(tmpdir(), 'throng-cmdmem-data-'));
  shared = await openApp({ dataDir: sharedData });
});
test.afterAll(async () => {
  await shared?.close();
  if (sharedData) cleanupTemp(sharedData);
});

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
  const data = sharedData;
  try {
    const run = async (app: OpenApp['app'], win: OpenApp['win']): Promise<void> => {
      {
        await createProject(win, project, root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await expect(win.getByTestId('terminal-flavour')).toBeVisible();
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        if (opts.startupCommand !== undefined) {
          await win.getByTestId('terminal-startup-command').fill(opts.startupCommand);
        }
        /*
         * 039 (#223) — command memory ships OFF again, so the ON case must actively CHECK it.
         *
         * This assertion was `toBeChecked()`, and its comment said it existed so that "a silently
         * flipped default fails". It did exactly that: 039 flips the default back and this test
         * went red, which is the test working rather than the test being wrong.
         *
         * What it was guarding was the DRIFTED value. 025 FR-015 requires this control to be
         * opt-in and to default OFF, and `panel-type.ts` had shipped the opposite since an
         * undocumented change — so for two releases this E2E was pinning production behaviour
         * against its own spec. Restored, with the assertion kept the same shape: assert the
         * shipped state, then change it, so the next flip is caught too.
         */
        const remember = win.getByTestId('terminal-remember-command');
        await expect(remember).not.toBeChecked();
        if (opts.remember) await remember.check();
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        await expect(win.getByTestId(`panel-handle-${pid}`)).toHaveAttribute('title', new RegExp(basename(root).replace(/\W/g, '.')), {
          timeout: 25_000,
        });
        await body({ app, win, pid, data, term });
      }
    };
    await run(shared.app, shared.win);
  } finally {
    cleanupTemp(root);
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

test('memory ON: a command started IN the terminal is observed and persisted (US2 row 2)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
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

/*
 * DELETED: 'memory ON: stopping the command leaves nothing to promote (US2 rows 3 and 4)'. Rows 3 and 4 are
 * decisions, pinned by `captureDecision` in packages/core/tests/unit/command-capture.test.ts ('3. started empty,
 * ran then STOPPED ...', '4. started with ... stopped it -> cleared'); the pipeline half — a Ctrl+C turns the
 * persisted observation back to null — is asserted again by the 'takes over' test below.
 */

test('memory OFF: a running command is never recorded at all (US2 row 6)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
  test.setTimeout(120_000);
  await withTerminal('MemRow6', { remember: false }, async ({ win, pid, data, term }) => {
    await runInTerminal(win, term, LONG_RUNNING, 'Reply from');
    /*
     * The fence: wait until the DAEMON's own observation of the running command has reached the
     * renderer, via `window.__throngTerminalCommand` (command-store.ts) — populated by the SAME
     * `terminal.command` notification the memory-gated write effect subscribes to
     * (terminal-panel.tsx:417-423), regardless of whether memory is on or off. Once that value
     * shows the running ping, the effect has had its one chance to persist it and — because
     * `rememberCommand` is false — chose not to. That is a real "the opportunity has passed"
     * condition, not a guess about how long a write takes.
     */
    await expect
      .poll(
        () =>
          win.evaluate(
            (p) =>
              (
                window as unknown as { __throngTerminalCommand?: (panelId: string) => string | null | undefined }
              ).__throngTerminalCommand?.(p) ?? null,
            pid,
          ),
        { timeout: 25_000, message: 'the daemon never observed the running ping command for this panel' },
      )
      .toMatch(/ping/i);
    const json = layoutJson(data, 'MemRow6') ?? '';
    expect(json, 'the layout row was never written at all').not.toBe('');
    expect(json, 'a command was recorded despite memory being off').not.toMatch(/"observedCommand":"/);
    expect(json).toMatch(/"rememberCommand":false/);
  });
});

/*
 * DELETED: 'memory ON: a later command replaces the earlier one (US2 row 5)'. A strict subset of the 'takes over'
 * test below, which runs the same ping, interrupts it until the observation clears, runs `findstr`, asserts the
 * observation follows it, and then goes on to prove the replacement is saved. The rule itself is row 5 of
 * `captureDecision` in packages/core/tests/unit/command-capture.test.ts.
 */

test('a command that takes over REPLACES the startup command the user typed (US2 row 2)', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
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
        /*
         * 039 (#223) — this scenario is ABOUT command memory, so it must now switch it on: the
         * shipped default is OFF again (025 FR-015, restored). The assertion before the click keeps
         * the guard the original `toBeChecked()` provided — if the default ever flips back, ticking
         * an already-ticked box would silently turn memory OFF and this test would fail somewhere
         * far away and much harder to read.
         */
        const remember = win.getByTestId('terminal-remember-command');
        await expect(remember).not.toBeChecked();
        await remember.check();
        await expect(remember).toBeChecked();
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
        // exactly when the user would look at the setting. `switchProject` rather than a bare click:
        // the panel id is read on the very next line, and a click alone returns while the OUTGOING
        // project's panels are still mounted (#290).
        await switchProject(win, 'MemOver');
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
    for (const d of [root, data]) cleanupTemp(d);
  }
});
