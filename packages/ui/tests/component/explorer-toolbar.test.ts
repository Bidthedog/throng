/**
 * The explorer toolbar — which controls it draws, in what order, what their titles say, and what a
 * click asks for (004 FR-031/032; 033 / #219 FR-018, FR-018a–c, FR-074, V1–V5, AS-16/AS-17).
 *
 * PLACE AT: `packages/ui/tests/component/explorer-toolbar.test.ts`
 * MIGRATED FROM `packages/ui/tests/e2e/quick-open-toolbar.e2e.ts:209` (whole) and the tooltip half of
 * `:122` (034 FR-045).
 *
 * `ExplorerToolbar` is props-only. It takes five optional handlers, a `Keybindings` object and a
 * boolean; the only thing in it that touches a context is `Icon`, which resolves through
 * ConfigContext's REAL defaults, so no provider appears below. Passing a `Keybindings` object is the
 * whole of what the E2E spent a preferences window, a chord capture, a pill removal and a config
 * hot-reload to arrange.
 *
 * ══ WHAT STAYS END-TO-END ══
 *
 *   - That the CHORD opens the modal, and that it opens nothing with no project (A5). That is
 *     `app.tsx`'s window-level capture listener and `NavigationChrome`'s registration, not this
 *     component.
 *   - The rebind round trip itself (`:287`): a real `keybindings.json` write, main's hot reload, and
 *     the new chord actually firing. What moves here is the narrower claim that the TITLE is computed
 *     from whatever bindings the component is holding — which is what makes the reload observable.
 *   - That an icon PACK's artwork is drawn. `Icon` has its own component test; the toolbar's claim is
 *     only that it draws through `Icon` at all.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, type Keybindings } from '@throng/core';
import { ExplorerToolbar } from '../../src/renderer/explorer/toolbar.js';
import { registerQuickOpen } from '../../src/renderer/navigate/navigation-store.js';

/** The shipped chord for `navigate.quickOpen`, taken from the defaults rather than retyped. */
const DEFAULT_CHORD = DEFAULT_KEYBINDINGS.bindings['navigate.quickOpen'][0];

const bound = (chords: string[]): Keybindings => ({
  version: DEFAULT_KEYBINDINGS.version,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'navigate.quickOpen': chords },
});

/**
 * `registerQuickOpen` writes to a MODULE-LEVEL slot in `navigation-store.js` — one per window realm,
 * and in a test file, one per file. Leaving an opener registered would let a later test's click be
 * answered by an earlier test's spy, so it is cleared after every test rather than only where it is
 * set.
 */
afterEach(() => {
  registerQuickOpen(null);
});

function mount(props: Partial<Parameters<typeof ExplorerToolbar>[0]> = {}) {
  const handlers = {
    onExpand: vi.fn(),
    onCollapseAll: vi.fn(),
    onNewFolder: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    createElement(ExplorerToolbar, {
      ...handlers,
      keybindings: DEFAULT_KEYBINDINGS,
      quickOpenEnabled: true,
      ...props,
    } as Parameters<typeof ExplorerToolbar>[0]),
  );
  return { ...handlers, user: userEvent.setup() };
}

/** Every control, by accessible name, in the order it is drawn. */
const names = (): string[] =>
  Array.from(screen.getByTestId('explorer-toolbar').querySelectorAll('button')).map(
    (b) => b.getAttribute('aria-label') ?? '',
  );

const quickOpen = (): HTMLElement => screen.getByRole('button', { name: 'Quick Open' });

describe('the shape of the toolbar (V1, V5)', () => {
  it('draws Quick Open BESIDE Collapse all, and leaves the four shipped controls alone', () => {
    /*
     * The whole list rather than just the new button, because that is what makes V5 — "it is the only
     * new toolbar control" — checkable at all. A test that only found Quick Open would stay green if
     * the feature had also dropped Delete.
     */
    mount();
    expect(names()).toEqual(['Expand', 'Collapse all', 'Quick Open', 'New folder', 'Delete']);
  });

  it('draws every control as an icon, with no text label of its own (V2)', () => {
    /*
     * "No label" is asserted as "no text OUTSIDE the icon", not as "no text at all", and the
     * distinction is the migrated spec's own: at the shipped defaults no icon pack is selected, so
     * `Icon` takes its GLYPH branch and renders the theme's character as text. An empty-textContent
     * assertion would therefore fail on all five controls and would be testing that a pack was
     * installed — which is not what V2 says.
     */
    mount();

    for (const button of Array.from(
      screen.getByTestId('explorer-toolbar').querySelectorAll('button'),
    )) {
      const icons = button.querySelectorAll('.icon');
      expect(icons).toHaveLength(1);
      expect((button.textContent ?? '').trim()).toBe((icons[0].textContent ?? '').trim());
    }
  });
});

describe('the Quick Open title names the LIVE chord (FR-018a, V3, AS-16)', () => {
  it('names the action and the command’s current chord', () => {
    mount();
    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('Quick Open');
    expect(title).toContain(DEFAULT_CHORD);
  });

  it('follows a REBIND, because it is computed from the bindings it is given', () => {
    /*
     * AS-17's mechanism, one layer below the round trip. The E2E proves the rebound file reaches this
     * component; this proves that when it does, the title changes — and, critically, that the OLD
     * chord goes. A title built by appending would satisfy the first assertion and fail the second,
     * and the failure a user sees is a tooltip advertising a shortcut that no longer works.
     */
    mount({ keybindings: bound(['F8']) });

    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('F8');
    expect(title).not.toContain(DEFAULT_CHORD);
  });

  it('names the action alone when the command is UNBOUND, with no empty brackets', () => {
    // A user may remove every chord. "Quick Open ()" is the shape that ships when the empty case is
    // an afterthought rather than a branch.
    mount({ keybindings: bound([]) });

    expect(quickOpen()).toHaveAttribute('title', 'Quick Open');
  });
});

describe('with no project open the control is drawn and disabled (FR-018c, FR-074, V4)', () => {
  it('is visible and disabled rather than hidden', () => {
    mount({ quickOpenEnabled: false });

    expect(quickOpen()).toBeVisible();
    expect(quickOpen()).toBeDisabled();
  });

  it('says WHY, and recites NO chord', () => {
    /*
     * Both halves, because either alone passes for the wrong reason: a title that merely omitted the
     * chord could be empty, and a title that merely explained itself could still trail "(Ctrl+Shift+T)".
     * FR-074 narrows FR-018a to "whenever the button can act" — a disabled control should answer
     * "why can I not use this?" rather than recite a shortcut that would do nothing.
     */
    mount({ quickOpenEnabled: false });

    const title = quickOpen().getAttribute('title') ?? '';
    expect(title).toContain('Quick Open');
    expect(title).toContain('no project is open');
    expect(title).not.toContain(DEFAULT_CHORD);
  });

  it('asks for nothing when it is clicked', async () => {
    const opener = vi.fn(() => true);
    registerQuickOpen(opener);
    const { user } = mount({ quickOpenEnabled: false });

    await user.click(quickOpen());

    expect(opener).not.toHaveBeenCalled();
  });
});

describe('clicking Quick Open goes through the ONE opener (FR-018, V3)', () => {
  it('asks the registered opener rather than opening a second modal of its own', async () => {
    /*
     * The migrated spec's "…and clicking it opens the same modal the chord opens" (`:209`). SAME is
     * the load-bearing word: the button and the chord both go through `requestQuickOpen`, so there is
     * one opener rather than two that must be kept in step. A toolbar that rendered its own picker
     * would satisfy an "a modal appeared" assertion and break FR-066's one-slot rule the moment the
     * chord was pressed as well.
     */
    const opener = vi.fn(() => true);
    registerQuickOpen(opener);
    const { user } = mount();

    await user.click(quickOpen());

    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('is harmless when no chrome is mounted to answer', async () => {
    // `requestQuickOpen` returns false when nothing is registered — a sub-workspace mid-teardown, a
    // window that has not mounted its chrome yet. The click must not throw.
    const { user } = mount();
    await expect(user.click(quickOpen())).resolves.toBeUndefined();
  });
});

describe('a tree action with no handler is an action with nothing to act on', () => {
  it('disables exactly the controls whose handler is absent', () => {
    /*
     * The props are optional because the pane renders this toolbar in BOTH of its states, not because
     * a caller may forget them. Asserting one omitted and one supplied in the same render is what
     * distinguishes "disabled when omitted" from "always disabled".
     */
    mount({ onExpand: undefined, onDelete: undefined });

    expect(screen.getByRole('button', { name: 'Expand' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'New folder' })).toBeEnabled();
  });

  it('calls the handler it was given', async () => {
    const { user, onCollapseAll } = mount();

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));

    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });
});
