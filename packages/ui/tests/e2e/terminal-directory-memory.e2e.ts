import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '@playwright/test';
import { runApp, createProject, firstPanelId } from './harness.js';

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
 * product is not. `terminal-cwd.e2e.ts` only ever covered `cmd`, which is why this was never seen.
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
  test(`[${flavour}] the working directory is remembered against the panel (FR-027)`, async () => {
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
        rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
      }
    }
  });
}

test('with "Reopen in the last directory" OFF, nothing is remembered (FR-027a)', async () => {
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
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }
});

test('with shell integration OFF, PowerShell cannot offer "Reopen in the last directory"', async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'throng-dirmem-nointeg-'));
  const cfg = mkdtempSync(join(tmpdir(), 'throng-dirmem-nointeg-cfg-'));
  try {
    writeFileSync(
      join(cfg, 'settings.json'),
      JSON.stringify({ terminals: { shellIntegration: false } }, null, 2),
      'utf8',
    );
    await runApp(
      async (_app, win) => {
        await createProject(win, 'NoInteg', root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
        const select = win.getByTestId('terminal-flavour');
        await expect(select).toBeVisible();
        const values = await select
          .locator('option')
          .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
        const remember = win.getByTestId('terminal-remember-directory');

        // cmd moves its real working directory, so it never needed integration — still offered.
        await select.selectOption('cmd');
        await expect(remember).toBeEnabled();
        await expect(remember).toBeChecked();

        if (values.includes('windows-powershell')) {
          // PowerShell cannot report its directory without integration. Offering the control here
          // would look enabled and silently do nothing, which is the misleading state this guards.
          await select.selectOption('windows-powershell');
          await expect(remember).toBeDisabled();
          await expect(remember).not.toBeChecked();
        }
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    for (const d of [root, cfg]) {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }
});
