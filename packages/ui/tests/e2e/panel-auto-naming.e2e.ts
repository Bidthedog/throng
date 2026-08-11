/**
 * #218 — a panel wears the name of the thing inside it, and only a name the USER typed is custom.
 *
 * The rule this file is measured against:
 *
 * > A panel follows its terminal's name or its file's name, **unless** it is untyped (the "Select
 * > Panel Type" screen is showing) **or** the user has manually renamed it — in which case the
 * > override stands.
 *
 * Two distinct defects present as the one symptom ("Panel X" on a panel that plainly holds a
 * terminal or a file); they are told apart by whether "Reset Name" is offered.
 *
 * **Defect A — `titleIsCustom` set on panels nobody renamed** (Reset Name IS offered, and is the
 * only way to make auto-naming start). Two independent routes in, both requiring a name COLLISION,
 * which is why every existing naming spec — all single-project — stays green:
 *
 *  A1. `PanelNameSync` retitles a panel when the daemon adjusts its generated name, then broadcasts
 *      `notifyRenamed`. The main process relays that to EVERY window **including the sender**, and
 *      `PanelRenameSync` applies it with `renamePanel` — which marks the panel manually renamed. No
 *      rename box need ever open, which is why route 2 of the report (a file opened from the tree)
 *      is affected even though `createDedicatedEditor` deliberately suppresses the box.
 *  A2. The rename box is uncontrolled and seeded once at mount; `commit()` compared the submitted
 *      value against the LIVE `panel.title`, which a retitle can change underneath the open box. The
 *      user clicks a panel-type button, the box blurs, and its untouched seed no longer equals the
 *      title — so an untouched box commits a rename.
 *
 * **Defect B — no auto-title to fall back to** (Reset Name is greyed out, so there is no recovery at
 * all). Each panel kind had exactly ONE automatic source, falling through to the placeholder the
 * moment it was empty.
 *
 * ══ WHAT WAS MEASURED ON MASTER, and it matters here ══
 *
 * Defect B did **not** reproduce through either path the report names, and the two tests below
 * labelled B pass on master as well. What was measured, before any fix:
 *
 *  - **"a shell that emits no OSC title" is not reachable on Windows.** ConPTY sets the console
 *    title to the launched executable, so all four detected flavours announce one — and so does a
 *    custom flavour running a bare `node` REPL, a program that never sets a title itself.
 *  - **A reattached terminal gets its title back** from the scrollback replay, which carries the
 *    original escape sequence, so a renderer reload does not strand it either.
 *  - **A restored editor already names itself** from the `config.filePath` fallback (#97 follow-up).
 *  - Every "Panel X" that could be produced on a panel with content turned out to be defect A (the
 *    panel had been marked custom, so Reset Name was OFFERED, not greyed). The one remaining way to
 *    see the placeholder on a panel that plainly held a shell — letting the shell exit — is correct
 *    behaviour: the panel reverts to UNTYPED and shows the type-selection form again (FR-020).
 *
 * So the secondary sources (`panelDisplayTitle` in core) are a GUARD, unit-tested in
 * `packages/core/tests/unit/panel-display-title.test.ts`, and the two tests below hold the
 * end-to-end line: a panel with content never settles on a placeholder, across a reattach and
 * across a restart. Labelling them replications would be a claim the measurements do not support.
 *
 * Each test states which route it drives. Every one of them needs a cross-project name collision, a
 * restart, or the tab-strip New Tab button — the three things no existing spec combines with naming.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  firstPanelId,
  panelIds,
  reloadWindow,
  cleanupTemp,
} from './harness.js';

function makeProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(root, 'notes.md'), '# notes\n');
  return root;
}

/** Open a project that is listed but not showing — after a reload, or in a second launch. */
async function enterProject(win: Page, name: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 20_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 20_000 });
}

/** Right-click a panel header and report whether "Reset Name" is offered. */
async function resetNameEnabled(win: Page, panelId: string): Promise<boolean> {
  await win.getByTestId(`panel-handle-${panelId}`).click({ button: 'right' });
  const menu = win.getByTestId('context-menu');
  const item = win.getByTestId('menu-item-Reset Name');
  await expect(item).toBeVisible();
  const disabled = await item.isDisabled();
  /*
   * A plain Escape, and it closes the menu wherever focus happens to be — the root menu closes from
   * a WINDOW listener, not from the list's own handler.
   *
   * This is the assertion that found #228's neighbour: that listener used to be attached inside a
   * `setTimeout(…, 0)` alongside the outside-pointer one, so for a macrotask the menu was visible,
   * focused and deaf to Escape. On a busy event loop that window is wide enough to hit — 1 run in 5
   * here, and 5 in 10 while the app was still starting. Keeping the assertion (rather than merely
   * pressing and moving on) is what makes this spec able to notice it again.
   */
  await win.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(item).toHaveCount(0);
  return !disabled;
}

test('a generated name the daemon adjusts is not a rename — the panel still auto-names itself (#218 A1)', async () => {
  const rootA = makeProject('throng-a1-alpha-');
  const rootB = makeProject('throng-a1-beta-');
  try {
    await runApp(async (_app, win) => {
      // Project A owns "Panel 1". Its layout must be PERSISTED before B asks for the same name.
      await createProject(win, 'AutoAlpha', rootA);
      const a = await firstPanelId(win);
      await expect(win.getByTestId(`panel-title-${a}`)).toHaveText('Panel 1');
      await win.waitForTimeout(2500);

      // Project B's first panel is generated "Panel 1" too — panels are numbered within their own
      // layout — so the daemon adjusts it. That adjustment is throng's choice, not the user's.
      await createProject(win, 'AutoBeta', rootB);
      const b = await firstPanelId(win);
      await expect
        .poll(() => win.getByTestId(`panel-title-${b}`).textContent(), { timeout: 15_000 })
        .toBe('Panel 2');

      // THE DEFECT: the adjustment travelled to every window as a RENAME, including back to the one
      // that made it, so the panel is marked manually renamed and "Reset Name" is offered on a panel
      // nobody has renamed.
      expect(await resetNameEnabled(win, b)).toBe(false);

      // …and the consequence the user actually reports: a custom title outranks every automatic one,
      // so typing the panel leaves it wearing the placeholder instead of its shell's name.
      await win.getByTestId(`panel-type-select-${b}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${b}`).click();
      await expect(win.getByTestId(`terminal-${b}`)).toBeVisible();
      await expect(win.getByTestId(`panel-title-${b}`)).toContainText('cmd.exe', { timeout: 15_000 });
    });
  } finally {
    for (const r of [rootA, rootB]) cleanupTemp(r);
  }
});

test('an adjustment landing under an OPEN rename box is not a rename either (#218 A2)', async () => {
  const rootA = makeProject('throng-a2-alpha-');
  const rootB = makeProject('throng-a2-beta-');
  try {
    await runApp(async (_app, win) => {
      // Project A takes "Panel 1" AND "Panel 2", so the name project B's `+` will generate is
      // already spoken for and the daemon must move it.
      await createProject(win, 'BoxAlpha', rootA);
      const a = await firstPanelId(win);
      await win.getByTestId(`panel-add-${a}`).click();
      await expect(win.locator('.panel-box')).toHaveCount(2);
      await win.keyboard.press('Escape'); // leave the box without typing — nothing renamed
      await expect(win.locator('[data-testid^="panel-rename-input-"]')).toHaveCount(0);
      await win.waitForTimeout(2500); // let A's layout reach the store

      await createProject(win, 'BoxBeta', rootB);
      const b = await firstPanelId(win);

      // The header `+` opens the new panel straight into its rename box, seeded with the generated
      // name. The claim for that name resolves a beat later and moves it — under the open box.
      await win.getByTestId(`panel-add-${b}`).click();
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const added = (await panelIds(win)).find((id) => id !== b) ?? '';
      expect(added).not.toBe('');
      await expect(win.getByTestId(`panel-rename-input-${added}`)).toBeVisible();

      // Give the claim time to land while the box is still open — that is the whole scenario.
      await win.waitForTimeout(2000);

      // Leaving the box is how this ends for everyone — you click away to pick the panel's type.
      // Nothing was typed into it, so nothing has been renamed.
      await win.keyboard.press('Tab');
      await expect(win.getByTestId(`panel-rename-input-${added}`)).toHaveCount(0);

      expect(await resetNameEnabled(win, added)).toBe(false);

      await win.getByTestId(`panel-type-select-${added}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${added}`).click();
      await expect(win.getByTestId(`terminal-${added}`)).toBeVisible();
      await expect(win.getByTestId(`panel-title-${added}`)).toContainText('cmd.exe', {
        timeout: 15_000,
      });
    });
  } finally {
    for (const r of [rootA, rootB]) cleanupTemp(r);
  }
});

test('a panel created from the tab strip’s New Tab button auto-names itself (#218)', async () => {
  const root = makeProject('throng-newtab-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NewTabProj', root);
      await firstPanelId(win);

      // `addTab` does not set `lastAddedPanelId` — the TAB goes into rename mode instead — so this
      // route has different rename-box behaviour from the header `+` and was asserted nowhere.
      await win.getByTestId('tab-add').click();
      await expect(win.locator('[data-testid^="tab-rename-input-"]')).toBeVisible();
      await win.keyboard.press('Escape');

      const pid = await firstPanelId(win); // the new tab's only panel
      expect(await resetNameEnabled(win, pid)).toBe(false);

      await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
      await win.getByTestId(`editor-${pid}`).click();
      await win.getByTestId('file-explorer-tree').getByText('notes.md', { exact: true }).click();
      await expect(win.getByTestId(`panel-title-${pid}`)).toHaveText('notes', { timeout: 15_000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

test('a terminal that reattaches to its running session keeps its name (#218 B)', async () => {
  const root = makeProject('throng-reattach-name-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'ReattachNames', root);
      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible();
      await expect(win.getByTestId(`panel-title-${pid}`)).toContainText('cmd.exe', {
        timeout: 15_000,
      });

      /*
       * A RENDERER reload, deliberately: it is the harshest reattach available.
       *
       * The live window title is announced by the shell over OSC 0/2 and held in a module-level
       * store in the RENDERER, so a reload empties it while the daemon keeps the session — the panel
       * comes back attached to the very same running shell with nothing in the title store. A second
       * app launch is gentler, not harsher: the harness stops the daemon between launches, so launch
       * two starts a fresh shell that announces itself immediately.
       *
       * MEASURED: this passes on master too, because the scrollback replay carries the original
       * escape sequence and xterm re-fires `onTitleChange` from it. So this holds the line rather
       * than replicating a fault — a panel with a terminal in it must never settle on a placeholder,
       * whether the name arrives from the replay or from the flavour fallback behind it.
       */
      await reloadWindow(win);
      await enterProject(win, 'ReattachNames');
      const restored = win.getByTestId(`panel-title-${pid}`);
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => /^Panel \d+$/.test((await restored.textContent()) ?? ''), {
          timeout: 20_000,
          message: 'a reattached terminal fell back to its "Panel X" placeholder',
        })
        .toBe(false);

      // Reset Name stays disabled throughout — nothing here was ever renamed, so the menu must not
      // offer a recovery that implies it was.
      expect(await resetNameEnabled(win, pid)).toBe(false);
    });
  } finally {
    cleanupTemp(root);
  }
});

test('panel names survive a restart — the automatic ones and the typed one (#218 B)', async () => {
  test.setTimeout(180_000);
  const root = makeProject('throng-restart-name-');
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-restart-name-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-restart-name-ud-'));
  try {
    // ── Launch 1: a terminal panel that names itself, and a second panel the user DID rename ──
    await runApp(
      async (_app, win) => {
        await createProject(win, 'RestartNames', root);
        const term = await firstPanelId(win);

        // The second panel is added and named BEFORE the terminal starts: a live terminal in a
        // sibling panel takes focus back, which blurs and closes the new panel's rename box before
        // a test can type into it (see `commitPanelRename` in the harness).
        await win.getByTestId(`panel-add-${term}`).click();
        await expect(win.locator('.panel-box')).toHaveCount(2);
        const named = (await panelIds(win)).find((id) => id !== term) ?? '';
        const input = win.getByTestId(`panel-rename-input-${named}`);
        await expect(input).toBeVisible();
        await input.fill('Scratch');
        await input.press('Enter');
        await expect(win.getByTestId(`panel-title-${named}`)).toHaveText('Scratch');

        await win.getByTestId(`panel-type-select-${term}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${term}`).click();
        await expect(win.getByTestId(`terminal-${term}`)).toBeVisible();
        await expect(win.getByTestId(`panel-title-${term}`)).toContainText('cmd.exe', {
          timeout: 15_000,
        });

        await win.waitForTimeout(3000); // the debounced layout save
      },
      { dataDir, userDataDir },
    );

    // ── Launch 2: the same project, reopened ──
    await runApp(
      async (_app, win) => {
        await enterProject(win, 'RestartNames');

        // No panel holding a terminal or a file may show the placeholder. A restored session does
        // not necessarily re-emit its OSC title, so the terminal's name has to come from somewhere
        // that survives — which is the whole of defect B.
        const titles = win.locator('.panel-box__title');
        await expect(titles).toHaveCount(2, { timeout: 20_000 });
        await expect
          .poll(async () => (await titles.allTextContents()).some((t) => /^Panel \d+$/.test(t)), {
            timeout: 20_000,
            message: 'a restored panel fell back to its "Panel X" placeholder',
          })
          .toBe(false);

        // …and a name the user typed still outranks everything, across the restart.
        await expect(win.locator('.panel-box__title', { hasText: 'Scratch' })).toHaveCount(1);
      },
      { dataDir, userDataDir },
    );
  } finally {
    for (const d of [root, dataDir, userDataDir]) cleanupTemp(d);
  }
});
