/**
 * 015 / US4 — capturing a key binding (FR-031 … FR-033b).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-keybindings.e2e.ts` (034 FR-045).
 *
 * Those tests opened a real preferences window and then dispatched **synthetic** `KeyboardEvent`s
 * at `window` — which is what a component test does natively. The window bought nothing: the modal
 * listens on `window`, decides whether the chord is bindable, and hands a new bindings map to its
 * parent. Every step of that is visible in a DOM.
 *
 * WHAT STAYED AN E2E, and why:
 *
 *  - **That the captured chord reaches `keybindings.json`.** The modal hands `onApply` a map; who
 *    writes it, and whether it survives, is the config-write path.
 *  - **The `user-select: none` assertions.** They read `getComputedStyle(el).userSelect` and expect
 *    the value INHERITED from the app's stylesheet. jsdom does not apply a real cascade, so a
 *    component test asserting it would be asserting about jsdom rather than about throng — which is
 *    the trap 034 FR-049 names: an assertion that looks like markup but depends on real style
 *    resolution stays where the styles are real.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CaptureModal } from '../../src/renderer/preferences/capture-modal.js';

/** The shipped defaults the E2E relied on, restated so a change to them cannot rewrite the claim. */
const BINDINGS: Record<string, string[]> = {
  'view.toggleProjects': ['Ctrl+Alt+B'],
  'view.toggleExplorer': ['Ctrl+Alt+N'],
};

function openCapture(action = 'view.toggleExplorer') {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    createElement(CaptureModal, {
      action: action as never,
      label: 'Toggle Files & Folders',
      bindings: BINDINGS,
      onApply,
      onClose,
    }),
  );
  return { onApply, onClose };
}

/**
 * Press a chord the way the modal hears one: keydown then keyup on `window`.
 *
 * This is the same helper the E2E had, minus the `page.evaluate` round trip — which is the whole
 * migration in one line.
 *
 * Wrapped in `act` because the modal listens on `window` rather than on a React element, so the
 * state it sets lands outside React's batching and the re-render has not flushed by the time an
 * assertion runs. Without it the two tests that assert RENDERED feedback — the error and the
 * conflict — fail while the three that only assert `onApply` pass, because a mock records its call
 * whether or not anything re-rendered. That split is worth knowing: it is the shape of every
 * "passes locally, fails in CI" timing complaint at this layer.
 */
function press(key: string, mods: Partial<KeyboardEventInit> = {}): void {
  const init = { key, bubbles: true, ...mods } as KeyboardEventInit;
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keyup', init));
  });
}

describe('capturing a chord', () => {
  it('ADDS the captured chord rather than replacing what is bound', () => {
    // Multiple chords per action (FR-033b). Replacing would silently take away a binding the user
    // never asked to lose, and the E2E caught that by comparing the whole array.
    const { onApply } = openCapture('view.toggleProjects');
    press('k', { ctrlKey: true });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleProjects': ['Ctrl+Alt+B', 'Ctrl+K'] }),
    );
  });

  it('binds a bare single key, no modifier required', () => {
    const { onApply } = openCapture();
    press('F7');
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ 'view.toggleExplorer': ['Ctrl+Alt+N', 'F7'] }),
    );
  });

  it('refuses an excluded single key, keeps the modal open, and applies nothing', () => {
    // Space on its own. The modal STAYING OPEN is half the requirement: a dialog that closed on a
    // refusal would look like it had accepted.
    const { onApply } = openCapture();
    press(' ');
    expect(screen.getByTestId('capture-error')).toBeVisible();
    expect(screen.getByTestId('capture-modal')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('surfaces a chord the OS has reserved as unavailable, and applies nothing', () => {
    // Alt+F4. throng never receives it, so binding it would produce a command the user can see in
    // the list and never trigger — worse than refusing, because it looks like it worked.
    const { onApply } = openCapture();
    press('F4', { altKey: true });
    expect(screen.getByTestId('capture-error')).toHaveTextContent(/reserved/i);
    expect(screen.getByTestId('capture-modal')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('ignores a modifier pressed on its own', () => {
    // Holding Ctrl before the real key must not be read as a chord — otherwise every capture would
    // resolve the instant the user reached for a modifier.
    const { onApply } = openCapture();
    press('Control', { ctrlKey: true });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('capture-modal')).toBeVisible();
  });

  it('warns on a chord already bound elsewhere instead of silently stealing it', () => {
    // A REAL clash: Ctrl+Alt+B belongs to view.toggleProjects, and this capture is for a different
    // action. The user is offered the choice; nothing is applied until they take it.
    const { onApply } = openCapture('view.toggleExplorer');
    press('b', { ctrlKey: true, altKey: true });
    expect(screen.getByTestId('capture-conflict')).toBeVisible();
    expect(onApply).not.toHaveBeenCalled();
  });
});

/**
 * Resolving a conflict (FR-034).
 *
 * NEW COVERAGE, not a migration. `applyReassign` is proved on its own in
 * `packages/core/tests/unit/chord-capture.test.ts`, and the E2E watched a reassign happen through a
 * real preferences window — but NOTHING at any layer asserted that the Reassign BUTTON calls it, or
 * that Cancel leaves the bindings alone. A conflict dialog whose two buttons were wired the wrong way
 * round would have passed every test in the repo.
 */
describe('resolving a conflict', () => {
  it('Reassign moves the chord off the other action and onto this one', async () => {
    const { onApply } = openCapture('view.toggleExplorer');
    press('b', { ctrlKey: true, altKey: true });

    await userEvent.click(screen.getByTestId('capture-reassign'));

    expect(onApply).toHaveBeenCalledTimes(1);
    const next = onApply.mock.calls[0][0] as Record<string, string[]>;
    // Taken FROM the previous owner…
    expect(next['view.toggleProjects']).not.toContain('Ctrl+Alt+B');
    // …and given to this one, ALONGSIDE what it already had rather than instead of it.
    expect(next['view.toggleExplorer']).toContain('Ctrl+Alt+B');
    expect(next['view.toggleExplorer']).toContain('Ctrl+Alt+N');
  });

  it('Cancel applies nothing at all, leaving both actions as they were', async () => {
    const { onApply, onClose } = openCapture('view.toggleExplorer');
    press('b', { ctrlKey: true, altKey: true });

    await userEvent.click(screen.getByTestId('capture-cancel'));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('names both the chord and the action it would be taken from', () => {
    // "Already bound" is not enough to decide with — the user has to know what they are about to
    // break before they press the button that breaks it.
    openCapture('view.toggleExplorer');
    press('b', { ctrlKey: true, altKey: true });
    const conflict = screen.getByTestId('capture-conflict').textContent ?? '';
    expect(conflict).toContain('Ctrl+Alt+B');
    expect(conflict).toContain('view.toggleProjects');
  });
});
