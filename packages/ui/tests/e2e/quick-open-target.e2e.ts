/**
 * 033 US1 (#219) — Quick Open's target control: the two-option header, and the key that opens.
 *
 * Covers AS-11, AS-11a, AS-11b and AS-11c of the spec, T1–T6, P7, P8 and E1–E5 of
 * `contracts/picker-extensions.md`, and FR-010, FR-010a and FR-010b.
 *
 * ══ THE ONE BEHAVIOURAL CHANGE TO A SHIPPED PATH ══
 *
 * The shared picker's `onKeyDown` sits on the dialog and claims `Enter` wherever it originated. E1
 * narrows that to "only when the event target is the query input", and this file is the only place
 * that difference is observable: with no `header` the input is the sole focusable element, so every
 * key already originates there and the tab picker sees no change at all (E4). If these tests are
 * ever deleted, nothing anywhere else notices the narrowing being reverted.
 *
 * ══ TEST IDS ══
 *
 * `contracts/picker-extensions.md §5` fixes the picker's `testId` at `quickopen` and the shipped
 * `Picker` derives `quickopen-input`, `quickopen-row-<path>` and the rest from it. The control
 * itself is NOT fixed by any contract, so it is named here, by the same derivation:
 *
 *   data-testid="quickopen-target"   the control
 *   data-value="lastActive" | "new"  its current value, in the SHIPPED `editor.openTarget`
 *                                    vocabulary — the same two strings the setting takes, so the
 *                                    preselection in T2 is a comparison rather than a translation.
 *   data-testid="quickopen-target-label"  the sentence INSIDE that one button (FR-068). Named so a
 *                                    test can click the WORDS rather than the icon, which is the
 *                                    specific thing "make them one button" means to a user.
 *   data-testid="quickopen-hidden"   the FR-069 exclusion toggle, the target button's sibling
 *   data-value="exclude" | "include" what it is doing NOW, not what pressing it would do — the same
 *                                    convention `quickopen-target` follows
 *
 * ══ SERIAL TIER, AND WHY THAT IS NOW THE CALLER'S QUESTION ══
 *
 * `parallel-plan.json` lists this file because it used to drive the file tree's CONTEXT MENU to hide
 * a file (SC-022), and throng closes menus when its window loses focus. That walk moved to
 * `integration/project-file-index.integration.test.ts` (test-suite audit), so nothing here opens a
 * menu any more; whether the file belongs in the parallel tier is for `tier-plan.test.ts` to say.
 */
import { test, expect, type Page } from '@playwright/test';
import { openApp, createProject as newProject, firstPanelId, focusEditor, settle, type AppOptions, type OpenApp } from './harness.js';
import { createDeepTree, cleanupDeepTree, DEEP_TREE } from './helpers/deep-tree.js';
import { openQuickOpen, quickOpenRows } from './helpers/navigation.js';

/*
 * ONE app for this file, and now EVERY test in it shares that one. The last spec that seeded
 * state before launch — a config root carrying `editor.openTarget: 'new'`, read at startup —
 * moved to the component layer with the rest of the header controls and took its `runOwnApp`
 * launch with it. The shim below still REFUSES options rather than ignoring them: a dropped
 * config root does not fail, it passes for the wrong reason.
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

let projectSeq = 0;
const createProject = (win: Page, name: string, root: string): Promise<void> =>
  newProject(win, `${name}-${(projectSeq += 1)}`, root);

const target = (win: Page) => win.getByTestId('quickopen-target');

/**
 * A project with one editor panel, focused — the context FR-011 makes the control conditional on.
 *
 * Returns the panel id. Every test here starts from the same place, and the absence case (invoked
 * from a terminal, no control) is `quick-open.e2e.ts`'s, not this file's.
 */
async function editorWithProject(win: Page, name: string, root: string): Promise<string> {
  await settle(win);
  await createProject(win, name, root);
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
  await focusEditor(win, pid);
  return pid;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

/*
 * MOVED to `packages/ui/tests/component/quick-open-header.test.ts` (034 FR-045) — five tests,
 * nineteen cases:
 *   :177  the control ABOVE the input, preselected, focus in the query field, Tab trapped
 *   :311  Shift+Tab reaches it and Space toggles it without opening anything
 *   :346  E1 — Enter opens a file ONLY from the query input
 *   :536  the preselection follows `editor.openTarget`
 *   :656  the two header controls are siblings, and only the target one is conditional
 *
 * THE SUBJECT THERE IS THE REAL `QuickOpen`, not a hand-built header, and that is what makes the
 * migration honest: these claims ARE the composition — which control, in what order, inside which
 * element, and which of the two is conditional. A host that assembled `Picker`, `QuickOpenHidden`
 * and `QuickOpenTarget` itself would be asserting its own arrangement and would leave
 * `quick-open.tsx`’s header block untested (FR-047). It mounts at all because the candidate set
 * arrives as a PROP (`index: FileIndexView`), so there is no walk, no daemon and no project on
 * disk; the only context is `useWorkspace`, whose provider is exported and takes its client as a
 * prop.
 *
 * FIVE OF THE NINETEEN LAND STRONGER THAN THE E2E DID:
 *   - the hover title is asserted to name BOTH destinations, not merely to be non-empty
 *   - Tab is asserted as a SEQUENCE (hidden → target → input). The E2E asked only "still inside",
 *     which a trap pinned to one element satisfies perfectly — and which is exactly what a
 *     missing `offsetParent` stub produces in jsdom, so the component file stubs it and says why
 *   - the Enter that opens is asserted on the ROUTER CALL — the exact absolute path (Q1) and the
 *     exact `EditorOpenTarget` — where the E2E could only see that some editor held the file
 *   - the `invokedFrom === null` branch of that same ternary is covered for the first time at any
 *     layer
 *   - the exclusion toggle is asserted to report UPWARDS rather than hold a value of its own,
 *     which is the property `navigation-chrome.tsx` depends on and which nothing checked
 *
 * WHAT DID NOT MOVE, AND WHY:
 *   - `:228`’s "the modal must not JUMP as the sentence changes length" — a `boundingBox()`
 *     compared across the toggle. jsdom has no layout engine, so that assertion has no meaning
 *     there at any fidelity (FR-049). Its WORDING half IS re-proved at the component layer, as a
 *     STRENGTHENING rather than a replacement: `:228` keeps its declaration below.
 *   - the one-buffer cases and the two hiding mechanisms. Those are `openFileInTab`’s decisions
 *     and a real project’s exclusion rules, neither of which is the header.
 *
 * ANTI-VACUITY CONTROL, stated in that file and runnable: drop the `WorkspaceProvider` wrapper
 * from its `mount()` and `useWorkspace` throws, so nothing renders — ALL NINETEEN fail, every one
 * of them on the `findByTestId('quickopen-input')` that each test awaits before it starts.
 */

/*
 * NARROWED (test-suite audit) to the one claim only a layout engine can make: the modal must not JUMP
 * as the target sentence changes length. The wording, the panel name, the single-button shape and the
 * click-the-words toggle are `component/quick-open-header.test.ts` "the control says where the file
 * will land IN WORDS (SC-020, FR-068)"; jsdom has no layout, so the box comparison stays.
 */
test('the modal does not jump as the target sentence changes length (SC-020, FR-068)', { tag: ['@extended', '@editor', '@reserve:layout'] }, async () => {
  const tree = createDeepTree('throng-qot-words-');
  try {
    await runApp(async (_app, win) => {
      await editorWithProject(win, 'QOTargetWords', tree.root);
      await openQuickOpen(win);
      await expect(target(win)).toHaveAttribute('data-value', 'lastActive');

      // `.picker` is a fixed-width card, so the two strings resize the button and nothing else.
      const boxBefore = await win.getByTestId('quickopen').boundingBox();
      await win.getByTestId('quickopen-target-label').click();
      await expect(target(win)).toHaveAttribute('data-value', 'new');
      expect(await win.getByTestId('quickopen').boundingBox()).toEqual(boxBefore);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/*
 * MOVED to the pre-existing suite (034 FR-046a) — two tests, and the argument is a chain rather
 * than a single covering test:
 *
 *   quick-open.e2e.ts:778     a file opened by Quick Open produces the SAME OUTCOME as the same
 *                             file opened from the tree (SC-004)
 *   editor-open-target.e2e.ts with "New Editor" each file lands in a new panel; with "Last Active
 *                             Editor" opens reuse one (#141)
 *
 * The route is proven equivalent once, and the setting is proven on that route once. Asserting
 * the setting a third time through Quick Open tests the same branch with a different way in.
 *
 * MOVED DOWN (test-suite audit) — the two "one-buffer rule holds on the `new` target" declarations
 * (FR-008, FR-011a, AS-9: a file already open in this tab is activated, not copied; a file open in
 * ANOTHER tab activates that tab's editor). Quick Open hands `openFileInTab` the control's value, and
 * the gate that was skipped for `new` is that function's: `component/editor-open-routing.test.ts`,
 * "with the target on "new", a file already open in this tab is activated, not copied (AS-9)" and
 * "... open in ANOTHER tab activates that tab's editor (FR-011a)", both red with the gate skipped for
 * the `new` target. That Quick Open passes the control's value through unchanged is
 * `component/quick-open-header.test.ts` "Enter IN THE INPUT opens the highlighted row, at the path and
 * target the control was left on".
 *
 * Reported from hand-testing, for the record: with the control on "a new editor panel", choosing a
 * file that was ALREADY open produced a SECOND editor on the same file.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */



/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The exclusion toggle — FR-069 to FR-069c, SC-018, SC-022
 *
 * It lives here because this file owns `.picker__header`, and FR-069 draws the toggle as the target
 * button's SIBLING in it. The two controls are also asymmetric on purpose — the target button
 * carries its explanation as text (FR-068) and this one is an icon with a hover title — so a spec
 * that saw only one of them would read that asymmetry as a defect.
 *
 * ══ WHY BOTH HALVES OF SC-018 ARE ASSERTED SEPARATELY ══
 *
 * A project hides files by TWO mechanisms and the user experiences them as one: `explorer.excludeGlobs`
 * and the per-project hidden set that "Hide in this project" writes (004). The delivered code honoured
 * the first and not the second, so a file the user had hidden was absent from the tree and offered by
 * Quick Open. A single assertion over "a hidden file" would have passed on the glob half alone —
 * which is exactly how the defect survived — so SC-022 states the hidden-set half on its own and this
 * file asserts it against its own file, with its own query.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** The toggle. Named here by §5's derivation, exactly as `quickopen-target` is. */
const hiddenToggle = (win: Page) => win.getByTestId('quickopen-hidden');


/*
 * NARROWED (test-suite audit) — `at the shipped default NEITHER mechanism's files are candidates, and
 * the toggle brings both back (SC-018, SC-022, FR-069c)`. The two mechanisms and the include flag are
 * decisions of the index, not of a window: `integration/project-file-index.integration.test.ts`
 * "AS-12 — at the SHIPPED exclude globs, nothing under .git or node_modules is listed" (:353),
 * "FR-069c — the globs and the hidden set compose in ONE walk" (:567), "FR-069a — changing the hidden
 * set re-walks the root and pushes the difference" (:580) and "two subscriptions to one root at
 * different includeHidden values get DIFFERENT sets" (:640), with the toggle's own contract in
 * `component/quick-open-header.test.ts` (:515-:560). The tree's "Hide in this project" context-menu
 * walk is gone with it.
 *
 * WHAT STAYS is FR-069b, which nothing below E2E reads: "the toggle changes the current modal; the
 * setting decides where every modal starts" is `NavigationChrome`'s reset on the transition into an
 * open Quick Open, and the toggle's `data-value` is the observable.
 */
test('the toggle changes this invocation only — the next Quick Open starts excluding again (FR-069b)', { tag: ['@extended', '@editor'] }, async () => {
  const tree = createDeepTree('throng-qot-hidden-');
  try {
    await runApp(async (_app, win) => {
      const pid = await editorWithProject(win, 'QOToggleBoth', tree.root);
      await focusEditor(win, pid);

      await openQuickOpen(win);
      // FR-069b — the shipped setting is "exclude", so the modal opens excluding.
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'exclude');
      await win.getByTestId('quickopen-input').fill(DEEP_TREE.excludedQuery);
      await expect(quickOpenRows(win)).toHaveCount(0);

      // Flip it: the hidden files are candidates for THIS invocation.
      await hiddenToggle(win).click();
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'include');
      await expect(quickOpenRows(win)).toHaveCount(2);
      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);

      // The setting decides where every modal STARTS: the next one excludes again.
      await focusEditor(win, pid);
      await openQuickOpen(win);
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'exclude');
      await win.getByTestId('quickopen-input').fill(DEEP_TREE.excludedQuery);
      await expect(quickOpenRows(win)).toHaveCount(0);
      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/*
 * DELETED (test-suite audit) — `flipping the toggle to SHOW excluded files never empties the list
 * mid-flight (FR-069d)`. The flip moves the window onto a second subscription that has never held
 * paths; what it must not do is blank the list meanwhile. That is the hook's decision, proved with
 * no window: `component/use-file-index.test.ts` "KEEPS the list when it arrives before this key has
 * ever delivered a ready" (:156) and "DISCARDS the list when it arrives after a ready for this key —
 * main has disowned it" (:180), the pair that keeps the borrow from being either permanent or absent.
 * The "still listing" pairing on a long walk remains `quick-open-perf.e2e.ts`.
 */
