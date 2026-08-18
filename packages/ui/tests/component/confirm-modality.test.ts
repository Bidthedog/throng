/**
 * A confirmation dialog is actually MODAL (018 US6 follow-up).
 *
 * PLACE AT: `packages/ui/tests/component/confirm-modality.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/confirm-modality.e2e.ts` — its single test, and with it the
 * whole file and its `runApp` launch (034 FR-045).
 *
 * ══ WHY THIS COMES DOWN, GIVEN THAT FOCUS IS NORMALLY AN E2E RESERVE ══
 *
 * Principle V reserves *focus and z-order* for E2E, and rightly: a claim about which of two WINDOWS
 * holds the caret, or about an OS-level focus steal, has no meaning in jsdom. This is neither. It is
 * one document, one dialog, no second window and no z-order — `ConfirmProvider` plus `useFocusTrap`,
 * both of which are ordinary DOM code reading `document.activeElement` and calling `.focus()`. The
 * precedent is `packages/ui/tests/component/menu-keyboard.test.ts`, which asserts roving focus on a
 * rendered menu, per keystroke, at this layer.
 *
 * The E2E spent an Electron launch, a daemon, a real temp folder and a real project in order to
 * right-click a file and reach a dialog — so that it could press Tab six times.
 *
 * ══ WHAT DID NOT COME WITH IT, AND WHERE IT ALREADY LIVES ══
 *
 * The migrated test also asserted two things that are not modality at all: that the Files & Folders
 * Delete action raises this dialog, and that cancelling leaves the file on disk. Both are covered by
 * `packages/ui/tests/e2e/explorer.e2e.ts:413` ("delete confirmation can be cancelled; the toolbar
 * Delete button works"), which right-clicks `a.txt`, clicks Delete, asserts `confirm-dialog` is
 * visible, clicks `confirm-cancel` and then asserts the row is still there. That is the same claim,
 * in a test that stays. 034 FR-047: every assertion of a deleted test is accounted for.
 *
 * ══ IT LANDS STRONGER THAN THE E2E DID, IN TWO PLACES ══
 *
 *   - The E2E asked only "is focus SOMEWHERE inside the dialog" after each Tab. A trap that pinned
 *     focus to one button and never moved satisfies that perfectly — and, as the stub note below
 *     explains, that is exactly the degenerate behaviour a missing stub produces here. So the CYCLE
 *     is asserted: cancel → accept → cancel, and back the other way.
 *   - The `focusin` guard — a background component calling `focus()` while the question is on screen
 *     — is asserted for the first time at any layer. The E2E never provoked one.
 *
 * ══ THE STUB, AND WHY IT IS LOAD-BEARING RATHER THAN CONVENIENT ══
 *
 * `focus-trap.ts:70` filters its focusable set on `el.offsetParent !== null` (a display:none guard).
 * **jsdom's `offsetParent` getter returns `null` unconditionally** — see
 * `node_modules/jsdom/lib/jsdom/living/nodes/HTMLElement-impl.js:184` — so without a stub the set
 * collapses to whichever single element is `document.activeElement`, every Tab is treated as "at the
 * end", and focus is pinned to one button forever. The weak assertions would still pass. The stub
 * makes the filter say what it says in a real browser for a document where nothing is hidden, and
 * nothing more; it is the same class of thing as `file-tree.test.ts`'s `ResizeObserver`, for the same
 * reason — jsdom has no layout, so there is no real behaviour being simplified.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - Anything about how the scrim or the dialog LOOKS — `.modal-overlay`'s dimming, the dialog's
 *     elevation over the application. jsdom applies no stylesheet (034 FR-049).
 *   - A focus steal from ANOTHER WINDOW, or from the OS. The guard here is `document`-scoped.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `packages/ui/src/renderer/confirm-dialog.tsx`, change `{pending ? (` to `{pending && false ? (`.
 * The provider then never renders the dialog. **ALL SEVEN tests in this file fail**, every one of
 * them inside the shared `open()` helper, which awaits `confirm-dialog` before a test body begins.
 * Nothing here can pass against a document with no dialog in it.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState, type ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm } from '../../src/renderer/confirm-dialog.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * The stubbed visibility test — see the header note. Restored exactly.
 * ────────────────────────────────────────────────────────────────────────── */

let realOffsetParent: PropertyDescriptor | undefined;

beforeAll(() => {
  realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    // "Rendered, and not inside a display:none subtree" — which, in a jsdom document that hides
    // nothing, is true of every attached element. `null` for a detached one, exactly as a browser.
    get(this: HTMLElement): Element | null {
      return this.parentElement;
    },
  });
});

afterAll(() => {
  // Put jsdom's own getter back rather than deleting the property: a neighbouring file that later
  // reads `offsetParent` must see jsdom's answer, not this file's opinion of it.
  if (realOffsetParent) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  }
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The application behind the dialog
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Three focusable controls and a place to write the answer down.
 *
 * The two `behind-*` buttons are the point of the fixture: they are the "live application" the
 * migrated test's own header says a user could Tab straight into and press Enter on. They sit BEFORE
 * and AFTER the trigger in document order, so a leak in either direction has somewhere to land — a
 * trap tested against an empty document proves nothing, because there is nowhere to leak TO.
 */
function Host(): ReactElement {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState('unanswered');
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', 'data-testid': 'behind-first' }, 'Behind first'),
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'ask',
        onClick: () => {
          void confirm({
            title: 'Delete file',
            message: 'Delete “doomed.txt”?',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            danger: true,
          }).then((ok) => setAnswer(ok ? 'accepted' : 'refused'));
        },
      },
      'Ask',
    ),
    createElement('button', { type: 'button', 'data-testid': 'behind-last' }, 'Behind last'),
    createElement('span', { 'data-testid': 'answer' }, answer),
  );
}

/** Mount the application, raise the delete confirmation, and settle on it being on screen. */
async function open(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(createElement(ConfirmProvider, null, createElement(Host, null)));
  await user.click(screen.getByTestId('ask'));
  // Waiting for the dialog rather than assuming it: this is the assertion the anti-vacuity control
  // above trips, and it guards every test in the file.
  expect(await screen.findByTestId('confirm-dialog')).toBeVisible();
  return user;
}

/**
 * What holds the keyboard, by test id.
 *
 * Named rather than boolean, because "focus is inside the dialog" was the migrated test's whole
 * vocabulary and it is too coarse: it cannot tell a cycling trap from a stuck one.
 */
const focused = (): string =>
  document.activeElement?.getAttribute('data-testid') ??
  document.activeElement?.tagName.toLowerCase() ??
  'nothing';

const insideDialog = (): boolean =>
  document.activeElement?.closest('[data-testid="confirm-dialog"]') != null;

describe('the keyboard stays in the dialog (018 US6 follow-up)', () => {
  it('focus is inside the dialog the moment it opens', async () => {
    /*
     * The precondition everything else rests on. A dialog whose caret is still out in the
     * application has not opened modally at all — the first Tab would move within THAT and never
     * reach the trap's handler, so every wrap assertion below would be about the wrong element.
     */
    await open();

    expect(focused()).toBe('confirm-accept');
    expect(insideDialog()).toBe(true);
  });

  it('Tab cycles between the dialog’s own buttons and never reaches the application behind it', async () => {
    const user = await open();

    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await user.tab();
      seen.push(focused());
      expect(insideDialog(), `Tab #${i + 1} left the dialog — focus on ${focused()}`).toBe(true);
    }

    /*
     * More presses than the dialog has controls, exactly as the migrated test reasoned — but the
     * SEQUENCE is asserted, not merely containment. `confirm-accept` autofocuses, so the first Tab
     * is at the end of the set and wraps to `confirm-cancel`; the second is an ordinary move
     * forward. A trap that pinned focus to one button satisfies "still inside" six times over and
     * fails here on the first entry.
     */
    expect(seen).toEqual([
      'confirm-cancel',
      'confirm-accept',
      'confirm-cancel',
      'confirm-accept',
      'confirm-cancel',
      'confirm-accept',
    ]);
  });

  it('Shift+Tab cycles the other way, and wraps at the other end', async () => {
    const user = await open();

    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true });
      seen.push(focused());
      expect(insideDialog(), `Shift+Tab #${i + 1} left the dialog — focus on ${focused()}`).toBe(
        true,
      );
    }

    // Backwards from `confirm-accept` is an ordinary move; backwards from `confirm-cancel` is the
    // start of the set and wraps to the end. The two directions have separate branches in
    // `focus-trap.ts`, which is why both are driven.
    expect(seen).toEqual(['confirm-cancel', 'confirm-accept', 'confirm-cancel', 'confirm-accept']);
  });

  it('a background control that grabs focus mid-decision is put straight back', async () => {
    /*
     * The `focusin` guard, asserted for the first time at any layer. Tab is not the only way focus
     * moves: a terminal attaching, an editor mounting or a background `select()` calls `.focus()`
     * directly, and none of those goes through the Tab handler. The migrated test never provoked
     * one, so this half of the mechanism has been live and unproved since 018.
     *
     * `act()` because the guard's re-focus lands during the event dispatch — trap 3 on this branch:
     * without it, assertions on rendered feedback and assertions on a spy disagree.
     */
    await open();

    act(() => {
      screen.getByTestId('behind-first').focus();
    });

    expect(insideDialog(), `a background button kept the keyboard — focus on ${focused()}`).toBe(
      true,
    );
  });
});

describe('only the dialog’s own controls end it (FR-048a)', () => {
  it('clicking the scrim beside the dialog answers nothing and takes no focus', async () => {
    /*
     * "A click beside the dialog answered the question by dismissing it" is the defect the migrated
     * file was filed for. Both halves are asserted, because the scrim's handler does two things: it
     * declines to close, AND it suppresses the default on its own mousedown so the click cannot even
     * blur the button the user was resting on.
     */
    const user = await open();

    await user.click(screen.getByTestId('confirm-overlay'));

    expect(screen.getByTestId('confirm-dialog')).toBeVisible();
    expect(insideDialog(), `the scrim took the keyboard — focus on ${focused()}`).toBe(true);
    expect(screen.getByTestId('answer')).toHaveTextContent('unanswered');
  });

  it('Cancel is a button, and buttons still end it', async () => {
    const user = await open();

    await user.click(screen.getByTestId('confirm-cancel'));

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    // The promise settled, and settled to the safe answer — a dialog that merely VANISHED would
    // leave its `await` hanging forever, which is the failure mode `choose()`'s own comment records.
    await waitFor(() => expect(screen.getByTestId('answer')).toHaveTextContent('refused'));
  });

  it('Escape ends it too — deliberately — and answers no', async () => {
    // The one keyboard exit the model allows, and the one a screen-reader user is told to press.
    // Asserted here so "only its buttons or Escape end it" is a complete statement rather than half
    // of one.
    const user = await open();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('answer')).toHaveTextContent('refused'));
  });
});
