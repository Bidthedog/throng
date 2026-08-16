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
 * ══ WHY THIS FILE IS SERIAL ══
 *
 * It drives the file tree's CONTEXT MENU, to hide a file the way a user does (SC-022). throng closes
 * menus when its window loses focus, so a second headed app started concurrently would close the menu
 * underneath this one — which is why `parallel-plan.json` lists this file. It was in the parallel tier
 * until the toggle arrived; the move is a consequence of that assertion, not of the file's age.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  runApp as runOwnApp,
  createProject as newProject,
  firstPanelId,
  panelIds,
  focusEditor,
  commitPanelRename,
  commitTabRename,
  settle,
  cleanupTemp,
  type AppOptions,
  type OpenApp,
} from './harness.js';
import { createDeepTree, cleanupDeepTree, DEEP_TREE } from './helpers/deep-tree.js';
import { openQuickOpen, quickOpenRows, quickOpenRowPaths } from './helpers/navigation.js';

/*
 * ONE app for this file. Only the last test seeds state before launch — a config root carrying
 * `editor.openTarget: 'new'`, which is read at launch — and it says so by calling `runOwnApp`.
 * The shim refuses options rather than ignoring them: a dropped config root does not fail, it
 * passes for the wrong reason.
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

const editors = (win: Page) => win.locator('.editor-panel');
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

/**
 * Press Enter on a query whose answer is exactly ONE file — after waiting for that row to exist.
 *
 * `Enter` is answered from the highlighted row and nothing queues it, so a key pressed while the
 * file index is still enumerating (FR-015 / S3, the "Still listing this project's files…" state) is
 * correctly ignored and never retried: the modal stays open, the row arrives a beat later, and the
 * test then fails on an assertion about editor panels. Measured on the sibling spec at 2 failures in
 * 6 against a freshly launched app — see `chooseTheOnlyRow` in `quick-open.e2e.ts`, which carries
 * the captured evidence. The same guard belongs here, where every one of these queries also has
 * exactly one answer.
 */
async function chooseTheOnlyRow(win: Page): Promise<void> {
  await expect(quickOpenRows(win)).toHaveCount(1);
  await win.keyboard.press('Enter');
}

/**
 * Put the control on "a new editor panel" and leave focus back in the query input.
 *
 * The keyboard route (E5 / T4), not a click, because a click on the header moves DOM focus out of
 * the input and the Enter that follows would then be answered by the control rather than by the
 * list — which is E1's whole subject and would make these tests measure the wrong key.
 */
async function chooseNewEditorTarget(win: Page): Promise<void> {
  await win.keyboard.press('Shift+Tab');
  await expect(target(win)).toBeFocused();
  await win.keyboard.press('Space');
  await expect(target(win)).toHaveAttribute('data-value', 'new');
  await win.keyboard.press('Tab');
  await expect(win.getByTestId('quickopen-input')).toBeFocused();
}

/** Add a sibling panel to `pid` and make it an editor. Returns the new panel's id. */
async function addEditorPanel(win: Page, pid: string): Promise<string> {
  const before = await win.locator('.panel-box').count();
  await win.getByTestId(`panel-add-${pid}`).click();
  await expect(win.locator('.panel-box')).toHaveCount(before + 1);
  // A freshly added panel opens in rename mode; an open rename input eats the keys that follow.
  await commitPanelRename(win);
  const next = (await panelIds(win)).filter((id) => id !== pid)[0];
  await win.getByTestId(`panel-type-select-${next}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${next}`).click();
  await expect(win.getByTestId(`editor-${next}`)).toBeVisible();
  return next;
}

/** The `data-testid`s inside the dialog card, in DOM order — how "above the input" is checked. */
async function dialogOrder(win: Page): Promise<string[]> {
  return win
    .getByTestId('quickopen')
    .evaluate((card) =>
      [...card.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid') ?? ''),
    );
}

/** Is focus still inside the modal? P7's question, asked of the document rather than of a guess. */
async function focusInsideModal(win: Page): Promise<boolean> {
  return win.evaluate(() => {
    const card = document.querySelector('[data-testid="quickopen"]');
    return card !== null && document.activeElement !== null && card.contains(document.activeElement);
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── */

test('invoked from inside an editor the control sits ABOVE the input, preselected from the shipped default, with focus in the query field (AS-11, AS-11a, T1–T3, T6, P7, P8)', async () => {
  const tree = createDeepTree('throng-qot-shape-');
  try {
    await runApp(async (_app, win) => {
      await editorWithProject(win, 'QOTargetShape', tree.root);
      await openQuickOpen(win);

      // T3 — drawn, because this modal was invoked from inside an editor panel.
      await expect(target(win)).toBeVisible();

      // P7 — ABOVE the input, which is a claim about DOM order and therefore about tab order.
      // Asserted on the order rather than on pixels: the control being first in the DOM is what
      // makes E5's Shift+Tab reach it.
      const order = await dialogOrder(win);
      expect(order).toContain('quickopen-target');
      expect(order.indexOf('quickopen-target')).toBeLessThan(order.indexOf('quickopen-input'));

      // T2 — preselected from `editor.openTarget`, which is `lastActive` at the shipped default.
      await expect(target(win)).toHaveAttribute('data-value', 'lastActive');

      // T6 — a themeable control with a hover title naming what it does.
      const title = await target(win).getAttribute('title');
      expect(title ?? '', 'the target control has no hover title').not.toBe('');

      /*
       * AS-11a / P8 — focus starts in the query input and TYPING GOES THERE.
       *
       * `openQuickOpen` already asserted the input holds focus; this asserts the consequence, which
       * is the thing a user would notice. A control that quietly swallowed the first keystroke
       * would pass a focus assertion and fail here.
       */
      await win.keyboard.type('config');
      await expect(win.getByTestId('quickopen-input')).toHaveValue('config');
      await expect(target(win)).toHaveAttribute('data-value', 'lastActive');
      await expect(quickOpenRows(win)).toHaveCount(2);

      // E3 / P7 — Tab reaches the trap and cannot leave the modal through the header.
      expect(await focusInsideModal(win)).toBe(true);
      await win.keyboard.press('Tab');
      expect(await focusInsideModal(win), 'Tab escaped the modal through the header').toBe(true);
      await win.keyboard.press('Tab');
      expect(await focusInsideModal(win), 'Tab escaped the modal through the header').toBe(true);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('the control says where the file will land IN WORDS, names the panel, and is one click target (SC-020, FR-068)', async () => {
  const tree = createDeepTree('throng-qot-words-');
  try {
    await runApp(async (_app, win) => {
      const pid = await editorWithProject(win, 'QOTargetWords', tree.root);

      /*
       * Give the panel the name a user would recognise it by — the file it holds.
       *
       * `panelDisplayTitle` is the single rule that decides a panel's name (#218), so asserting the
       * stem of the open file here is asserting the string the panel header itself shows. A name
       * derived any other way could agree today and drift tomorrow, which is the whole reason that
       * function exists.
       */
      await openQuickOpen(win);
      await win.keyboard.type('README');
      await chooseTheOnlyRow(win);
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        '// README.md',
        { timeout: 8000 },
      );

      await focusEditor(win, pid);
      await openQuickOpen(win);

      /*
       * SC-020 — WITHOUT hovering. Nothing in this test moves the pointer over the control before
       * this assertion, so a hover title cannot satisfy it: the sentence is either in the rendered
       * text or the requirement is unmet.
       */
      await expect(target(win)).toHaveAttribute('data-value', 'lastActive');
      await expect(target(win)).toContainText('Will open in the active editor (README)');

      /*
       * FR-068 — ONE click target: the icon and the words live inside a single `<button>`, not a
       * button beside a label. Asked of the DOM, because "they look adjacent" is exactly the shape
       * the requirement rejects.
       */
      const shape = await win.getByTestId('quickopen').evaluate((card) => {
        const btn = card.querySelector('[data-testid="quickopen-target"]');
        const label = card.querySelector('[data-testid="quickopen-target-label"]');
        return {
          tag: btn?.tagName ?? '(no control)',
          labelInsideButton: btn !== null && label !== null && btn.contains(label),
          hasThemeIcon: btn?.querySelector('.icon') != null,
          nestedButtons: btn?.querySelectorAll('button').length ?? -1,
        };
      });
      expect(shape).toEqual({
        tag: 'BUTTON',
        labelInsideButton: true,
        hasThemeIcon: true,
        nestedButtons: 0,
      });

      /*
       * The modal must not JUMP as the sentence changes length. `.picker` is a fixed-width card, so
       * the two strings resize the button and nothing else — asserted rather than assumed, because
       * a header control sized by its content is precisely how a dialog acquires a twitch.
       */
      const boxBefore = await win.getByTestId('quickopen').boundingBox();

      // …and clicking the WORDS operates it. This is the assertion the user's request is about:
      // an icon with a label beside it would pass every other check in this test and fail here.
      await win.getByTestId('quickopen-target-label').click();
      await expect(target(win)).toHaveAttribute('data-value', 'new');
      await expect(target(win)).toContainText('Will open in a new editor');
      await expect(target(win)).not.toContainText('active editor');
      expect(await win.getByTestId('quickopen').boundingBox()).toEqual(boxBefore);

      // It toggles back, and names the panel again — the name is read live, not captured on open.
      await win.getByTestId('quickopen-target-label').click();
      await expect(target(win)).toHaveAttribute('data-value', 'lastActive');
      await expect(target(win)).toContainText('Will open in the active editor (README)');

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('Shift+Tab reaches the control and Space changes its value without opening anything (AS-11b, T4, E5)', async () => {
  const tree = createDeepTree('throng-qot-space-');
  try {
    await runApp(async (_app, win) => {
      await editorWithProject(win, 'QOTargetSpace', tree.root);
      await openQuickOpen(win);

      // A row is HIGHLIGHTED throughout. "Space opened nothing" is a much weaker statement against
      // an empty list — there would be nothing for it to open even if it tried.
      await win.keyboard.type('README');
      await expect(quickOpenRows(win)).toHaveCount(1);
      const before = await editors(win).count();

      await win.keyboard.press('Shift+Tab');
      await expect(target(win)).toBeFocused();

      await win.keyboard.press('Space');
      await expect(target(win)).toHaveAttribute('data-value', 'new');
      await expect(win.getByTestId('quickopen')).toBeVisible(); // …opened nothing, closed nothing
      expect(await editors(win).count()).toBe(before);

      // …and it TOGGLES, rather than only ever moving one way.
      await win.keyboard.press('Space');
      await expect(target(win)).toHaveAttribute('data-value', 'lastActive');
      await expect(win.getByTestId('quickopen')).toBeVisible();
      expect(await editors(win).count()).toBe(before);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('Enter on the control changes its value and opens nothing; Enter in the list is the only thing that opens (AS-11c, E1, FR-010b)', async () => {
  const tree = createDeepTree('throng-qot-enter-');
  try {
    await runApp(async (_app, win) => {
      const pid = await editorWithProject(win, 'QOTargetEnter', tree.root);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');
      await openQuickOpen(win);

      await win.keyboard.type('README');
      await expect(quickOpenRows(win)).toHaveCount(1);
      const before = await editors(win).count();

      // E1 — Enter is claimed ONLY when the event target is the query input. From the control it
      // falls through to the control's own handler, which changes the value.
      await win.keyboard.press('Shift+Tab');
      await expect(target(win)).toBeFocused();
      await win.keyboard.press('Enter');
      await expect(target(win)).toHaveAttribute('data-value', 'new');
      await expect(win.getByTestId('quickopen')).toBeVisible();
      expect(await editors(win).count()).toBe(before);
      await expect(content).not.toContainText('// README.md');

      // …and back in the input, the same key opens the highlighted row. That is what makes the
      // assertion above about WHERE the key came from rather than about Enter being inert.
      await win.keyboard.press('Tab');
      await expect(win.getByTestId('quickopen-input')).toBeFocused();
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
      /*
       * SOME editor holds the file — deliberately not `.first()`.
       *
       * The Enter above was pressed with the control left on `new`, which is the whole point of the
       * assertion before it, so the file lands in a NEW editor panel and the first panel in DOM
       * order is the empty one this test started from. `.first()` therefore encoded an assumption
       * this test had itself just falsified. WHICH panel a target value produces is the subject of
       * the two T5 tests below, which assert it directly; what belongs here is only that Enter from
       * the input — and nothing else pressed along the way — opened the file at all.
       */
      await expect(editors(win).filter({ hasText: '// README.md' })).toHaveCount(1, {
        timeout: 8000,
      });
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('choosing "the currently active editor" performs the Last-Active-Editor route (T5, AS-11)', async () => {
  const tree = createDeepTree('throng-qot-last-');
  try {
    await runApp(async (_app, win) => {
      const pid = await editorWithProject(win, 'QOTargetLastActive', tree.root);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      await openQuickOpen(win);
      await win.keyboard.type('README');
      await chooseTheOnlyRow(win);
      await expect(content).toContainText('// README.md', { timeout: 8000 });
      await expect(editors(win)).toHaveCount(1);

      // Second open, control explicitly left on `lastActive`: the document is REPLACED in the same
      // panel — the route `openFileInTab(ws, tabId, absPath, 'lastActive')` already takes.
      await focusEditor(win, pid);
      await openQuickOpen(win);
      await expect(target(win)).toHaveAttribute('data-value', 'lastActive');
      await win.keyboard.type('deep-widget');
      await chooseTheOnlyRow(win);

      await expect(editors(win)).toHaveCount(1);
      await expect(content).toContainText('// src/app/components/widgets/deep-widget.ts', {
        timeout: 8000,
      });
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('choosing "a new editor panel in this tab" opens a new editor panel in the CURRENT tab (T5, FR-010)', async () => {
  const tree = createDeepTree('throng-qot-new-');
  try {
    await runApp(async (_app, win) => {
      const pid = await editorWithProject(win, 'QOTargetNewPanel', tree.root);
      const content = win.getByTestId(`editor-${pid}`).locator('.cm-content');

      await openQuickOpen(win);
      await win.keyboard.type('README');
      await chooseTheOnlyRow(win);
      await expect(content).toContainText('// README.md', { timeout: 8000 });
      await expect(editors(win)).toHaveCount(1);

      await focusEditor(win, pid);
      await openQuickOpen(win);
      await win.keyboard.type('deep-widget');
      await win.keyboard.press('Shift+Tab');
      await win.keyboard.press('Space');
      await expect(target(win)).toHaveAttribute('data-value', 'new');
      await win.keyboard.press('Tab');
      await expect(win.getByTestId('quickopen-input')).toBeFocused();
      await chooseTheOnlyRow(win);

      /*
       * A SECOND editor panel — and in THIS tab, which is what the option promises.
       *
       * Only the active tab's panels are rendered, so counting two on screen is the same statement
       * as "both are in the current tab"; a panel opened into another tab would leave this count at
       * one and the assertion would name the count, which is the visible symptom.
       */
      await expect(editors(win)).toHaveCount(2);
      await expect(content).toContainText('// README.md'); // …the original panel is untouched
      await expect(
        editors(win).filter({ hasText: '// src/app/components/widgets/deep-widget.ts' }),
      ).toHaveCount(1);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * The one-buffer rule holds on the `new` target too — FR-008, FR-011a, AS-9
 *
 * Reported from hand-testing: with the control on "a new editor panel", choosing a file that was
 * ALREADY open produced a SECOND editor on the same file. FR-008 requires Quick Open to route
 * through the shipped open-file path "inheriting every check it makes", and the one-buffer rule is
 * the first of those checks; AS-9 states the outcome directly. The `lastActive` target was correct
 * throughout, which is what localises the defect: only the `new` branch skipped the gate.
 *
 * Both tests assert a COUNT, never a presence. The defect is a second copy, and "an editor holds
 * README" is true of the broken build as well as the fixed one.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

test('with the control on "a new editor panel", a file already open in this tab is activated, not copied (FR-008, FR-011a, AS-9)', async () => {
  const tree = createDeepTree('throng-qot-onebuf-');
  try {
    await runApp(async (_app, win) => {
      // Editor A holds README.md.
      const a = await editorWithProject(win, 'QOTargetOneBuffer', tree.root);
      await openQuickOpen(win);
      await win.keyboard.type('README');
      await chooseTheOnlyRow(win);
      await expect(win.getByTestId(`editor-${a}`).locator('.cm-content')).toContainText(
        '// README.md',
        { timeout: 8000 },
      );

      /*
       * Editor B holds something else and is where the chord comes from.
       *
       * Two panels, not one: with a single editor on screen "no second copy" and "the file's editor
       * is focused" are both satisfied by a tab that has nowhere else for focus to be, and neither
       * assertion would then say anything. B is also what makes this the user's gesture — they were
       * in one editor and asked for a file that lives in another.
       */
      const b = await addEditorPanel(win, a);
      await focusEditor(win, b);
      await openQuickOpen(win);
      await win.keyboard.type('deep-widget');
      await chooseTheOnlyRow(win);
      await expect(win.getByTestId(`editor-${b}`).locator('.cm-content')).toContainText(
        '// src/app/components/widgets/deep-widget.ts',
        { timeout: 8000 },
      );
      await expect(editors(win)).toHaveCount(2);

      // From B, ask for README.md — open in A — with the control on "a new editor panel".
      await focusEditor(win, b);
      await openQuickOpen(win);
      await win.keyboard.type('README');
      await expect(quickOpenRows(win)).toHaveCount(1);
      await chooseNewEditorTarget(win);
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);

      // No third panel, exactly one editor holds the file, B keeps its own document…
      await expect(editors(win)).toHaveCount(2);
      await expect(editors(win).filter({ hasText: '// README.md' })).toHaveCount(1);
      await expect(win.getByTestId(`editor-${b}`).locator('.cm-content')).toContainText(
        '// src/app/components/widgets/deep-widget.ts',
      );
      // …and A — the editor that already held it — is the one that ends up with the caret.
      await expect(win.getByTestId(`editor-${a}`).locator('.cm-editor.cm-focused')).toBeVisible({
        timeout: 8000,
      });
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('with the control on "a new editor panel", a file open in ANOTHER tab activates that tab’s editor (FR-011a)', async () => {
  const tree = createDeepTree('throng-qot-onebuf-tab-');
  try {
    await runApp(async (_app, win) => {
      // Tab 1: editor A holds README.md.
      const a = await editorWithProject(win, 'QOTargetOneBufferTab', tree.root);
      await openQuickOpen(win);
      await win.keyboard.type('README');
      await chooseTheOnlyRow(win);
      await expect(win.getByTestId(`editor-${a}`).locator('.cm-content')).toContainText(
        '// README.md',
        { timeout: 8000 },
      );
      const tabsBefore = await win.locator('.tab-chip').count();

      // Tab 2, with its own editor — `tab-add` creates AND switches, and opens the chip in rename
      // mode, which would otherwise swallow every key below.
      await win.getByTestId('tab-add').click();
      await expect(win.locator('.tab-chip')).toHaveCount(tabsBefore + 1);
      await commitTabRename(win);
      const c = await firstPanelId(win);
      await win.getByTestId(`panel-type-select-${c}`).selectOption('editor');
      await win.getByTestId(`panel-type-confirm-${c}`).click();
      await expect(win.getByTestId(`editor-${c}`)).toBeVisible();
      await focusEditor(win, c);
      // Only the active tab renders, so A is off screen and this tab holds exactly one editor.
      await expect(editors(win)).toHaveCount(1);
      await expect(win.getByTestId(`editor-${a}`)).toHaveCount(0);

      // From tab 2, ask for README.md — open in tab 1 — with the control on "a new editor panel".
      await openQuickOpen(win);
      await win.keyboard.type('README');
      await expect(quickOpenRows(win)).toHaveCount(1);
      await chooseNewEditorTarget(win);
      await win.keyboard.press('Enter');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);

      /*
       * Tab 1 comes forward and its editor is the one holding the file.
       *
       * `editor-A` being on screen IS the tab switch — a panel renders only in the active tab — and
       * it is the assertion the count alone cannot make: the broken build leaves tab 2 active with a
       * brand-new editor on README.md in it, which is also a count of one.
       */
      await expect(win.getByTestId(`editor-${a}`)).toBeVisible({ timeout: 8000 });
      await expect(win.getByTestId(`editor-${a}`).locator('.cm-content')).toContainText(
        '// README.md',
      );
      await expect(editors(win)).toHaveCount(1);
      await expect(win.locator('.tab-chip')).toHaveCount(tabsBefore + 1); // …no tab was added either
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('with "Open files in" set to New Editor the control opens preselected on the new-panel option (T2)', async () => {
  const tree = createDeepTree('throng-qot-pre-');
  const cfg = mkdtempSync(join(tmpdir(), 'throng-qot-cfg-'));
  writeFileSync(
    join(cfg, 'settings.json'),
    JSON.stringify({ editor: { openTarget: 'new' } }, null, 2),
  );
  try {
    // Its OWN app: the setting is read at launch, so it must be on disk before the window exists.
    await runOwnApp(
      async (_app, win) => {
        await settle(win);
        await newProject(win, 'QOTargetPreselect', tree.root);
        const pid = await firstPanelId(win);
        await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
        await win.getByTestId(`panel-type-confirm-${pid}`).click();
        await expect(win.getByTestId(`editor-${pid}`)).toBeVisible();
        await focusEditor(win, pid);

        await openQuickOpen(win);
        await expect(target(win)).toHaveAttribute('data-value', 'new');

        await win.keyboard.press('Escape');
        await expect(win.getByTestId('quickopen')).toHaveCount(0);
      },
      { env: { THRONG_CONFIG_ROOT: cfg } },
    );
  } finally {
    cleanupDeepTree(tree);
    cleanupTemp(cfg);
  }
});

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

/** Hide `relPath` through the route the user has — the tree's own context menu (004). */
async function hideInProject(win: Page, folder: string, name: string): Promise<void> {
  const tree = win.getByTestId('file-explorer-tree');
  await tree.getByTestId(`tree-twisty-${folder}`).click();
  await expect(tree.getByText(name, { exact: true })).toBeVisible();
  await tree.getByText(name, { exact: true }).click({ button: 'right' });
  await win.locator('.context-menu__item', { hasText: 'Hide in this project' }).click();
  // The tree dropping the row is the acknowledgement that the daemon write landed. Waiting on it
  // rather than on a duration is what stops the assertions below racing the round trip.
  await expect(tree.getByText(name, { exact: true })).toHaveCount(0);
}

test('at the shipped default NEITHER mechanism’s files are candidates, and the toggle brings both back (SC-018, SC-022, FR-069c)', async () => {
  const tree = createDeepTree('throng-qot-hidden-');
  try {
    await runApp(async (_app, win) => {
      const pid = await editorWithProject(win, 'QOToggleBoth', tree.root);
      await hideInProject(win, 'src', 'hidden-in-project.txt');
      await focusEditor(win, pid);

      await openQuickOpen(win);
      // FR-069b — the shipped setting is "exclude", so the modal opens excluding.
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'exclude');

      /*
       * The two halves, asserted INDEPENDENTLY and by positive queries with exact expected results.
       *
       * `quarantined` is carried only by files under `.git` and `node_modules`, both of which the
       * shipped globs hide (FR-070). `hidden-in-project` is carried only by the file just hidden
       * through the tree, which no glob touches. Neither can carry the other.
       */
      await win.getByTestId('quickopen-input').fill(DEEP_TREE.excludedQuery);
      await expect(quickOpenRows(win), 'the glob half of SC-018').toHaveCount(0);
      await win.getByTestId('quickopen-input').fill(DEEP_TREE.hidable.query);
      await expect(quickOpenRows(win), 'SC-022 — the hidden-set half').toHaveCount(0);

      // Flip it. "Show hidden" means EVERYTHING the project hides — one rule set, not two (FR-069c).
      await hiddenToggle(win).click();
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'include');

      await expect(quickOpenRows(win)).toHaveCount(1);
      expect(await quickOpenRowPaths(win)).toEqual([DEEP_TREE.hidable.path]);
      await win.getByTestId('quickopen-input').fill(DEEP_TREE.excludedQuery);
      await expect(quickOpenRows(win)).toHaveCount(2);
      expect((await quickOpenRowPaths(win)).sort()).toEqual([
        '.git/quarantined-object.txt',
        'node_modules/quarantined-pkg/quarantined-module.ts',
      ]);

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);

      // FR-069b — the setting decides where every modal STARTS, so the next one starts excluding
      // again. The toggle changed this invocation, not the preference.
      await focusEditor(win, pid);
      await openQuickOpen(win);
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'exclude');
      await win.getByTestId('quickopen-input').fill(DEEP_TREE.hidable.query);
      await expect(quickOpenRows(win)).toHaveCount(0);
      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('the toggle is the target button’s sibling in the header, and is drawn even when the target button is not (FR-069)', async () => {
  const tree = createDeepTree('throng-qot-sibling-');
  try {
    await runApp(async (_app, win) => {
      const pid = await editorWithProject(win, 'QOToggleSibling', tree.root);
      await openQuickOpen(win);

      // Both controls, in ONE header row — "drawn as its sibling", asked of the DOM rather than of
      // a screenshot.
      await expect(target(win)).toBeVisible();
      await expect(hiddenToggle(win)).toBeVisible();
      const sharedHeader = await win.getByTestId('quickopen').evaluate((card) => {
        const a = card.querySelector('[data-testid="quickopen-target"]')?.closest('.picker__header');
        const b = card.querySelector('[data-testid="quickopen-hidden"]')?.closest('.picker__header');
        return a !== null && a === b;
      });
      expect(sharedHeader, 'the two header controls are not siblings in one .picker__header').toBe(
        true,
      );

      // A themeable icon control carrying a hover title that names both the state and the action.
      const title = (await hiddenToggle(win).getAttribute('title')) ?? '';
      expect(title, 'the toggle has no hover title').not.toBe('');

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);

      /*
       * FR-011 draws the target control only from inside an editor; FR-069 draws the toggle ALWAYS.
       *
       * The header used to be built as a whole only when the modal was invoked from an editor, so a
       * toggle rendered inside it would silently vanish for every invocation from the tree or a
       * terminal — which is most of them.
       */
      await win.getByTestId('file-explorer-tree').getByText('README.md', { exact: true }).click();
      await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText(
        '// README.md',
        { timeout: 8000 },
      );
      await openQuickOpen(win);
      await expect(target(win), 'FR-011 — not invoked from an editor').toHaveCount(0);
      await expect(hiddenToggle(win), 'FR-069 — the toggle is drawn regardless').toBeVisible();
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'exclude');

      await win.keyboard.press('Escape');
      await expect(win.getByTestId('quickopen')).toHaveCount(0);
    });
  } finally {
    cleanupDeepTree(tree);
  }
});

test('flipping the toggle to SHOW excluded files never empties the list mid-flight (FR-069d)', async () => {
  const tree = createDeepTree('throng-qot-noflash-');
  try {
    await runApp(async (_app, win) => {
      const pid = await editorWithProject(win, 'QOToggleNoFlash', tree.root);
      await focusEditor(win, pid);
      await openQuickOpen(win);

      /*
       * A query that matches whether or not hidden files are included, so the list has rows on BOTH
       * sides of the flip. Without that the assertion below could not tell "blanked while the wider
       * walk runs" from "this query legitimately matches nothing yet".
       */
      await win.getByTestId('quickopen-input').fill(DEEP_TREE.ranking.query);
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'exclude');
      const before = await quickOpenRows(win).count();
      expect(before, 'the query matched nothing before the flip — the fixture is wrong').toBeGreaterThan(0);

      await hiddenToggle(win).click();

      /*
       * ══ WHY THIS ASSERTION IS SHAPED LIKE THIS ══
       *
       * Waiting for `data-value` to change is not decoration: it proves React has COMMITTED the
       * render that the flip caused. Only then is `count()` — which does NOT retry, and so samples
       * the DOM as it is right now — asking a meaningful question.
       *
       * Sampling immediately after the click instead would read the pre-flip DOM and pass against a
       * broken build, which is the failure mode this whole feature has been repeatedly bitten by: a
       * guard that cannot fail. Against the defect this test was written for, the count here is 0,
       * because the modal switches from the standing subscription to a second one that has never
       * held any paths, and the user sees the list blink empty before the wider set arrives.
       *
       * ══ THIS IS ONE HALF OF FR-069d, AND THE OTHER HALF IS NOT HERE ══
       *
       * Rows surviving the flip means the previous, NARROWER list is being borrowed while the wider
       * index builds — and a narrower list served with nothing said is the very thing FR-069d
       * forbids. What makes the borrow legitimate is the "still listing" line standing over it, and
       * that pairing is asserted on the 12,000-file fixture in `quick-open-perf.e2e.ts`, where the
       * walk is long enough to sample. This tree is small enough that the wider walk can finish
       * inside a frame, so an assertion here on the line being up would be a race, not a guard.
       */
      await expect(hiddenToggle(win)).toHaveAttribute('data-value', 'include');
      const during = await quickOpenRows(win).count();
      expect(
        during,
        'the list emptied the moment the toggle flipped — that blink is the reported flash',
      ).toBeGreaterThan(0);

      // And it still converges on the wider set, so "no flash" was not bought by never updating.
      await expect(quickOpenRows(win)).toHaveCount(before, { timeout: 10_000 });

      // The borrow is TEMPORARY. A "still listing" line left standing over a settled list would be
      // the mirror-image defect — a permanent caveat on an answer that is complete.
      await expect(win.getByTestId('quickopen-building')).toHaveCount(0);

      await win.keyboard.press('Escape');
    });
  } finally {
    cleanupDeepTree(tree);
  }
});
