/**
 * 033 US3 — **Open In → Terminal** (AS-1 to AS-8, contract A1–A6 / B1–B9, SC-008, SC-015).
 *
 * Everything here needs the running app for a reason a cheaper layer cannot supply: a three-level
 * flyout that must not collapse under the mouse, a real shell reporting a real working directory,
 * and keyboard focus landing in that shell with no intervening click. The parts that do NOT need it
 * are deliberately absent — the sections each item declares and the disabled-when-unavailable rule
 * are asserted at the builder in `packages/ui/tests/unit/explorer-terminal-menu.test.ts`, and FR-032's
 * containment at `packages/core/tests/unit/start-directory.test.ts`, which is the layer
 * contracts/explorer-actions.md Part C assigns each of them.
 *
 * ══ THE FLAVOUR LIST IS DERIVED, NEVER TYPED ══
 *
 * SC-008 and SC-015 are claims about **every enabled flavour on the machine**, and a hard-coded list
 * cannot make that claim: it would pass on a machine missing one of them and would never notice a
 * flavour that had been added. So the list is read out of the menu itself at run time and the loop
 * runs over whatever came back — which also makes AS-1's "matching the panel type-picker's list
 * exactly" a real comparison of two live lists rather than of two copies of the same literal.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  runApp,
  createProject,
  panelIds,
  reloadWindow,
  cleanupTemp,
} from './harness.js';
import { writeSettingsAtomic } from './helpers/config-write.js';
import { seedTabs } from './helpers/tabs.js';
import { skipIfElevated } from './admin.js';

/** A project with a nested folder to launch from and a file inside it (B4). */
function makeProjectFolder(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'deep'));
  mkdirSync(join(root, 'deep', 'nested'));
  writeFileSync(join(root, 'deep', 'nested', 'inside.txt'), 'x\n');
  writeFileSync(join(root, 'top.txt'), 'x\n');
  return root;
}

/** Open a tree row's menu and walk Open In → Terminal, returning the flavour level. */
async function openTerminalSubmenu(win: Page, row: Locator): Promise<Locator> {
  await row.click({ button: 'right' });
  await expect(win.getByTestId('context-menu')).toBeVisible();
  await win.getByTestId('menu-item-Open In').click();
  await expect(win.getByTestId('submenu-Open In')).toBeVisible();
  await win.getByTestId('menu-item-Terminal').click();
  await expect(win.getByTestId('submenu-Terminal')).toBeVisible();
  return win.getByTestId('submenu-Terminal');
}

/** The labels a menu level is showing, in order. */
async function labelsOf(level: Locator): Promise<string[]> {
  const raw = await level.locator('.context-menu__item .context-menu__label').allInnerTexts();
  return raw.map((t) => t.trim());
}

/**
 * Close the whole menu from inside an open flyout — which takes MORE THAN ONE Escape, by design.
 *
 * `MenuLevel`'s Escape branch (`workspace/context-menu.tsx`) closes the flyout that is open and
 * `stopImmediatePropagation`s, so the window listener that would have closed everything never runs;
 * only an Escape at a level with nothing open below it closes the menu. That is 024 US6 / FR-018b,
 * and `menu-keyboard.e2e.ts:198-213` has asserted it since — one Escape steps back one level and
 * leaves the root menu up.
 *
 * The first press is asserted SEPARATELY because that step-back is the guarantee, and this feature
 * adds the first three-level path in the app to test it against. The walk-out is then bounded at the
 * three levels the menu has, so an Escape that stopped working entirely still fails here rather than
 * spinning.
 */
async function closeMenu(win: Page): Promise<void> {
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('context-menu')).toBeVisible();
  for (let level = 0; level < 3; level += 1) {
    if ((await win.getByTestId('context-menu').count()) === 0) return;
    await win.keyboard.press('Escape');
  }
  await expect(win.getByTestId('context-menu')).toHaveCount(0);
}

/** The panel that appeared since `before` — the one the launch created. */
async function newPanelId(win: Page, before: string[]): Promise<string> {
  await expect(win.locator('.panel-box')).toHaveCount(before.length + 1, { timeout: 15_000 });
  const after = await panelIds(win);
  const added = after.filter((id) => !before.includes(id));
  expect(added, 'exactly one panel was added by the launch').toHaveLength(1);
  return added[0]!;
}

/**
 * Poll the persisted layout until `predicate` holds — the row is real and observable.
 *
 * Lifted verbatim from `terminal-directory-memory.e2e.ts`, which reads the same column for the same
 * reason: what is in question is whether a value is ever WRITTEN, and the row answers exactly that
 * with no dependency on how a later launch happens to restore it.
 */
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

// ---------------------------------------------------------------------------
// AS-1 / A1 / A2 / A6 — the submenu, and that it IS the type-picker's catalogue.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AS-2 / AS-2a / B1–B4 / B9 / SC-008 / SC-015 — every enabled flavour on the machine.
// ---------------------------------------------------------------------------

/*
 * ── ONE REMOVED, IN THREE PIECES (035 T055) ──
 *
 * `:138` "AS-1 — Open In holds a Terminal submenu whose flavours match the panel type-picker
 * exactly" made three claims, and each already had — or now has — a cheaper home:
 *
 *   the submenu's children are EXACTLY the supplied catalogue, in order
 *     → `unit/explorer-terminal-menu.test.ts:96` (already there, "no second copy of the list")
 *   neither level draws a divider (A6)
 *     → `unit/explorer-terminal-menu.test.ts:124` (already there)
 *   the catalogue IS the panel type-picker's
 *     → `unit/flavour-catalogue-single.test.ts` (new)
 *
 * ── WHY THE THIRD ONE GOT STRONGER ──
 *
 * The E2E compared two RENDERINGS: it switched a panel to `terminal` to read the shipped Flavour
 * dropdown, then right-clicked a folder and a file and compared labels element by element. That can
 * only ever say the two matched on the machine that ran it, at that instant — and the failure
 * FR-030 names is a second copy of the list, which is correct at the moment it is taken and drifts
 * afterwards.
 *
 * Asking what the two surfaces READ says they cannot diverge on any machine. The guard is an
 * allow-list — only `use-flavours.ts` may reach the bridge, and only the picker and the tree may
 * read the hook — because a second copy arrives as a new caller, and a ban on specific wrong ways of
 * building a list says nothing about the next one invented.
 *
 * ── WHAT STAYS ──
 *
 * Everything about actually LAUNCHING a flavour in the right working directory, and AS-4's
 * user-defined and disabled flavours, which reach settings and the machine's real shells.
 */
test('AS-2/AS-2a — every enabled flavour opens an active, focused terminal in the right-clicked folder', { tag: ['@core', '@terminal', '@reserve:pty'] }, async () => {
  /*
   * Measured for `terminal-directory-memory.e2e.ts` on CI run 30943045917 and the same reasoning
   * applies verbatim: an elevated daemon routes terminals through the de-elevated agent, a different
   * process tree than the one these cwd and focus assertions describe.
   */
  skipIfElevated();
  test.setTimeout(300_000);
  const root = makeProjectFolder('throng-oit-launch-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'LaunchTerminal', root);
      const tree = win.getByTestId('file-explorer-tree');

      // Reveal the nested folder, then read the catalogue off the menu — the loop below runs over
      // whatever THIS machine reports, which is what makes SC-008's "every enabled flavour" real.
      await tree.getByText('deep', { exact: true }).dblclick();
      await expect(tree.getByText('nested', { exact: true })).toBeVisible();
      const level = await openTerminalSubmenu(win, tree.getByText('nested', { exact: true }));
      const flavours = await labelsOf(level);
      expect(flavours.length, 'the machine reported at least one enabled flavour').toBeGreaterThan(0);
      await closeMenu(win);

      for (const flavour of flavours) {
        /*
         * One TAB per flavour, not one panel per flavour in the same tab.
         *
         * Four live shells splitting a single tab leaves each terminal a few columns wide, and a
         * cwd assertion then fails on truncation rather than on behaviour. A fresh tab also makes
         * B1's "the ACTIVE tab" a claim with teeth: the panel has to land in the tab that is active
         * NOW, not in the one the project opened with.
         */
        await seedTabs(win, [`T-${flavour}`]);
        const before = await panelIds(win);

        const flavourLevel = await openTerminalSubmenu(
          win,
          tree.getByText('nested', { exact: true }),
        );
        await flavourLevel.getByText(flavour, { exact: true }).click();
        await expect(win.getByTestId('context-menu')).toHaveCount(0);

        const pid = await newPanelId(win, before);
        // B1 — it is the ACTIVE panel of the tab it landed in.
        await expect(win.getByTestId(`panel-${pid}`)).toHaveAttribute('data-active', 'true');
        // B2 / AS-2a — and it did NOT open in rename mode, which is what `clearLastAddedPanel` buys.
        await expect(win.getByTestId(`panel-rename-input-${pid}`)).toHaveCount(0);
        // It is a terminal, already typed — no picker form to confirm (FR-033).
        await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 30_000 });

        /*
         * SC-008 / B4 / B9 — the shell's OWN reported working directory is the right-clicked folder.
         *
         * Read from the panel header's cwd tag, which is fed by the daemon's observation of the live
         * shell rather than by anything this feature computed — so it cannot agree with the launch by
         * construction. FR-032's containment is inherited from `resolveStartDirectory` and asserted
         * at that unit; `nested` being under the root is the observable half of it here.
         */
        await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText('nested', {
          timeout: 40_000,
        });

        /*
         * SC-015 / B3 / FR-033a — type WITHOUT clicking anything, and the characters reach the shell.
         *
         * No `term.click()` anywhere above, and that omission is the entire assertion: every other
         * terminal spec in this suite clicks the terminal before typing. The wait on the cwd tag is a
         * wait for the SHELL to be alive, not a substitute for focus — a terminal that did not take
         * focus stays just as alive and swallows nothing.
         */
        const probe = `throng-focus-${flavour.replace(/[^a-z0-9]+/gi, '')}`;
        await win.keyboard.type(probe);
        await expect(win.getByTestId(`terminal-${pid}`)).toContainText(probe, { timeout: 20_000 });
      }
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// AS-3 / B4 — a FILE starts its terminal in the file's parent folder.
// ---------------------------------------------------------------------------

test('AS-3 — a right-clicked file opens its terminal in the file’s parent folder', { tag: ['@extended', '@terminal', '@reserve:pty'] }, async () => {
  skipIfElevated();
  test.setTimeout(180_000);
  const root = makeProjectFolder('throng-oit-file-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'FileTerminal', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('deep', { exact: true }).dblclick();
      await tree.getByText('nested', { exact: true }).dblclick();
      await expect(tree.getByText('inside.txt', { exact: true })).toBeVisible();

      const before = await panelIds(win);
      const level = await openTerminalSubmenu(win, tree.getByText('inside.txt', { exact: true }));
      // The first flavour the machine offers — which one is irrelevant to the parent-folder rule.
      await level.locator('.context-menu__item').first().click();

      const pid = await newPanelId(win, before);
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 30_000 });
      // The FOLDER the file lives in, never the file — a shell cannot have a file as a directory.
      await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText('nested', { timeout: 40_000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// B5 — the start directory is persisted, so a restored panel restarts where it was created.
// ---------------------------------------------------------------------------

test('B5 — the start directory is persisted, and the reopened project restarts the terminal there', { tag: ['@extended', '@terminal', '@reserve:window'] }, async () => {
  skipIfElevated();
  test.setTimeout(180_000);
  const root = makeProjectFolder('throng-oit-restore-');
  const data = mkdtempSync(join(tmpdir(), 'throng-oit-restore-data-'));
  try {
    await runApp(
      async (_app, win) => {
        await createProject(win, 'RestoreTerminal', root);
        const tree = win.getByTestId('file-explorer-tree');
        await tree.getByText('deep', { exact: true }).dblclick();

        const before = await panelIds(win);
        const level = await openTerminalSubmenu(win, tree.getByText('nested', { exact: true }));
        await level.locator('.context-menu__item').first().click();
        const pid = await newPanelId(win, before);
        await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText('nested', {
          timeout: 40_000,
        });

        /*
         * The half that ONLY `startDirectory` can satisfy, asserted against the persisted layout.
         *
         * The behavioural assertion below cannot carry B5 on its own, and saying so is the point: by
         * now the terminal has been running in `nested`, "Reopen in the last directory" ships ON, and
         * so `terminalMemory.lastCwd` would bring the restored panel back to the same folder even if
         * T077's field had never been written. Reading the row separates the two — this passes only
         * if the config itself carries the folder the user right-clicked.
         */
        await expectLayout(
          data,
          'RestoreTerminal',
          (json) => /"startDirectory":"[^"]*nested"/i.test(json),
          'the start directory never reached the persisted panel config',
        );

        /*
         * A renderer reload auto-opens NO project — that is shipped behaviour, asserted outright by
         * `editor-caret-persist.e2e.ts:200` (`workspace-no-project` is visible after a reload) and
         * worked around the same way by `explorer-tree-state.e2e.ts:304`. Reopening it is not a
         * concession: it makes this the COLD path, where the panel is rebuilt from the persisted
         * layout rather than from anything still in memory.
         */
        await reloadWindow(win);
        await expect(win.getByTestId('workspace-no-project')).toBeVisible({ timeout: 20_000 });
        await win
          .locator('.project-item', { hasText: 'RestoreTerminal' })
          .locator('[data-testid^="project-switch-"]')
          .click();

        await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 40_000 });
        // `nested`, not the project root — the root is where a panel with no start directory lands.
        await expect(win.getByTestId(`panel-cwd-${pid}`)).toContainText('nested', {
          timeout: 40_000,
        });
      },
      { dataDir: data },
    );
  } finally {
    for (const d of [root, data]) {
      cleanupTemp(d);
    }
  }
});

// ---------------------------------------------------------------------------
// AS-4 / A2 / B8 / FR-030 / FR-037 — the catalogue, not a copy of it.
// ---------------------------------------------------------------------------

test('AS-4 — a user-defined flavour appears with no further configuration; a disabled built-in does not', { tag: ['@extended', '@terminal'] }, async () => {
  const root = makeProjectFolder('throng-oit-custom-');
  const cfg = mkdtempSync(join(tmpdir(), 'throng-oit-custom-cfg-'));
  try {
    writeSettingsAtomic(cfg, {
      terminals: {
        // Nothing about the catalogue or its configuration UI changes for this feature (FR-037,
        // B8) — this is the SHIPPED settings shape, written exactly as `terminal-flavours.e2e.ts`
        // writes it, and the menu inherits both halves of it for free.
        disabledBuiltins: ['cmd'],
        flavours: [
          {
            id: 'my-wsl',
            label: 'WSL: Ubuntu',
            file: 'wsl.exe',
            args: ['-d', 'Ubuntu'],
            defaultShellArguments: '--cd ~',
          },
        ],
      },
    });
    await runApp(
      async (_app, win) => {
        await createProject(win, 'CustomFlavour', root);
        const tree = win.getByTestId('file-explorer-tree');
        const level = await openTerminalSubmenu(win, tree.getByText('deep', { exact: true }));
        const labels = await labelsOf(level);
        expect(labels).toContain('WSL: Ubuntu');
        expect(labels).not.toContain('Command Prompt');
        await closeMenu(win);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    for (const d of [root, cfg]) {
      cleanupTemp(d);
    }
  }
});

// ---------------------------------------------------------------------------
// AS-6 / A3 / FR-035 — shown and DISABLED when there is nothing to launch.
// ---------------------------------------------------------------------------

/*
 * MOVED to `packages/ui/tests/component/menu-disabled-parent.test.ts` (034 FR-045): AS-6 / A3 /
 * FR-035 — "with nothing launchable the Terminal parent is drawn and disabled, never hidden".
 *
 * It seeded a THRONG_CONFIG_ROOT with every built-in shell disabled and no user flavour, launched
 * Electron, created a project, right-clicked a tree row and opened "Open In" — all in order to look
 * at three attributes of one <li>: `aria-disabled`, the `--disabled` class, and that a click opened
 * no flyout. The seeded config root was the way of ARRANGING for `disabled: true`; it was never the
 * subject. The DECISION half is already asserted at the builder,
 * `packages/ui/tests/unit/explorer-terminal-menu.test.ts:113` ("A3/FR-035 — with an empty catalogue
 * the parent is DRAWN and DISABLED, never hidden"), for `undefined` AND `[]`.
 *
 * THE REPLACEMENT IS STRICTLY STRONGER, in three ways the E2E could not manage:
 *   - it drives the REAL builder, so the rows are the shipped rows rather than a fixture;
 *   - it asserts `onClose` was NOT called, which the E2E never checked — a disabled row falling
 *     through to the leaf branch would dismiss the menu having done nothing, and read to the user
 *     as a control that silently failed rather than one that is unavailable;
 *   - it renders the ENABLED case in the same file. Without that, "no flyout opened" is satisfied
 *     by a menu that can never open a flyout at all, which is the vacuity this branch keeps finding.
 *
 * WHAT DID NOT MOVE, and why: the six tests that remain here are a real shell reporting a real cwd
 * with the keyboard already in it (AS-2), the submenu list compared against the panel type-picker’s
 * LIVE list on this machine (AS-1), a file resolving to its parent folder through a real PTY (AS-3),
 * a start directory surviving a cold restart (B5), a user-defined flavour written into settings.json
 * reaching the menu (AS-4), and three flyout levels standing open at once under a real mouse dwell
 * (AS-7). `context-menu-lifecycle.test.ts:150` covers the CLICK case of that last one, not the
 * hover-dwell case, so it is not a substitute.
 *
 * Anti-vacuity control: making the replacement’s `build()` return `[]` fails ALL FOUR of its tests
 * at `getByTestId('menu-item-Open In')`. Red-proved: hiding the Terminal row when the catalogue is
 * empty (the exact regression AS-6 existed to catch) reddens 3 of 4; dropping `aria-disabled`,
 * dropping the disabled class, and removing the click guard redden 1 each.
 */

// ---------------------------------------------------------------------------
// AS-7 / A4 — three levels, by mouse, with no intermediate flyout collapsing.
// ---------------------------------------------------------------------------

test('AS-7 — the three-level path traverses by mouse without an intermediate submenu collapsing', { tag: ['@extended', '@terminal', '@reserve:layout'] }, async () => {
  skipIfElevated();
  test.setTimeout(180_000);
  const root = makeProjectFolder('throng-oit-mouse-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'MouseTraverse', root);
      const tree = win.getByTestId('file-explorer-tree');
      await tree.getByText('deep', { exact: true }).click({ button: 'right' });
      await expect(win.getByTestId('context-menu')).toBeVisible();

      // HOVER, not click, at every level — a click is an idempotent open, so it would hide the very
      // collapse (#157) this scenario exists to catch. The dwell is `behaviour.submenuHoverMs`.
      await win.getByTestId('menu-item-Open In').hover();
      await expect(win.getByTestId('submenu-Open In')).toBeVisible();
      await win.getByTestId('menu-item-Terminal').hover();
      await expect(win.getByTestId('submenu-Terminal')).toBeVisible();

      // All three levels are up AT ONCE — that is the guarantee, and it is what the mouse needs in
      // order to reach the flavour at all.
      await expect(win.getByTestId('context-menu')).toBeVisible();
      await expect(win.getByTestId('submenu-Open In')).toBeVisible();

      const before = await panelIds(win);
      await win.getByTestId('submenu-Terminal').locator('.context-menu__item').first().click();
      const pid = await newPanelId(win, before);
      await expect(win.getByTestId(`terminal-${pid}`)).toBeVisible({ timeout: 30_000 });
    });
  } finally {
    cleanupTemp(root);
  }
});

// ---------------------------------------------------------------------------
// AS-8 / A5 — the same path by arrow keys, with Enter launching.
// ---------------------------------------------------------------------------

/*
 * MOVED to `packages/ui/tests/component/menu-keyboard.test.ts` (034 FR-045): AS-8 keyboard half —
 * ArrowRight opens each of the three levels landing on the first child, ArrowLeft walks back out,
 * and Enter on the deepest leaf fires its action and closes the menu.
 *
 * That test grew a three-level fixture for it rather than arguing from the two-level one: "the
 * recursion is the same code at every depth" is true, and is the reasoning that would hide a
 * special case at one level — this component has had exactly that bug (`isRoot` inferred from a
 * test id, broken by a folded-in menu keeping its own).
 *
 * What the deleted test also asserted, and what keeps its coverage: that Enter on a flavour LAUNCHES
 * A REAL SHELL. That is AS-2 above, which drives every detected flavour against a real PTY. No DOM
 * can tell you a shell started.
 */
