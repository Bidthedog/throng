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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject as newProject,
  firstPanelId,
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

/**
 * Press Enter on a query whose answer is exactly ONE file — after waiting for that row to exist.
 *
 * ══ THE BUG THIS CLOSES, MEASURED RATHER THAN GUESSED ══
 *
 * `Enter` is not queued: the picker answers it from the highlighted row, and while the file index is
 * still being enumerated there is no row at all. FR-015 / S3 makes that state legitimate and visible
 * — the modal opens before the walk finishes and says "Still listing this project's files…" — so an
 * `Enter` that arrives inside that window is correctly ignored, and NOTHING retries it. The modal
 * stays open, the row appears a beat later, and the test then dies on an assertion about editor
 * panels while the actual event was a keystroke that landed on an empty list.
 *
 * That is exactly what AS-8 was failing on, and it took a probe to see, because by the time the
 * assertion times out the evidence has healed. Captured at the moment of failure:
 *
 *     {"modal":1,"input":"README","rows":1,"editors":0,"active":"INPUT.picker__input"}
 *
 * — the modal still open, the query still typed, ONE row listed and no editor: an Enter pressed at a
 * list that did not exist yet. It reproduced 2 times in 6 against a freshly launched app (the AS-8
 * case, whose own app has a cold index) and 0 times in 3 full passes of this file, which is why it
 * read as a phantom for two rounds of diagnosis.
 *
 * The rule this restores is one this suite already holds: never send a key at a control you have not
 * asserted is there. Every other choose-by-Enter in this file states its expected row count first;
 * these were the ones that did not.
 */
async function chooseTheOnlyRow(win: Page): Promise<void> {
  await expect(quickOpenRows(win)).toHaveCount(1);
  await win.keyboard.press('Enter');
}


/**
 * Every chunk this terminal view has put on the wire, in order, as its own diagnostics record them.
 *
 * Reading the SCREEN would not answer AS-1: `Ctrl+Shift+T` prints nothing in `cmd`, so an unchanged
 * screen is equally consistent with the chord having been delivered and swallowed. The write log is
 * what distinguishes "the terminal received nothing" from "the terminal received something
 * invisible".
 *
 * ══ WHY THE LOG AND NOT `input.written` ══
 *
 * This assertion was first written against the `input.written` COUNTER, and the counter is too
 * coarse to carry it. Measured with an instrumented probe: the chord itself writes nothing, but the
 * modal taking focus makes the terminal lose it, and a terminal with focus reporting on (DEC 1004)
 * answers a real focus change with `ESC [ O` — one write, no keystroke. That behaviour is 028's,
 * deliberate and load-bearing (`use-terminal.ts` gates reports on a capture-phase focus listener
 * precisely so that a report is sent when, and only when, focus really moved), and it predates this
 * feature: ANY modal that takes the caret from a terminal produces it. A counter cannot tell that
 * report apart from a keystroke; the log can, so the log is what AS-1 is asserted against.
 */
async function inputWrites(win: Page, panelId: string): Promise<string[]> {
  return win.evaluate((id) => {
    const probe = (
      window as unknown as {
        __throngTerminalDiagnostics?: () => Record<string, { writes: string[] }>;
      }
    ).__throngTerminalDiagnostics;
    return probe?.()[id]?.writes ?? [];
  }, panelId);
}

/**
 * `CSI I` / `CSI O` — a focus report. Not a keystroke, and the only write a modal may cause.
 *
 * Spelled with an ESCAPE SEQUENCE, not a raw control byte, because that is how `diagnostics.ts`
 * stores a write: `recordWrite` pushes `JSON.stringify(data).slice(1, -1)`, so the log holds the
 * nine characters `[O`. A raw byte here would also make this file's diffs unreviewable — git
 * classifies a file carrying control bytes as binary.
 */
const FOCUS_REPORTS = new Set(['\\u001b[I', '\\u001b[O']);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-1, AS-5, SC-001, FR-011, Q6, S3 — the chord from a terminal
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('from a focused terminal the chord opens a centred modal, sends the shell nothing, draws no target control, and takes three actions to an open file', { tag: ['@core', '@editor', '@reserve:pty'] }, async () => {
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
       * "The chord wrote nothing" is unfalsifiable against a log that never grows — a probe reading
       * the wrong panel id, or a diagnostics hook that was never installed, reports an empty array
       * for both the passing and the failing world. One real keystroke first, and the later
       * assertion means something.
       */
      const beforeTyping = await inputWrites(win, pid);
      await win.keyboard.type('x');
      await expect.poll(async () => (await inputWrites(win, pid)).length).toBeGreaterThan(
        beforeTyping.length,
      );

      const beforeChord = await inputWrites(win, pid);
      expect(beforeChord, 'the terminal never recorded the proving keystroke').toContain('x');
      await openQuickOpen(win); // …waits for the dialog AND for its input to hold focus

      /*
       * AS-1 — the terminal received NO KEYSTROKE. Safe to read now precisely because the modal is
       * already on screen: anything the chord was going to send has been sent.
       *
       * The delta is allowed to contain a FOCUS REPORT and nothing else. The modal takes the caret,
       * so the terminal really does lose focus, and a terminal with focus reporting on answers a
       * real focus change with `ESC [ O` — 028's behaviour, gated on a capture-phase focus listener
       * for exactly that reason, and produced by every modal in the application rather than by this
       * one. What AS-1 forbids is a KEY reaching the shell, and a key is what the delta must not
       * hold. Anything unexpected is named in the failure rather than swallowed by a subset check.
       */
      const afterChord = await inputWrites(win, pid);
      expect(
        afterChord.slice(beforeChord.length).filter((chunk) => !FOCUS_REPORTS.has(chunk)),
        'the Quick Open chord reached the shell',
      ).toEqual([]);

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
      await chooseTheOnlyRow(win);

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

/*
 * MOVED to `packages/ui/tests/component/picker.test.ts` (034 FR-045) — four tests:
 *   - every match listed with its full project-relative path and its matched runs MARKED
 *   - Down, Down, Enter chooses the third row
 *   - a no-match query says so and keeps the list on screen
 *   - past 200 rows the list is capped and says how many matched
 *
 * None of them is about Quick Open. `QuickOpen` builds entries from the file index and hands them
 * to the shared `Picker`, which owns the list, the filtering, the marks, the highlight, the cap
 * and the messages — and takes no context at all, so it renders in jsdom with plain props. The
 * same component is behind the tab picker, so the migration covers that too, and covers pickers
 * nobody has written yet.
 *
 * Red-proved: removing the cap reddens the cap test, making Enter inert reddens the choose test.
 *
 * WHAT STAYS, and why it is not the same claim: "clicking a row opens that file" below. The
 * component test can only see that `onChoose` fired with the right entry. That a file then opens
 * — the right one, in the right panel — is the wiring between the picker and the workspace, and
 * it is what SC-004 turns on. One witness of that seam is kept rather than four.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-3, AS-4 — choosing
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('clicking a row opens that file and closes the modal (AS-4)', { tag: ['@extended', '@editor'] }, async () => {
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

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-7 to AS-10 — where the file lands, all four routes inherited (Q2, Q3, Q4)
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/*
 * FOUR TESTS REMOVED (035) — AS-7, AS-8, AS-9 and AS-10, the four open ROUTES.
 *
 * ══ THE ARGUMENT, WHICH IS THIS FILE'S OWN ══
 *
 * Q2/Q3/Q4 say Quick Open INHERITS the tree's routing rather than re-implementing it, and `:478`'s
 * comment says so in as many words: "The SHIPPED prompt, by its shipped test ids — inherited, not
 * re-implemented (Q3)". So there are two separable claims here, and only one of them is Quick
 * Open's: that the ROUTING is correct, and that Quick Open reaches it.
 *
 * The routing is now proved at the component layer, by name, one test per route:
 *
 *   AS-7  → `editor-open-routing.test.ts` › "creates the tab's dedicated editor when the tab has
 *           none" AND "reuses the LAST ACTIVE editor, not merely the first one it finds"
 *   AS-8  → › "opens a NEW panel every time when the open target is 'new' (033 US7, FR-072)" AND
 *           "with 'New Editor', each opened file lands in a NEW panel"
 *   AS-9  → › "focuses the holding panel and creates no second editor"
 *   AS-10 → › "cancel leaves the buffer alone and opens nothing", plus "'new' opens the file in a
 *           fresh panel" and "a failed save does NOT then replace the document" — three branches of
 *           the prompt where the E2E drove one.
 *
 * AS-8 is worth singling out: it needed its OWN Electron app, because `editor.openTarget` is read
 * at launch and had to be on disk before the window existed. A component test hands it through
 * `ConfigProvider` in one line.
 *
 * ══ WHAT PROVES THE INHERITANCE, AND WHY IT IS ENOUGH ══
 *
 * `:616` (SC-004, Q7) drives BOTH routes against identical fixtures and compares three things —
 * panel count, the header's file name, and the document body. That is the equivalence claim itself,
 * and it is stronger than any single route test: four route tests prove the routing four times,
 * where one equivalence test proves Quick Open is on the same path.
 *
 * `:324` stays too. It is the only test here that CLICKS a row with the mouse, and clicking is the
 * gesture AS-4 is about.
 */




/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-12, AS-13 — what may never appear in the list (FR-005, FR-006, SC-003)
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('a file inside an excluded folder is never listed (AS-12, FR-006)', { tag: ['@extended', '@editor'] }, async () => {
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
       * `quarantined` is carried by exactly two files: one under `.git` and one under
       * `node_modules`. Since FR-070 the SHIPPED `DEFAULT_EXCLUDE_GLOBS` hides BOTH folders, so the
       * right answer is zero rows and a leak from either shows up as one.
       *
       * This assertion used to expect the `node_modules` file and to say in a comment that
       * `node_modules` was not excluded by default. That was correct when it was written and FR-070
       * inverted it deliberately — the change is to a shipped default that governs every project's
       * file tree, which is the intent rather than a side effect.
       */
      await expect(quickOpenRows(win)).toHaveCount(0);
      await expect(win.getByTestId('quickopen-empty')).toBeVisible();

      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('with a second project open, no file outside the current project root is listed (AS-13, FR-005)', { tag: ['@extended', '@editor'] }, async () => {
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

/*
 * MOVED to `packages/core/tests/unit/picker-rank.test.ts` (034 FR-046a):
 *   - "a name match is listed above a directory-only match (AS-14, K1, FR-007a)"
 *   - "arrowing through an unchanged result set never reorders it (AS-15, K4)"
 *
 * Ranking and stable ordering are pure functions over paths. Flattening every score to a
 * constant reddens 8 cases in that unit test.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * AS-18 — the second invocation, at the shipped defaults
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/*
 * DELETED as a duplicate (034 FR-046a) — "at the shipped defaults a reopened modal is empty".
 *
 * `navigation-remember.e2e.ts:247` makes the same claim and more of it. Both accept the query
 * `guide`, reopen the modal and assert `quickopen-input` holds `""`. That test additionally
 * asserts the row count is the WHOLE project (which is what an unseeded query lists), asserts
 * the Go To Line half in the same window, and reads its own config root back to prove
 * `rememberQuickOpenQuery` really was `false` — so it cannot pass because a setting quietly
 * defaulted the way the test wanted. This one asserted the input alone, in an app whose
 * settings it never looked at.
 *
 * AS-18’s second clause — "and no results are listed" — was deliberately NOT asserted in either
 * place, and the reason is worth keeping here: the shared picker’s K6 makes an empty query
 * match everything, so "empty input" and "empty list" are two different claims and FR-057
 * states only the first. Asserting the second would pin a behaviour no requirement asks for.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * SC-004 — the same outcome as the route from the tree
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('a file opened by Quick Open produces the same outcome as the same file opened from the tree (SC-004, Q7)', { tag: ['@extended', '@editor'] }, async () => {
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
      await chooseTheOnlyRow(win);
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

test('in a sub-workspace window the candidate set is that window’s own root, never the main window’s (FR-017, R2, Assumption 6)', { tag: ['@core', '@editor', '@reserve:window'] }, async () => {
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

      /*
       * …and the chord works in the main window too, against ITS root — Assumption 6 rejects a chord
       * that is live in one window and dead in the other.
       *
       * RE-ENTER THE PROJECT FIRST. A reloaded window comes up with NO project selected — shipped
       * behaviour that long predates this feature, asserted directly by
       * `editor-caret-persist.e2e.ts` (`workspace-no-project` visible straight after a reload) and
       * worked around in the same way by `editor-stranded-recovery.e2e.ts`. Measured here with an
       * instrumented probe after this line failed: the main window had zero active projects and no
       * file tree, so the chord opened nothing — which is FR-018 / A5 behaving exactly as specified,
       * not the chord being dead. Without this click the assertion tests the reload, not the chord.
       */
      await win.bringToFront();
      await win
        .locator('.project-item', { hasText: 'QOSubMain' })
        .locator('[data-testid^="project-switch-"]')
        .click();
      await expect(win.getByTestId('file-explorer-tree')).toBeVisible();

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
