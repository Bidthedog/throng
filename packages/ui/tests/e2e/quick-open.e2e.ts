/**
 * 033 US1 (#219) — Quick Open: the chord, the list, and where a chosen file lands.
 *
 * Covers AS-1 to AS-10, AS-12 to AS-15 and AS-18 of the spec, Q1–Q7 of
 * `contracts/navigation-modals.md §3`, and SC-001 and SC-004, which no other task names.
 *
 * ══ WHAT IS DELIBERATELY NOT HERE ══
 *
 * **No assertion in this file has a wall-clock ceiling.** That is not an oversight, it is the reason
 * the spec is registered in the PARALLEL tier (T021): a timed assertion at six workers measures the
 * machine's contention rather than the feature. FR-016 / SC-005 — the index tracking the filesystem
 * within two seconds — therefore lives in `quick-open-perf.e2e.ts`, which is serial and is already
 * about timing. If you are tempted to add a "…within N ms" here, add it there instead.
 *
 * ══ TEST IDS ══
 *
 * `contracts/picker-extensions.md §5` fixes the picker's `testId` at `quickopen`; every other id is
 * DERIVED from that prefix by the shipped `Picker`, and `helpers/navigation.ts` owns the derivation.
 * Two ids this feature adds beyond the shipped component:
 *
 *   quickopen-truncated  the FR-014 count line (P4) — fixed by §5
 *   quickopen-target     the FR-010 target control (§6) — NOT fixed by any contract; named here and
 *                        in `quick-open-target.e2e.ts`, which owns its behaviour. This file asserts
 *                        only its ABSENCE (FR-011), which is the half nothing else covers.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject as newProject,
  firstPanelId,
  panelIds,
  focusEditor,
  reloadWindow,
  settle,
  geom,
  viewport,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { createDeepTree, cleanupDeepTree, DEEP_TREE } from './helpers/deep-tree.js';
import {
  QUICK_OPEN_CHORD,
  openQuickOpen,
  quickOpenRows,
  quickOpenRowPaths,
  chooseQuickOpenRow,
} from './helpers/navigation.js';

/*
 * ONE app for this file, not one per test.
 *
 * Every `runApp` is an Electron launch, a daemon and a window — around two seconds each. Only a test
 * that seeds state BEFORE launch needs its own app, and exactly two here do: the `editor.openTarget`
 * = 'new' case (a seeded config root) and the sub-workspace case (which persists a sub-workspace and
 * reloads the window, state every later test in a shared app would inherit). Both call `runOwnApp`
 * and say so.
 *
 * The shim REFUSES options rather than ignoring them: a silently dropped config root does not fail,
 * it passes for the wrong reason.
 */
test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
test.beforeAll(async () => {
  shared = await openApp();
});
test.afterAll(async () => {
  await shared?.close();
});

const runApp = (
  fn: (app: OpenApp['app'], win: OpenApp['win']) => Promise<void>,
  opts?: AppOptions,
): Promise<void> => {
  if (opts) {
    throw new Error(
      'this file shares one app; a test needing launch options must call runOwnApp instead',
    );
  }
  return fn(shared.app, shared.win);
};

/** A shared app accumulates projects, and duplicate names make `.project-item` ambiguous. */
let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

/** Every editor panel currently rendered, whichever tab or project it belongs to. */
const editors = (win: Page) => win.locator('.editor-panel');

/**
 * A second project's root, with one file whose name appears nowhere in the deep tree.
 *
 * AS-13 is a claim about ABSENCE, and an absence is only readable next to a presence: `zebra`
 * matching exactly one file in the active project is what makes `router` matching none of the other
 * project's files evidence rather than an empty list nobody looked at.
 */
function createOtherProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-qo-other-'));
  writeFileSync(join(root, 'zebra-only.txt'), '// zebra-only.txt\n');
  return root;
}

/** A project with more matching files than FR-014's 200-row cap, so truncation has something to cap. */
const TRUNCATION_FILES = 250;
function createOversizedProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-qo-big-'));
  mkdirSync(join(root, 'many'), { recursive: true });
  for (let i = 1; i <= TRUNCATION_FILES; i += 1) {
    const name = `capped-${String(i).padStart(4, '0')}.qq`;
    writeFileSync(join(root, 'many', name), `// many/${name}\n`);
  }
  return root;
}

/** Turn the tab's first panel into an editor and hand back its id. */
async function newEditor(win: Page): Promise<string> {
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  return pid;
}

/**
 * How many bytes this terminal view has put on the wire, as its own diagnostics count them.
 *
 * Reading the SCREEN would not answer AS-1: `Ctrl+Shift+T` prints nothing in `cmd`, so an unchanged
 * screen is equally consistent with the chord having been delivered and swallowed. The counter is
 * the only thing that distinguishes "the terminal received nothing" from "the terminal received
 * something invisible".
 */
async function inputWritten(win: Page, panelId: string): Promise<number> {
  return win.evaluate((id) => {
    const probe = (
      window as unknown as {
        __throngTerminalDiagnostics?: () => Record<string, { input: { written: number } }>;
      }
    ).__throngTerminalDiagnostics;
    return probe?.()[id]?.input.written ?? -1;
  }, panelId);
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-1, AS-5, SC-001, FR-011, Q6, S3 — the chord from a terminal
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('from a focused terminal the chord opens a centred modal, sends the shell nothing, draws no target control, and takes three actions to an open file', async () => {
  const tree = createDeepTree('throng-qo-term-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOTerm', tree.root);

      const pid = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${pid}`).selectOption('terminal');
      await win.getByTestId('terminal-flavour').selectOption('cmd');
      await win.getByTestId(`panel-type-confirm-${pid}`).click();
      const term = win.getByTestId(`terminal-${pid}`);
      await expect(term).toContainText(basename(tree.root), { timeout: 20_000 });

      const textarea = term.locator('.xterm-helper-textarea');
      await term.click();
      await expect(textarea).toBeFocused();

      /*
       * PROVE THE PROBE CAN MOVE before asking it to stay still (FR-053b's standard).
       *
       * "The chord wrote nothing" is unfalsifiable against a counter that never moves — a probe
       * reading the wrong panel id, or a diagnostics hook that was never installed, reports zero
       * for both the passing and the failing world. One real keystroke first, and the later
       * assertion means something.
       */
      const beforeTyping = await inputWritten(win, pid);
      expect(beforeTyping, 'terminal diagnostics are not reachable for this panel').toBeGreaterThanOrEqual(0);
      await win.keyboard.type('x');
      await expect.poll(() => inputWritten(win, pid)).toBeGreaterThan(beforeTyping);

      const beforeChord = await inputWritten(win, pid);
      await openQuickOpen(win); // …waits for the dialog AND for its input to hold focus

      // AS-1 — the terminal received NO keystroke. Safe to read now precisely because the modal is
      // already on screen: anything the chord was going to send has been sent.
      expect(await inputWritten(win, pid), 'the Quick Open chord reached the shell').toBe(beforeChord);

      // S3 — the app's shipped modal presentation, and an EMPTY input (FR-057).
      const dialog = win.getByTestId('quickopen');
      await expect(dialog).toHaveAttribute('role', 'dialog');
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(win.getByTestId('quickopen-overlay')).toBeVisible();
      await expect(win.getByTestId('quickopen-input')).toHaveValue('');

      // …centred. Measured with `geom`, which waits for the element to stop moving, so this is the
      // modal's resting position rather than a frame of its entrance.
      const box = await geom(dialog);
      const vp = await viewport(win);
      expect(Math.abs(box.x + box.w / 2 - vp.width / 2)).toBeLessThanOrEqual(2);

      /*
       * FR-011 / T3 — invoked from a TERMINAL, the target control is absent.
       *
       * The in-editor case is `quick-open-target.e2e.ts`'s. Without this half nothing asserts the
       * control is CONDITIONAL at all: a control drawn unconditionally passes every assertion in
       * that file.
       */
      await expect(win.getByTestId('quickopen-target')).toHaveCount(0);

      // AS-5 / Q6 — Escape closes, opens nothing, and puts focus back in the terminal.
      await win.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(editors(win)).toHaveCount(0);
      await expect(textarea).toBeFocused();

      /*
       * SC-001 — three actions from a terminal to an open file: chord, type, Enter.
       *
       * Counted as written: three statements, no click, no navigation of the tree. Q4 is inherited
       * on the way — this tab holds no editor, so choosing has to create one.
       */
      await openQuickOpen(win);
      await win.keyboard.type('deep-widget');
      await win.keyboard.press('Enter');

      await expect(dialog).toHaveCount(0);
      await expect(editors(win)).toHaveCount(1);
      await expect(editors(win).locator('.cm-content')).toContainText(`// ${DEEP_TREE.deepFile}`, {
        timeout: 8000,
      });
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-2 — what a row shows
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('every match is listed with its full project-relative path and its matched runs marked (AS-2, SC-003)', async () => {
  const tree = createDeepTree('throng-qo-rows-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QORows', tree.root);

      await openQuickOpen(win);
      await win.keyboard.type(DEEP_TREE.sharedBasename.query);

      // Two files share the basename `config.ts`. Order is AS-14's subject, not this test's, so the
      // membership is asserted as a set — over-asserting order here would make a ranking change look
      // like a listing defect.
      await expect(quickOpenRows(win)).toHaveCount(2);
      expect([...(await quickOpenRowPaths(win))].sort()).toEqual([
        DEEP_TREE.sharedBasename.inApp,
        DEEP_TREE.sharedBasename.inServer,
      ]);

      // SC-003 — the row carries the FULL path. Two rows both reading `config.ts` would be
      // indistinguishable to the user, which is the whole reason the label is the path.
      const inApp = win.getByTestId(`quickopen-row-${DEEP_TREE.sharedBasename.inApp}`);
      await expect(inApp).toHaveText(DEEP_TREE.sharedBasename.inApp);

      // …and the matched run is marked, on the string that is actually rendered.
      await expect(inApp.locator('mark.picker__mark')).toHaveText(DEEP_TREE.sharedBasename.query);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-3, AS-4 — choosing
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('Down, Down, Enter opens the THIRD listed file and closes the modal (AS-3)', async () => {
  const tree = createDeepTree('throng-qo-keys-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOKeys', tree.root);

      await openQuickOpen(win);
      await win.keyboard.type('.ts');
      await expect(quickOpenRows(win)).toHaveCount(6);

      /*
       * Read the third row off the LIST rather than naming a file.
       *
       * "The third listed file" is what AS-3 says, and the third file under a ranker is a fact about
       * the ranker, which AS-14 owns. Hard-coding a path here would turn every future ranking tweak
       * into a failure in this test, pointing at the arrow keys.
       */
      const third = (await quickOpenRowPaths(win))[2];
      await win.keyboard.press('ArrowDown');
      await win.keyboard.press('ArrowDown');
      await expect(win.locator('[data-highlighted="true"]')).toHaveAttribute(
        'data-testid',
        `quickopen-row-${third}`,
      );

      await win.keyboard.press('Enter');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
      await expect(editors(win).locator('.cm-content')).toContainText(`// ${third}`, {
        timeout: 8000,
      });
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('clicking a row opens that file and closes the modal (AS-4)', async () => {
  const tree = createDeepTree('throng-qo-click-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOClick', tree.root);

      await openQuickOpen(win);
      await win.keyboard.type('guide');
      await expect(quickOpenRows(win)).toHaveCount(1);

      // `chooseQuickOpenRow` waits for the row, clicks it, and waits for the modal to detach (Q5).
      expect(await chooseQuickOpenRow(win, 0)).toBe('docs/guide.md');
      await expect(editors(win).locator('.cm-content')).toContainText('// docs/guide.md', {
        timeout: 8000,
      });
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-6 — a query that matches nothing
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('a no-match query keeps the modal open and says so, and a correction brings results back (AS-6)', async () => {
  const tree = createDeepTree('throng-qo-empty-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOEmpty', tree.root);

      await openQuickOpen(win);
      await win.keyboard.type('zzz-no-such-file');

      await expect(win.getByTestId('quickopen-empty')).toHaveText('No files match');
      await expect(win.getByTestId('quickopen')).toBeVisible();
      await expect(quickOpenRows(win)).toHaveCount(0);

      // "so a typo is corrected with a backspace rather than a re-open" — the modal is still LIVE,
      // which an assertion on visibility alone does not establish.
      await win.getByTestId('quickopen-input').fill('guide');
      await expect(quickOpenRows(win)).toHaveCount(1);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-7 to AS-10 — where the file lands, all four routes inherited (Q2, Q3, Q4)
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('at the shipped default a tab with no editor gets one, and the next choice reuses it (AS-7, Q4)', async () => {
  const tree = createDeepTree('throng-qo-last-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOLastActive', tree.root);

      // No editor exists yet — the tab holds one untyped panel.
      await expect(editors(win)).toHaveCount(0);

      await openQuickOpen(win);
      await win.keyboard.type('README');
      await win.keyboard.press('Enter');
      await expect(editors(win)).toHaveCount(1);
      await expect(editors(win).locator('.cm-content')).toContainText('// README.md', {
        timeout: 8000,
      });

      // …and the second choice REPLACES the document rather than adding a panel.
      await openQuickOpen(win);
      await win.keyboard.type('guide');
      await win.keyboard.press('Enter');
      await expect(editors(win)).toHaveCount(1);
      await expect(editors(win).locator('.cm-content')).toContainText('// docs/guide.md', {
        timeout: 8000,
      });
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('with "Open files in" set to New Editor, each choice lands in a new editor panel (AS-8)', async () => {
  const tree = createDeepTree('throng-qo-new-');
  const cfg = mkdtempSync(join(tmpdir(), 'throng-qo-cfg-'));
  writeFileSync(
    join(cfg, 'settings.json'),
    JSON.stringify({ editor: { openTarget: 'new' } }, null, 2),
  );
  try {
    // Its OWN app: the setting is read at launch, so it has to be on disk before the window exists.
    await runOwnApp(
      async (_app, win) => {
        await settle(win);
        await newProject(win, 'QONewEditor', tree.root);

        await openQuickOpen(win);
        await win.keyboard.type('README');
        await win.keyboard.press('Enter');
        await expect(editors(win)).toHaveCount(1);

        await openQuickOpen(win);
        await win.keyboard.type('guide');
        await win.keyboard.press('Enter');
        await expect(editors(win)).toHaveCount(2); // a NEW panel, not a reuse
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupDeepTree(tree);
    cleanupTemp(cfg);
  }
});

test('a file already open in some editor focuses that editor rather than opening a second copy (AS-9, Q2)', async () => {
  const tree = createDeepTree('throng-qo-onebuf-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOOneBuffer', tree.root);

      // Editor A holds README.md.
      const a = await newEditor(win);
      await win.getByTestId('file-explorer-tree').getByText('README.md', { exact: true }).click();
      await expect(win.getByTestId(`editor-${a}`).locator('.cm-content')).toContainText(
        '// README.md',
        { timeout: 8000 },
      );

      // A second editor panel, holding something else and holding focus.
      await win.getByTestId(`panel-add-${a}`).click();
      await expect(win.locator('.panel-box')).toHaveCount(2);
      const b = (await panelIds(win)).filter((id) => id !== a)[0];
      await win.getByTestId(`panel-type-select-${b}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${b}`).click();
      await expect(win.getByTestId(`editor-${b}`)).toBeVisible();
      // B must become the tab's LAST ACTIVE editor before the tree click, or the click routes the
      // file straight back into A and the test is comparing one editor with itself.
      await focusEditor(win, b);
      /*
       * `docs/guide.md` is a level down, and the tree opens collapsed — a folder is expanded by
       * DOUBLE-clicking it (#140). Waiting for the child row to appear before clicking it is the
       * point: a blind click on a row that has not been revealed resolves against nothing and the
       * test dies thirty seconds later naming the file, not the folder.
       */
      const explorer = win.getByTestId('file-explorer-tree');
      await explorer.getByText('docs', { exact: true }).dblclick();
      await expect(explorer.getByText('guide.md', { exact: true })).toBeVisible();
      await explorer.getByText('guide.md', { exact: true }).click();
      await expect(win.getByTestId(`editor-${b}`).locator('.cm-content')).toContainText(
        '// docs/guide.md',
        { timeout: 8000 },
      );
      await focusEditor(win, b);

      // Quick Open README.md — already open in A.
      await openQuickOpen(win);
      await win.keyboard.type('README');
      await win.keyboard.press('Enter');

      // No third editor, B keeps its own document, and A is the one that ends up focused.
      await expect(editors(win)).toHaveCount(2);
      await expect(win.getByTestId(`editor-${b}`).locator('.cm-content')).toContainText(
        '// docs/guide.md',
      );
      await expect(win.getByTestId(`editor-${a}`).locator('.cm-editor.cm-focused')).toBeVisible({
        timeout: 8000,
      });
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('a dirty target raises the shipped unsaved-changes prompt, and Cancel leaves the buffer untouched (AS-10, Q3)', async () => {
  const tree = createDeepTree('throng-qo-dirty-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QODirty', tree.root);

      const pid = await newEditor(win);
      await win.getByTestId('file-explorer-tree').getByText('README.md', { exact: true }).click();
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await expect(content).toContainText('// README.md', { timeout: 8000 });

      await focusEditor(win, pid);
      await win.keyboard.type('DIRTY-EDIT');
      await expect(content).toContainText('DIRTY-EDIT');

      await openQuickOpen(win);
      await win.keyboard.type('guide');
      await win.keyboard.press('Enter');

      // The SHIPPED prompt, by its shipped test ids — inherited, not re-implemented (Q3).
      await expect(win.getByTestId('unsaved-open-dialog')).toBeVisible({ timeout: 8000 });
      await win.getByTestId('unsaved-open-cancel').click();
      await expect(win.getByTestId('unsaved-open-dialog')).toHaveCount(0);

      // Cancel means nothing happened: the dirty text survives and the other file did not open.
      await expect(content).toContainText('DIRTY-EDIT');
      await expect(content).toContainText('// README.md');
      await expect(content).not.toContainText('// docs/guide.md');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-12, AS-13 — what may never appear in the list (FR-005, FR-006, SC-003)
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('a file inside an excluded folder is never listed (AS-12, FR-006)', async () => {
  const tree = createDeepTree('throng-qo-excl-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOExcluded', tree.root);

      await openQuickOpen(win);
      await win.keyboard.type(DEEP_TREE.excludedQuery);

      /*
       * A POSITIVE query with an exact expected result, not an absence argued from a long list.
       *
       * `quarantined` is carried by exactly two files: one under `.git`, which the SHIPPED
       * `DEFAULT_EXCLUDE_GLOBS` hides, and one under `node_modules`, which it does NOT (see
       * helpers/deep-tree.ts — this is the fixture's least obvious property). So the right answer is
       * one row, and a `.git` leak shows up as two.
       */
      await expect(quickOpenRows(win)).toHaveCount(1);
      const paths = await quickOpenRowPaths(win);
      expect(paths).toEqual(['node_modules/quarantined-pkg/quarantined-module.ts']);
      expect(paths.filter((p) => p.startsWith('.git/'))).toEqual([]);

      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('with a second project open, no file outside the current project root is listed (AS-13, FR-005)', async () => {
  const tree = createDeepTree('throng-qo-scope-');
  const other = createOtherProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOScopeDeep', tree.root); // …the deep tree, opened first
      await createProject(win, 'QOScopeOther', other); // …and now THIS one is active

      await openQuickOpen(win);

      // The active project's own file is offered…
      await win.getByTestId('quickopen-input').fill('zebra');
      await expect(quickOpenRows(win)).toHaveCount(1);
      expect(await quickOpenRowPaths(win)).toEqual(['zebra-only.txt']);

      // …and the other project's is not, though the app still has it open.
      await win.getByTestId('quickopen-input').fill(DEEP_TREE.ranking.query);
      await expect(quickOpenRows(win)).toHaveCount(0);
      await expect(win.getByTestId('quickopen-empty')).toBeVisible();

      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
    cleanupTemp(other);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-14, AS-15, FR-014 — order, stability and the cap
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('a name match is listed above a directory-only match (AS-14, K1, FR-007a)', async () => {
  const tree = createDeepTree('throng-qo-rank-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QORank', tree.root);

      await openQuickOpen(win);
      await win.keyboard.type(DEEP_TREE.ranking.query);
      await expect(quickOpenRows(win)).toHaveCount(2);

      /*
       * The fixture is built so the ranker has to WORK for this to pass: the index is produced
       * sorted (W7) and `src/router/…` sorts before `src/server/…`, so the directory-only match is
       * the seeded first. An implementation that does not rank returns them the other way round.
       */
      expect(await quickOpenRowPaths(win)).toEqual([
        DEEP_TREE.ranking.byName,
        DEEP_TREE.ranking.byDirectory,
      ]);

      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('arrowing through an unchanged result set never reorders it (AS-15, K4)', async () => {
  const tree = createDeepTree('throng-qo-stable-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOStable', tree.root);

      await openQuickOpen(win);
      await win.keyboard.type('.ts');
      await expect(quickOpenRows(win)).toHaveCount(6);
      const drawn = await quickOpenRowPaths(win);

      for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp']) {
        await win.keyboard.press(key);
      }
      // The highlight has moved — asserted, so "nothing reordered" is not satisfied by "nothing
      // happened at all".
      await expect(win.locator('[data-highlighted="true"]')).toHaveAttribute(
        'data-testid',
        `quickopen-row-${drawn[2]}`,
      );
      expect(await quickOpenRowPaths(win)).toEqual(drawn);

      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('past 200 rows the list is capped and the modal says how many matched (FR-014, P3, P4)', async () => {
  const root = createOversizedProject();
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOCapped', root);

      await openQuickOpen(win);
      await win.keyboard.type('capped-');

      // Rendering is capped at 200…
      await expect(quickOpenRows(win)).toHaveCount(200);
      // …but MATCHING is not: the count line is the truth about how many files matched (P3).
      await expect(win.getByTestId('quickopen-truncated')).toHaveText(
        `Showing 200 of ${TRUNCATION_FILES} matches`,
      );

      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupTemp(root);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-18 — the second invocation, at the shipped defaults
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('at the shipped defaults a reopened modal is empty (AS-18, FR-057, M1)', async () => {
  const tree = createDeepTree('throng-qo-reopen-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);
      await createProject(win, 'QOReopen', tree.root);

      // Accept a query — the only kind of value FR-061 would ever remember.
      await openQuickOpen(win);
      await win.keyboard.type('guide');
      await win.keyboard.press('Enter');
      await expect(editors(win).locator('.cm-content')).toContainText('// docs/guide.md', {
        timeout: 8000,
      });

      /*
       * The input is EMPTY on the second invocation, at the shipped defaults.
       *
       * AS-18's second clause — "and no results are listed" — is NOT asserted here, deliberately.
       * The shared picker's K6 makes an empty query match everything, so "empty input" and "empty
       * list" are two different claims and the spec states only the first as a requirement (FR-057).
       * Asserting the second would pin a behaviour no FR asks for, and it is exactly the kind of
       * guess that gets discovered as wrong after the implementation is written against it.
       */
      await openQuickOpen(win);
      await expect(win.getByTestId('quickopen-input')).toHaveValue('');

      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * SC-004 — the same outcome as the route from the tree
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('a file opened by Quick Open produces the same outcome as the same file opened from the tree (SC-004, Q7)', async () => {
  const viaTree = createDeepTree('throng-qo-sc4-tree-');
  const viaQuickOpen = createDeepTree('throng-qo-sc4-qo-');
  try {
    await runApp(async (_app, win) => {
      await settle(win);

      /**
       * Both routes are DRIVEN and compared, rather than one being assumed.
       *
       * The outcome of an open is three things: how many editor panels exist afterwards, which file
       * the panel header names, and what the document holds. Two identical fixtures in two projects
       * keep the routes from interfering — creating a project swaps the whole workspace.
       */
      const outcome = async (): Promise<{ panels: number; file: string; body: string }> => {
        const pid = (await win.locator('.editor-panel').first().evaluate(
          (el) => (el as HTMLElement).closest('.panel-box')?.getAttribute('data-panel-id') ?? '',
        )) as string;
        return {
          panels: await editors(win).count(),
          file: (await win.getByTestId(`panel-file-${pid}`).textContent()) ?? '',
          body: (await win.getByTestId(`editor-${pid}`).locator('.cm-content').textContent()) ?? '',
        };
      };

      await createProject(win, 'QOSc4Tree', viaTree.root);
      await win.getByTestId('file-explorer-tree').getByText('README.md', { exact: true }).click();
      await expect(editors(win).locator('.cm-content')).toContainText('// README.md', {
        timeout: 8000,
      });
      const fromTree = await outcome();

      await createProject(win, 'QOSc4QuickOpen', viaQuickOpen.root);
      await expect(editors(win)).toHaveCount(0);
      await openQuickOpen(win);
      await win.keyboard.type('README');
      await win.keyboard.press('Enter');
      await expect(editors(win).locator('.cm-content')).toContainText('// README.md', {
        timeout: 8000,
      });
      const fromQuickOpen = await outcome();

      expect(fromQuickOpen).toEqual(fromTree);
    });
  } finally {
    cleanupDeepTree(viaTree);
    cleanupDeepTree(viaQuickOpen);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * FR-017 / Assumption 6 — a sub-workspace window searches ITS OWN root
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Seed one sub-workspace whose single tab holds a panel belonging to a NAMED project.
 *
 * The origin project id is interpolated because that is the whole point: a panel with an unknown
 * origin is sub-workspace-OWNED and rootless, which would make the assertion below vacuous.
 */
const seedSubWorkspace = (originProjectId: string): string =>
  `(() => window.throng.invoke('workspace.persistSubWorkspaces', { subWorkspaces: [
     { id: 'sw1', ownerUser: 'u', name: 'Detached', colour: '#3fb950',
       bounds: { x: 0, y: 0, width: 700, height: 520 },
       tabs: [{ id: 't', title: 'T', root: { type: 'panel', id: 'swpanel',
         originProjectId: ${JSON.stringify(originProjectId)}, title: 'P' } }] },
   ] }))()`;

test('in a sub-workspace window the candidate set is that window’s own root, never the main window’s (FR-017, R2, Assumption 6)', async () => {
  const owned = createDeepTree('throng-qo-sw-owned-');
  const mainWindowProject = createOtherProject();
  try {
    // Its OWN app: this persists a sub-workspace and reloads the window, and a shared app would
    // carry both into every test that followed.
    await runOwnApp(async (app, win) => {
      await settle(win);

      await newProject(win, 'QOSubOwned', owned.root);
      const ownedId = await win
        .locator('.project-item[data-active="true"]')
        .evaluate((el) => (el.getAttribute('data-testid') ?? '').replace('project-item-', ''));
      expect(ownedId, 'could not read the origin project id').not.toBe('');

      // A DIFFERENT project is what the MAIN window is looking at. Without this the two roots are
      // the same and the test proves nothing.
      await newProject(win, 'QOSubMain', mainWindowProject);

      await win.evaluate(seedSubWorkspace(ownedId));
      await reloadWindow(win);

      const [child] = await Promise.all([
        app.waitForEvent('window'),
        win.getByTestId('subworkspace-open-sw1').click(),
      ]);
      await child.waitForLoadState('domcontentloaded');
      await settle(child);

      // Make the sub-workspace's panel an editor, so the window has an active panel whose origin
      // project decides the root (R2).
      await child.getByTestId('panel-type-select-swpanel').selectOption('editor');
      await child.getByTestId('panel-type-confirm-swpanel').click();
      await expect(child.getByTestId('editor-swpanel')).toBeVisible();

      await openQuickOpen(child);

      // The OWNING project's files are offered…
      await child.getByTestId('quickopen-input').fill(DEEP_TREE.ranking.query);
      await expect(quickOpenRows(child)).toHaveCount(2);

      // …and the MAIN window's active project's file is not.
      await child.getByTestId('quickopen-input').fill('zebra');
      await expect(quickOpenRows(child)).toHaveCount(0);

      await child.keyboard.press('Escape');
      await expect(child.getByTestId('quickopen')).toHaveCount(0);

      // …and the chord works in the main window too, against ITS root — Assumption 6 rejects a chord
      // that is live in one window and dead in the other.
      await win.bringToFront();
      await win.keyboard.press(QUICK_OPEN_CHORD);
      await expect(win.getByTestId('quickopen')).toBeVisible();
      await win.getByTestId('quickopen-input').fill('zebra');
      await expect(quickOpenRows(win)).toHaveCount(1);
      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(owned);
    cleanupTemp(mainWindowProject);
  }
});
