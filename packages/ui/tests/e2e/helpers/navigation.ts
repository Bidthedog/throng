/**
 * 033 — opening the two navigation modals, and reading Quick Open's list (#219).
 *
 * Five specs drive Quick Open and Go To Line, and every one of them needs the same three things:
 * press the chord, wait for the modal to be usable, and address the rows. Doing that once here is
 * what stops each spec inventing its own selectors — the cost 031 measured when the tab strip was
 * restructured and twenty spec edits paid for one change.
 *
 * ══ THE TEST IDS ARE FIXED BY CONTRACT, NOT CHOSEN HERE ══
 *
 * `contracts/picker-extensions.md` §5 fixes Quick Open's picker `testId` at `quickopen` — one word,
 * matching `tabpicker`'s precedent and leaving `[data-testid^="quick-"]` free for anything else. The
 * shipped `Picker` (`packages/ui/src/renderer/common/picker.tsx`) DERIVES the rest from that prefix
 * and this file must derive them the same way, because the component is the authority:
 *
 *   quickopen            the dialog card              quickopen-list       the listbox
 *   quickopen-overlay    the scrim                    quickopen-row-<id>   one row, id = the path
 *   quickopen-input      the query field              quickopen-empty      "No files match"
 *   quickopen-truncated  the FR-014 count line (P4), the one id the picker does not have today
 *
 * Go To Line is not a picker, but §5's convention still governs its prefix (`gotoline`), so its
 * field is `gotoline-input` by the same derivation.
 *
 * ══ WHAT THE HELPERS WAIT ON ══
 *
 * Every wait here is a CONDITION — the dialog is on screen, the input holds focus, the row exists.
 * None of them is a duration. A `waitForTimeout` would be a claim that some number of milliseconds
 * is always enough, and it stops being true on the first loaded CI runner (#244 is the live case of
 * a guard that only looked like one).
 *
 * Note what is deliberately NOT waited for: rows. Quick Open opens while the file index is still
 * being built (FR-015 / S3), and a helper that waited for a row would make the "still listing" state
 * untestable and would hang against an empty project.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The shipped default chords (data-model.md §2). Named rather than repeated, so the rebinding specs
 * (SC-012) can talk about "the default chord" and "some other chord" without either of them being a
 * literal buried in five files.
 */
export const QUICK_OPEN_CHORD = 'Control+Shift+T';
export const GOTO_LINE_CHORD = 'Control+G';

/**
 * Open Quick Open with its chord, from wherever focus currently is.
 *
 * The chord is dispatched by the WINDOW-level capture listener (A1), so this works with a terminal,
 * an editor or the tree focused — which is the whole of FR-003, and the reason no helper here takes
 * a "from" argument.
 */
export async function openQuickOpen(win: Page): Promise<void> {
  await win.keyboard.press(QUICK_OPEN_CHORD);
  await expectQuickOpenReady(win);
}

/**
 * Open Quick Open from the Files & Folders toolbar button (V1).
 *
 * Located by its ACCESSIBLE NAME, exactly as `explorer.e2e.ts` already addresses Expand and Collapse
 * all. That is not a stylistic match: V3 requires the button's `title` to carry the command's live
 * chord, so the title changes when the binding changes and a title-based locator would break on a
 * rebind. The `aria-label` is the stable half, and this helper is where the requirement that it read
 * exactly `Quick Open` is written down.
 */
export async function openQuickOpenFromToolbar(win: Page): Promise<void> {
  await quickOpenToolbarButton(win).click();
  await expectQuickOpenReady(win);
}

/**
 * The toolbar button itself.
 *
 * Exported because V4 is about the button rather than the modal — with no project open it must be
 * DRAWN AND DISABLED, not hidden — and that spec needs the same locator this file already owns.
 */
export function quickOpenToolbarButton(win: Page): Locator {
  return win.getByTestId('explorer-toolbar').getByRole('button', { name: 'Quick Open' });
}

/**
 * Quick Open's rows, in the order it is rendering them.
 *
 * A `Locator` rather than an array of strings, deliberately: a Locator re-queries on every use, so
 * `expect(quickOpenRows(win)).toHaveCount(n)` waits for the list to settle while a snapshot taken
 * one line after a keystroke merely records a race. Rank assertions (K1–K3) read the ids off it with
 * {@link quickOpenRowPaths} once the count is known.
 */
export function quickOpenRows(win: Page): Locator {
  return win.locator('[data-testid^="quickopen-row-"]');
}

/**
 * The rows' root-relative paths, in rendered order — the id half of `quickopen-row-<id>`, which §5
 * fixes as the path itself.
 *
 * A snapshot, so take it only after the list has been waited for (`toHaveCount`, or the row locator
 * used in an auto-waiting assertion).
 */
export async function quickOpenRowPaths(win: Page): Promise<string[]> {
  return quickOpenRows(win).evaluateAll((rows) =>
    rows.map((row) => (row.getAttribute('data-testid') ?? '').replace('quickopen-row-', '')),
  );
}

/**
 * Choose the `i`-th row and return the path it carried.
 *
 * Waiting for the row to be visible first is the point of the helper. A blind click on `nth(i)` of a
 * list that has not rendered yet resolves against nothing and fails on the CLICK, which reads as a
 * missing control rather than as a list that was still building — an hour spent in the wrong file.
 *
 * The modal is expected to be gone afterwards (Q5: choosing opens the file and the modal has no
 * further job), so the wait for it to detach belongs here rather than in every caller. If it lingers
 * the failure names the modal, which is exactly the defect.
 */
export async function chooseQuickOpenRow(win: Page, i: number): Promise<string> {
  const row = quickOpenRows(win).nth(i);
  await expect(row, `Quick Open never rendered a row at index ${i}`).toBeVisible();
  const path = ((await row.getAttribute('data-testid')) ?? '').replace('quickopen-row-', '');
  await row.click();
  await expect(win.getByTestId('quickopen'), 'Quick Open stayed open after a choice').toHaveCount(0);
  return path;
}

/**
 * Open Go To Line with its chord.
 *
 * `navigate.gotoLine` is EDITOR_ONLY (A2), so the caller must have an editor panel active — with a
 * terminal focused the chord is not claimed at all and `^G` goes to the shell (A3), which is a
 * different spec's subject and not something this helper can paper over.
 */
export async function openGotoLine(win: Page): Promise<void> {
  await win.keyboard.press(GOTO_LINE_CHORD);
  await expect(win.getByTestId('gotoline')).toBeVisible();
  await expect(win.getByTestId('gotoline-input')).toBeFocused();
}

/**
 * The modal is on screen AND the query field has focus (S3, P8).
 *
 * Both halves matter. `toBeVisible` alone passes a frame before `autoFocus` has been applied, and
 * the first keystroke of a spec that typed straight after would land on whatever held focus before
 * the modal — typically inserting a character into the editor underneath, after which the test dies
 * on an assertion naming Quick Open. That failure is a lie about where the defect is.
 */
async function expectQuickOpenReady(win: Page): Promise<void> {
  await expect(win.getByTestId('quickopen')).toBeVisible();
  await expect(win.getByTestId('quickopen-input')).toBeFocused();
}
