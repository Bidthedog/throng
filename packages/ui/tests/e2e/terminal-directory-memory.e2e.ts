import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId, cleanupTemp} from './harness.js';
import { skipIfElevated } from './admin.js';

/**
 * 025 US3 / FR-027 — a Terminal Panel remembers the directory it was last working in, for EVERY
 * built-in flavour.
 *
 * Asserted against the **persisted layout in SQLite**, not a second app run. That is deliberate:
 * what was broken is whether the directory is ever recorded at all, and reading the row answers
 * exactly that, with no dependency on restore ordering or on how a second launch reopens a
 * project. Each shell reports its cwd differently, so one passing flavour proves nothing about
 * the others — which is why this is table-driven.
 */

const FLAVOURS = ['cmd', 'windows-powershell', 'pwsh', 'git-bash'] as const;

/**
 * Flavours whose live cwd the daemon does not currently report.
 *
 * These fail at the HEADER assertion below — i.e. the cwd is never observed at all, upstream of
 * directory memory — so they are marked `fixme` rather than deleted: the test is correct and the
 * product is not. `terminal-cwd.e2e.ts` only ever covered `cmd`, which is why this was
 * never seen.
 *
 * THAT FILE IS NOW GONE (034 FR-045), absorbed here. Its whole body was: confirm a cmd
 * terminal, assert `panel-cwd-<pid>` shows the project root, type `cd deepdir`, assert the
 * header follows. The `[cmd]` case below performs exactly those steps and then asserts two
 * things it never did — that the live xterm node SURVIVES the recording (no tear-down flash),
 * and that the directory reaches the persisted layout, which is what the next launch reads.
 * A strict superset, for one app launch instead of two.
 *
 * `windows-powershell` was the first taken off this list. Its `Set-Location` never moves the
 * process working directory, so no external read can ever see it; shell integration (on by
 * default) makes the shell report it instead. Remove an entry here the moment its shell reports.
 */
const CWD_NOT_REPORTED = new Set<string>();

/** `cd` into `dir`, spelled the way each shell expects. */
function cdLine(flavour: string, dir: string): string {
  return flavour === 'git-bash' ? `cd ./${dir}` : `cd ${dir}`;
}

/** Poll the persisted layout until `predicate` holds — the row is real and observable. */
async function expectLayout(
  dataDir: string,
  projectName: string,
  predicate: (layoutJson: string) => boolean,
  message: string,
): Promise<void> {
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(join(dataDir, 'throng.db'), { readonly: true });
          const row = db
            .prepare(
              `SELECT w.layout_json AS json FROM workspace_layout w
                 JOIN projects p ON p.id = w.project_id WHERE p.name = ?`,
            )
            .get(projectName) as { json?: string } | undefined;
          return row?.json !== undefined && predicate(row.json);
        } catch {
          return false; // not written yet, or a transient read of a mid-write DB
        } finally {
          db?.close();
        }
      },
      { timeout: 20_000, message },
    )
    .toBe(true);
}

for (const flavour of FLAVOURS) {
  test(`[${flavour}] the working directory is remembered against the panel (FR-027)`, { tag: ['@extended', '@terminal'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
    test.fixme(
      CWD_NOT_REPORTED.has(flavour),
      `${flavour}: the daemon does not report this shell's live cwd, so nothing downstream can remember it`,
    );
    test.setTimeout(120_000);
    const root = mkdtempSync(join(tmpdir(), `throng-dirmem-${flavour}-`));
    mkdirSync(join(root, 'deepdir'));
    const data = mkdtempSync(join(tmpdir(), 'throng-dirmem-data-'));
    let present = true;
    try {
      await runApp(
        async (_app, win) => {
          await createProject(win, 'DirMem', root);
          const pid = await firstPanelId(win);
          await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
          const select = win.getByTestId('terminal-flavour');
          await expect(select).toBeVisible();
          const values = await select
            .locator('option')
            .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
          if (!values.includes(flavour)) {
            present = false;
            return;
          }
          await select.selectOption(flavour);
          // Ships ON — asserted rather than ticked, so a silently flipped default fails here.
          await expect(win.getByTestId('terminal-remember-directory')).toBeChecked();
          await win.getByTestId(`panel-type-confirm-${pid}`).click();

          const term = win.getByTestId(`terminal-${pid}`);
          await expect(term).toBeVisible();
          await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText(basename(root), {
            timeout: 25_000,
          });

          await term.click();
          // Tag the LIVE xterm node. Recording the directory must not tear the terminal down and
          // re-attach it -- that is what the user sees as a flash. A re-attach disposes the xterm
          // and builds a new one, so the tagged node disappears. Counting replayed output does NOT
          // detect this (the replay reproduces the same text), which is why the identity of the
          // node is the signal.
          await term.evaluate((el) => {
            el.querySelector('.xterm')?.setAttribute('data-noflash-probe', '1');
          });
          const tagged = await term.evaluate(
            (el) => el.querySelector('.xterm[data-noflash-probe="1"]') !== null,
          );
          expect(tagged, 'could not tag the xterm node').toBe(true);

          await win.keyboard.type(cdLine(flavour, 'deepdir'));
          await win.keyboard.press('Enter');
          // The daemon's cwd observation is what directory memory is built on. Asserting the
          // header first separates "the shell never reported it" from "we saw it and failed to
          // persist it" — two very different bugs that look identical from the outside.
          await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText('deepdir', {
            timeout: 25_000,
          });

          // The very same xterm node must still be there.
          const survived = await term.evaluate(
            (el) => el.querySelector('.xterm[data-noflash-probe="1"]') !== null,
          );
          expect(
            survived,
            'the terminal was torn down and re-attached when the directory changed (the flash)',
          ).toBe(true);

          // …and it must reach the persisted layout, which is what the next launch reads.
          await expectLayout(
            data,
            'DirMem',
            (json) => /"lastCwd":"[^"]*deepdir/i.test(json),
            `[${flavour}] terminalMemory.lastCwd was never persisted with deepdir`,
          );
        },
        { dataDir: data },
      );
      test.skip(!present, `${flavour} is not installed on this machine`);
    } finally {
      for (const d of [root, data]) {
        cleanupTemp(d);
      }
    }
  });
}

test('with "Reopen in the last directory" OFF, nothing is remembered (FR-027a)', { tag: ['@extended', '@terminal'] }, async () => {
  // Measured on CI run 30943045917: passes without admin rights, fails with them. An elevated
  // daemon routes terminals through the de-elevated agent, a different process tree these
  // assertions do not describe — the condition this guard exists for.
  skipIfElevated();
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-dirmem-off-'));
  mkdirSync(join(root, 'deepdir'));
  const data = mkdtempSync(join(tmpdir(), 'throng-dirmem-off-data-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'DirMemOff', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        await expect(win.getByTestId('terminal-flavour')).toBeVisible();
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId('terminal-remember-directory').uncheck();
        await win.getByTestId(`panel-type-confirm-${pid}`).click();

        const term = win.getByTestId(`terminal-${pid}`);
        await expect(term).toBeVisible();
        // Wait for the shell to settle at the project root before typing, exactly as the
        // remembered case does — otherwise the `cd` races the prompt and never registers.
        await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText(basename(root), {
          timeout: 25_000,
        });
        await term.click();
        await win.keyboard.type('cd deepdir');
        await win.keyboard.press('Enter');
        await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText('deepdir', {
          timeout: 25_000,
        });

        // The panel's own config must record the opt-out…
        await expectLayout(
          data,
          'DirMemOff',
          (json) => json.includes('"rememberDirectory":false'),
          'the rememberDirectory opt-out was never persisted',
        );
        // …and no directory may be recorded for it.
        await expectLayout(
          data,
          'DirMemOff',
          (json) => !/"lastCwd":/.test(json),
          'a directory was remembered even though the option was off',
        );
      },
      { dataDir: data },
    );
  } finally {
    for (const d of [root, data]) {
      cleanupTemp(d);
    }
  }
});

/*
 * ══ MOVED (034 FR-045) — "with shell integration OFF, PowerShell cannot offer 'Reopen in the
 * last directory'" ══
 *
 * It seeded `{ terminals: { shellIntegration: false } }` into a temp config root and launched a
 * whole Electron app to read two checkbox states off a form. It never started a shell — and
 * because the setting has to be on disk BEFORE the app starts, it could not share an app with
 * its neighbours either, so it cost a launch entirely of its own.
 *
 * SPLIT THREE WAYS, because a partial replacement is not a replacement (FR-047). The claim ran
 * settings.json → flavour → IPC → hook → disabled checkbox, and no single layer holds all of it:
 *
 *   1. `packages/core/tests/unit/terminal-flavour-reports-directory.test.ts` — `mergeFlavours`
 *      carries `settings.shellIntegration` onto every flavour it builds, on BOTH branches
 *      (detected built-ins and user entries), for all four built-in shells rather than the one
 *      the E2E drove. `flavourReportsDirectory` already had unit tests and they were green
 *      throughout; what had none was whether the dropdown is actually built from it.
 *   2. `packages/ui/tests/component/terminal-panel-type-inputs.test.ts` — the flag reaching a
 *      rendered, disabled, unchecked control, driven through the REAL `useFlavours` hook over a
 *      fake preload bridge so the mapping at `use-flavours.ts:25` is under test rather than
 *      stubbed past. Stronger than the E2E in one respect: it also asserts the control says WHY
 *      it is inert, which is the difference between a disabled box and a disabled box a user can
 *      do something about.
 *   3. `ipcMain.handle('throng:terminal:listFlavours')` → `shellDetectionService.listFlavours()`
 *      (main.ts:1290) is covered by NEITHER. It is a one-line delegation with no logic in it, and
 *      it is named here rather than left implied because an unstated gap is what FR-046a exists
 *      to stop.
 *
 * ANTI-VACUITY CONTROLS, both mandatory before believing the above: make `stubBridge` resolve
 * `[]` and all 4 component tests fail on the awaited `terminal-flavour`; make `mergeFlavours`
 * return `[]` and all 5 unit tests fail.
 *
 * WHAT STAYS: the five below. Each drives a REAL shell of a different flavour, types a `cd` into
 * it, and waits for the daemon's own observation of the new directory to reach the panel header
 * and the persisted layout. That is PTY fidelity end to end, and nothing cheaper can see it.
 */
