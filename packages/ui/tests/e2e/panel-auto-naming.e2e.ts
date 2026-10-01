/**
 * #218 — a panel wears the name of the thing inside it, and only a name the USER typed is custom.
 *
 * **048 — manual panel rename is gone.** No panel has a rename box, a typed override or a Reset Name, so
 * the A2 test (an adjustment under an OPEN rename box), every "Reset Name is not offered" assertion and
 * the typed-name half of the restart test were removed with the feature. What stays is the auto-naming
 * half: a panel follows its content, and a daemon adjustment never stops it doing so. The paragraphs
 * below describe the defect's history and still say "Reset Name" and "rename box"; read them as that.
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
import Database from 'better-sqlite3';
import { test, expect, type Page } from '@playwright/test';
import { runApp, createProject, firstPanelId, reloadWindow, cleanupTemp } from './harness.js';

function makeProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(root, 'notes.md'), '# notes\n');
  return root;
}

function dbPath(dataDir: string): string {
  return join(dataDir, 'throng.db');
}

/**
 * Wait until PROJECT's layout has actually landed in the daemon's SQLite store, in the shape
 * `predicate` names.
 *
 * The daemon's name-claim service (`panelName.claim`, `panel-name-service.ts`) reads "which names
 * are taken" straight off the LAYOUTS on disk — deliberately, per its own doc comment, rather than
 * from a registry that could drift out of step with them. So a second project's naming only
 * reproduces the collision the report describes once the FIRST project's panel names are actually
 * persisted; a guess about the 400ms debounce (`waitForTimeout`) can land before that write and
 * silently turn a collision test into a no-op. This polls the real condition instead.
 */
async function expectLayoutSaved(
  dataDir: string,
  projectName: string,
  predicate: (layoutJson: string) => boolean,
): Promise<void> {
  await expect
    .poll(
      () => {
        let db: InstanceType<typeof Database> | undefined;
        try {
          db = new Database(dbPath(dataDir), { readonly: true });
          const row = db
            .prepare(
              `SELECT w.layout_json AS json
                 FROM workspace_layout w
                 JOIN projects p ON p.id = w.project_id
                WHERE p.name = ?`,
            )
            .get(projectName) as { json?: string } | undefined;
          return row?.json !== undefined && predicate(row.json);
        } catch {
          return false; // not written yet, or a transient read of a mid-write DB
        } finally {
          db?.close();
        }
      },
      { timeout: 15_000, message: `the layout for "${projectName}" was never persisted` },
    )
    .toBe(true);
}

interface LayoutPanelNode {
  type?: string;
  id?: string;
  title?: string;
  children?: LayoutPanelNode[];
}

function findPanelTitle(node: LayoutPanelNode, panelId: string): string | undefined {
  if (node.type === 'panel') return node.id === panelId ? node.title : undefined;
  for (const child of node.children ?? []) {
    const found = findPanelTitle(child, panelId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The persisted title of one panel, found by id across every tab in a layout document. */
function panelTitleInLayout(layoutJson: string, panelId: string): string | undefined {
  const layout = JSON.parse(layoutJson) as { tabs?: { root: LayoutPanelNode }[] };
  for (const tab of layout.tabs ?? []) {
    const found = findPanelTitle(tab.root, panelId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Open a project that is listed but not showing — after a reload, or in a second launch. */
async function enterProject(win: Page, name: string): Promise<void> {
  const item = win.locator('.project-item', { hasText: name });
  await expect(item).toBeVisible({ timeout: 20_000 });
  const sw = item.locator('[data-testid^="project-switch-"]');
  if (await sw.isVisible().catch(() => false)) await sw.click();
  await expect(win.locator('.panel-box').first()).toBeVisible({ timeout: 20_000 });
}

test('a generated name the daemon adjusts is not a rename — the panel still auto-names itself (#218 A1)', { tag: ['@extended', '@window'] }, async () => {
  const rootA = makeProject('throng-a1-alpha-');
  const rootB = makeProject('throng-a1-beta-');
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-a1-data-'));
  try {
    await runApp(
      async (_app, win) => {
        // Project A owns "Blank Panel" (048 FR-127). Its layout must be PERSISTED before B asks for the same name —
        // the daemon's claim service reads names off the saved layouts, not off this window's state.
        await createProject(win, 'AutoAlpha', rootA);
        const a = await firstPanelId(win);
        await expect(win.getByTestId(`panel-title-${a}`)).toHaveText('Blank Panel');
        await expectLayoutSaved(dataDir, 'AutoAlpha', (json) => panelTitleInLayout(json, a) === 'Blank Panel');

        // Project B's first panel is generated "Blank Panel" too — panels are numbered within their own
        // layout — so the daemon adjusts the STORED name. That adjustment is throng's choice, not the
        // user's, and 048 FR-130 keeps it internal: the header still says plain "Blank Panel".
        await createProject(win, 'AutoBeta', rootB);
        const b = await firstPanelId(win);
        await expectLayoutSaved(dataDir, 'AutoBeta', (json) => panelTitleInLayout(json, b) === 'Blank Panel 2');
        await expect(win.getByTestId(`panel-title-${b}`)).toHaveText('Blank Panel');

        // …and the consequence the user actually reports: a custom title outranks every automatic one,
        // so typing the panel leaves it wearing the placeholder instead of its shell's name.
        await win.getByTestId(`panel-type-select-${b}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${b}`).click();
        await expect(win.getByTestId(`terminal-${b}`)).toBeVisible();
        await expect(win.getByTestId(`panel-title-${b}`)).toContainText('cmd.exe', { timeout: 15_000 });
      },
      { dataDir },
    );
  } finally {
    for (const r of [rootA, rootB, dataDir]) cleanupTemp(r);
  }
});

/**
 * The New Tab route's panel takes its name from the FILE it ends up holding (#218).
 *
 * ── WHAT LEFT (035 T055) ──
 *
 * Two of this test's three claims are `TabGroup`'s and are now
 * `component/tab-strip.test.ts` ("the New Tab route names its panel automatically"):
 *
 *   - the TAB opens in rename mode, not the panel — the route's own comment said this behaviour
 *     "was asserted nowhere";
 *   - the panel it brings is NOT marked custom, which is the whole of #218. A panel that believes
 *     it was renamed stops auto-naming, so the terminal title and the editor's file name are
 *     suppressed on exactly the panels a user has just created — the reported symptom.
 *
 * The component version also asserts the Escape path, which this did by hand and never checked the
 * consequence of. Red-proven by making `makePanel` mark every new panel custom: 2 red.
 *
 * ── WHY THE REST STAYS ──
 *
 * What is left is the JOURNEY that feeds the name: choose an editor, click `notes.md` in the real
 * explorer tree, and watch the header become "notes". The naming RULE is `panelDisplayTitle`, pure
 * and covered in core; reaching it needs the explorer, a real file on disk and the editor
 * registering its path, which is three layers agreeing.
 */
test('a New Tab panel takes its name from the file its editor opens (#218)', { tag: ['@extended', '@window'] }, async () => {
  const root = makeProject('throng-newtab-');
  try {
    await runApp(async (_app, win) => {
      await createProject(win, 'NewTabProj', root);
      await firstPanelId(win);

      await win.getByTestId('tab-add').click();
      await expect(win.locator('[data-testid^="tab-rename-input-"]')).toBeVisible();
      await win.keyboard.press('Escape');

      const pid = await firstPanelId(win); // the new tab's only panel

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

test('a terminal that reattaches to its running session keeps its name (#218 B)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
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
        .poll(async () => /^Blank Panel( \d+)?$/.test((await restored.textContent()) ?? ''), {
          timeout: 20_000,
          message: 'a reattached terminal fell back to its "Blank Panel" placeholder',
        })
        .toBe(false);

    });
  } finally {
    cleanupTemp(root);
  }
});

test('a terminal panel keeps its name across a restart (#218 B)', { tag: ['@extended', '@window', '@reserve:window'] }, async () => {
  test.setTimeout(180_000);
  const root = makeProject('throng-restart-name-');
  const dataDir = mkdtempSync(join(tmpdir(), 'throng-restart-name-data-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'throng-restart-name-ud-'));
  try {
    // ── Launch 1: a terminal panel that names itself ──
    await runApp(
      async (_app, win) => {
        await createProject(win, 'RestartNames', root);
        const term = await firstPanelId(win);

        await win.getByTestId(`panel-type-select-${term}`).selectOption('terminal');
        await win.getByTestId('terminal-flavour').selectOption('cmd');
        await win.getByTestId(`panel-type-confirm-${term}`).click();
        await expect(win.getByTestId(`terminal-${term}`)).toBeVisible();
        await expect(win.getByTestId(`panel-title-${term}`)).toContainText('cmd.exe', {
          timeout: 15_000,
        });

        // The terminal's name is asserted on screen above and again after the restart below; the layout
        // only has to have been written before the app closes.
        await expectLayoutSaved(dataDir, 'RestartNames', (json) => panelTitleInLayout(json, term) !== undefined);
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
        await expect(titles).toHaveCount(1, { timeout: 20_000 });
        await expect
          .poll(async () => (await titles.allTextContents()).some((t) => /^Blank Panel( \d+)?$/.test(t)), {
            timeout: 20_000,
            message: 'a restored panel fell back to its "Blank Panel" placeholder',
          })
          .toBe(false);

      },
      { dataDir, userDataDir },
    );
  } finally {
    for (const d of [root, dataDir, userDataDir]) cleanupTemp(d);
  }
});
