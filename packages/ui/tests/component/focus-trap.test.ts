import { render, screen, fireEvent } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useFocusTrap } from '../../src/renderer/common/focus-trap.js';

/**
 * The modal focus trap — the keyboard stays inside the dialog (018 US6 follow-up, 033 FR-071/072).
 *
 * PLACE AT: `packages/ui/tests/component/focus-trap.test.ts`
 * NEW COVERAGE (035). `focus-trap.ts` has five dependents and had no test at any layer.
 *
 * ══ WHY IT MATTERS MORE THAN ITS SIZE SUGGESTS ══
 *
 * `aria-modal="true"` is a promise to assistive technology, not an implementation — the browser
 * still tabs happily out of a dialog and into the application behind it. Without this hook, a user
 * answering *"delete this file?"* can Tab onto the file tree, a terminal, the tab strip, and press
 * Enter on one of them while the destructive question sits unanswered. The dialog looks modal and
 * behaves like a panel.
 *
 * The module's comments record two bugs it has already been through, and both are asserted below
 * because a comment is not a test:
 *
 *   - **The roving-tabindex listbox.** The language picker draws every option as a `<button>` with
 *     `tabindex="-1"` except the active one. Counting those made the trap believe the last option
 *     was somewhere in the middle, so Tab at the true end was not recognised as the end, focus left
 *     the region, and the `focusin` guard hauled it back — leaving **Tab looking like it did
 *     nothing at all**.
 *   - **Two dialogs arm-wrestling (#219).** When one transient overlay replaces another, React
 *     mounts the newcomer before tearing the incumbent down. Left to fight, the outgoing dialog
 *     drags the caret back into itself and is then removed from the document, so focus lands on
 *     `<body>` and the next keystroke goes nowhere. Measured across three overlays in any order.
 *
 * ══ THE ONE ACCOMMODATION THIS HARNESS MAKES, AND WHY IT IS NOT A CHEAT ══
 *
 * `focusables()` filters on `el.offsetParent !== null` to skip elements hidden by `display:none` or
 * a hidden ancestor. **jsdom has no layout engine, so `offsetParent` is `null` for everything** —
 * left alone, the filter would return at most the currently-focused element and every assertion
 * here would pass or fail for reasons that have nothing to do with the trap.
 *
 * So `offsetParent` is defined below to report visibility the way a browser would, from the inline
 * `display` style. That is a stand-in for layout, and it is the honest kind: the hook's real
 * question is "is this element visible", and the stub answers exactly that question by a different
 * route. The hidden-element test below exists to prove the stub is actually consulted — without it,
 * every test here would still pass on a stub that always said "visible", and the visibility filter
 * would be untested.
 */
let restoreOffsetParent: (() => void) | undefined;

beforeAll(() => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement): HTMLElement | null {
      // Visible unless this element or an ancestor is explicitly display:none.
      let node: HTMLElement | null = this as HTMLElement;
      while (node) {
        if (node.style.display === 'none') return null;
        node = node.parentElement;
      }
      return (this as HTMLElement).parentElement;
    },
  });
  restoreOffsetParent = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  };
});

afterAll(() => restoreOffsetParent?.());

/** A dialog with three buttons, plus whatever extra children a test wants. */
function Dialog({
  active = true,
  children,
}: {
  active?: boolean;
  children?: ReactElement | ReactElement[];
}): ReactElement {
  const trap = useFocusTrap<HTMLDivElement>(active);
  return createElement(
    'div',
    {
      ref: trap.ref,
      onKeyDown: trap.onKeyDown,
      tabIndex: -1,
      role: 'dialog',
      'aria-modal': 'true',
      'data-testid': 'dialog',
    },
    children ?? [
      createElement('button', { key: 'a', 'data-testid': 'first' }, 'First'),
      createElement('button', { key: 'b', 'data-testid': 'middle' }, 'Middle'),
      createElement('button', { key: 'c', 'data-testid': 'last' }, 'Last'),
    ],
  );
}

/** Something focusable OUTSIDE the dialog — the application the dialog is meant to be blocking. */
function Outside(): ReactElement {
  return createElement('button', { 'data-testid': 'outside' }, 'Application behind');
}

const focused = (): string | undefined =>
  (document.activeElement as HTMLElement | null)?.dataset.testid;

const tab = (shift = false): void => {
  fireEvent.keyDown(screen.getByTestId('dialog'), { key: 'Tab', shiftKey: shift });
};

describe('Tab stays inside the dialog', () => {
  it('takes the keyboard when it opens, rather than leaving it in the application behind', () => {
    render(createElement('div', null, createElement(Outside), createElement(Dialog)));
    // A dialog whose caret is still outside has not opened modally at all — the first Tab would
    // move within the application, never reaching the guard.
    expect(focused()).toBe('first');
  });

  it('wraps from the last control back to the first', () => {
    render(createElement(Dialog));
    screen.getByTestId('last').focus();

    tab();

    expect(focused()).toBe('first');
  });

  it('wraps backwards from the first control to the last', () => {
    render(createElement(Dialog));
    screen.getByTestId('first').focus();

    tab(true);

    expect(focused()).toBe('last');
  });

  it('leaves Tab alone in the middle of the dialog', () => {
    // The trap must intervene only at the ends. Preventing every Tab would break ordinary
    // navigation between the dialog's own controls.
    render(createElement(Dialog));
    screen.getByTestId('middle').focus();

    tab();

    // The browser moves focus itself; the hook must not have redirected it to `first`.
    expect(focused()).toBe('middle');
  });

  /*
   * NOT TESTED, DELIBERATELY: `onKeyDown`'s `!inside` branch — Tab pressed while focus is outside
   * the dialog.
   *
   * A test for it was written and then removed, because the state it needs cannot be reached while
   * the trap is active. The `focusin` guard returns focus the instant anything outside takes it, so
   * "focus rests outside a live trap" is not a state the application can be in, and the only way to
   * assert the branch would be to reach past the hook's own guard and construct it artificially.
   *
   * That test would then pass whether or not the branch was correct, because nothing real depends
   * on it. The branch is belt-and-braces against a guard that has been removed or has not yet
   * installed, and it is recorded here as such rather than given a test that proves nothing.
   */

  it('refuses to leave even when the dialog has nothing focusable in it', () => {
    /*
     * A dialog can be momentarily empty — its buttons disabled while a decision is being applied.
     * Tab must not become an escape hatch during exactly the window where the app is mid-operation.
     */
    render(createElement(Dialog, { children: createElement('p', null, 'Working…') }));
    const dialog = screen.getByTestId('dialog');

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('what counts as a tab stop', () => {
  it('skips a roving-tabindex option, so the true last control is recognised as the end', () => {
    /*
     * The language-picker bug, named in the module's own comments. Every option is a `<button>` and
     * all but the active one carry `tabindex="-1"` so Tab skips them. Counting them made the trap
     * think the last option sat in the middle, so Tab at the real end was not treated as the end —
     * focus left the region and the focusin guard dragged it back, and to the user **Tab appeared
     * to do nothing**.
     */
    render(
      createElement(Dialog, {
        children: [
          createElement('button', { key: 'a', 'data-testid': 'first' }, 'Active option'),
          createElement('button', { key: 'b', 'data-testid': 'roving', tabIndex: -1 }, 'Inactive option'),
        ],
      }),
    );
    screen.getByTestId('first').focus();

    /*
     * ASSERT ON `defaultPrevented`, NOT ON WHERE FOCUS ENDED UP.
     *
     * This was first written as `expect(focused()).toBe('first')` and it was VACUOUS: jsdom does
     * not implement Tab's native focus movement, so when the trap correctly declines to intervene
     * the browser moves nothing and focus stays put — which is the same observation as the trap
     * wrapping back to the same element. Deleting the `tabIndex >= 0` filter left all ten tests
     * green, which is how it was caught.
     *
     * `preventDefault` is the thing the hook actually decides. With the filter, `first` is both the
     * first and the LAST real tab stop, so Tab is at the end and must be prevented and wrapped.
     * Without it, the trap believes `roving` is the last stop, does not recognise the end, and lets
     * the event through — which in a real browser is focus leaving the dialog.
     */
    const dialog = screen.getByTestId('dialog');
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(event);

    expect(event.defaultPrevented, 'the only real tab stop is also the last one').toBe(true);
    expect(focused()).toBe('first');
  });

  it('skips a hidden control', () => {
    // THE CONTROL ON THE HARNESS: this is the only test that can fail if the `offsetParent` stub
    // above stops reporting visibility. Without it, a stub that always said "visible" would leave
    // the hook's own visibility filter completely untested while every other test still passed.
    render(
      createElement(Dialog, {
        children: [
          createElement('button', { key: 'a', 'data-testid': 'first' }, 'First'),
          createElement(
            'button',
            { key: 'b', 'data-testid': 'hidden', style: { display: 'none' } },
            'Hidden',
          ),
          createElement('button', { key: 'c', 'data-testid': 'last' }, 'Last'),
        ],
      }),
    );
    screen.getByTestId('last').focus();

    tab();

    expect(focused()).toBe('first');
  });
});

describe('the focusin guard', () => {
  it('hauls the caret back when the application behind steals it', () => {
    /*
     * Tab is not the only way focus moves. A terminal attaching in the background, an editor
     * mounting, a programmatic `select()` — none of them go through `onKeyDown`, and each would put
     * the caret in the application while a destructive question is still on screen.
     */
    render(createElement('div', null, createElement(Outside), createElement(Dialog)));
    screen.getByTestId('middle').focus();

    screen.getByTestId('outside').focus();

    expect(focused(), 'focus must return to where it was inside the dialog').toBe('middle');
  });

  it('stands aside for ANOTHER dialog, rather than arm-wrestling it (#219)', () => {
    /*
     * When one transient overlay replaces another, React mounts the newcomer before tearing the
     * incumbent down, so the outgoing dialog's guard is still installed when the newcomer takes
     * focus. Left to fight, the outgoing dialog drags the caret into itself and is then removed
     * from the document — focus lands on `<body>` and the next keystroke goes nowhere. Measured
     * across three overlays, in any order.
     *
     * A modal opened INSIDE this one is caught by the `root.contains` check and never reaches here,
     * so only siblings are affected.
     */
    render(
      createElement(
        'div',
        null,
        createElement(Dialog),
        createElement(
          'div',
          { role: 'dialog', 'aria-modal': 'true', 'data-testid': 'newcomer' },
          createElement('button', { 'data-testid': 'newcomer-button' }, 'Newcomer'),
        ),
      ),
    );
    screen.getByTestId('middle').focus();

    screen.getByTestId('newcomer-button').focus();

    expect(focused(), 'the incumbent must let the newcomer have the caret').toBe('newcomer-button');
  });

  it('does nothing at all while inactive', () => {
    // An inactive trap must not guard, or a closed dialog left mounted would hold the keyboard
    // hostage for the rest of the session.
    render(createElement('div', null, createElement(Outside), createElement(Dialog, { active: false })));

    screen.getByTestId('outside').focus();

    expect(focused()).toBe('outside');
  });
});
