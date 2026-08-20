/**
 * `TreeDropTarget` — what a panel does with a file dragged out of Files & Folders (024 US4, #114).
 *
 * PLACE AT: `packages/ui/tests/component/tree-drop-target.test.ts`
 * MIGRATED FROM (035 FR-007/FR-008): `packages/ui/tests/e2e/tree-drop-open.e2e.ts:194`
 * — `test('a folder or multi-select dropped on an untyped panel is rejected (#114)')`.
 *
 * ══ WHY THAT TEST COMES DOWN ══
 *
 * `tree-drop-open.e2e.ts` says in its own header that it does not drive a drag at all: every one of
 * its five tests dispatches a `throng:tree-drop` CustomEvent at `window`, because *"a real
 * react-dnd → native drop is not scriptable"*. That is true, and it is exactly the point — **a
 * synthetic event dispatched at a window is not the OS drag-and-drop that Principle V reserves for
 * E2E.** It is this component's own documented seam (`tree-drop-target.tsx:48`), and this file
 * drives the SAME seam with the SAME event, one Electron process cheaper.
 *
 * The precedent is `os-drop-refusal.test.ts`, which made this identical argument for
 * `os-drop.e2e.ts` and its `throng:os-drop` twin. This is the same finding in the neighbouring
 * component, and 035's census found the pair.
 *
 * ══ WHAT STAYS AT E2E, AND WHY ══
 *
 * The other four tests assert what happens AFTER an accepted drop — an untyped panel becomes an
 * editor showing the file, an already-open file focuses its existing editor, a drop on a tab chip
 * opens there. None of that is this component's work: it calls `onDrop` and stops. Those outcomes
 * belong to the workspace store and a really-mounted editor, and moving them needs a harness that
 * does not exist yet. They are not kept because they need a real drag — they don't — and the file's
 * header has been corrected to stop implying otherwise.
 *
 * ══ WHAT THIS ASSERTS THAT THE E2E NEVER DID ══
 *
 * The E2E could only see the end of the story, so four properties of the seam went untested:
 *
 *   - **A drop aimed at ANOTHER panel is ignored.** Every panel on screen registers a window-level
 *     listener, so the panelId filter is the only thing stopping one drop opening a file in all of
 *     them. With one panel in view the E2E could not have noticed if it were missing.
 *   - **The refusal is visible before the drop.** `dragover` sets `dropEffect` to `none` for a
 *     payload the panel will not take, which is the "not allowed" cursor the user reads. A refusal
 *     that only happens on release is a promise broken after the fact.
 *   - **The decision is published for the window-level re-assert.** react-dnd's backend rewrites
 *     `dropEffect` to `none` for anything it does not own, so the tree re-asserts afterwards from
 *     `takeTreeDropEffect()`. If a target refused but published nothing, the re-assert would show
 *     `copy` over a panel that will refuse — the defect the store's own comment describes.
 *   - **The listener survives a re-render.** `accepts`/`onDrop` are held in refs precisely so a
 *     caller passing fresh closures each render does not re-subscribe. Nothing tested that the refs
 *     are actually *read* — a listener closed over the first render's props would keep working in
 *     any test that never re-renders, and silently use stale logic in the real app.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()`, replace `TreeDropTarget` with `'div'`. The children still render, so any test
 * asserting only on the panel body would pass — but every test here asserts on `onDrop`,
 * `dropEffect` or `takeTreeDropEffect()`, all of which are the component's own behaviour. **All
 * seven fail.**
 */
import { act, render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TREE_DROP_EVENT,
  setTreeDrag,
  clearTreeDrag,
  takeTreeDropEffect,
} from '../../src/renderer/explorer/tree-drag-store.js';
import { TreeDropTarget } from '../../src/renderer/editor/tree-drop-target.js';

const PANEL = 'panel-1';
const OTHER = 'panel-2';
const FILE = 'D:/proj/hello.txt';
const FOLDER = 'D:/proj/src';

/** The rule an UNTYPED panel applies: exactly one file, never a folder or a multi-select. */
const singleFileOnly = (paths: string[], singleFile: boolean): boolean =>
  singleFile && paths.length === 1;

function mount(accepts: (paths: string[], single: boolean) => boolean = singleFileOnly) {
  const onDrop = vi.fn();
  // ANTI-VACUITY CONTROL: swap `TreeDropTarget` for `'div'` here and all seven tests fail.
  render(
    createElement(
      TreeDropTarget,
      { panelId: PANEL, accepts, onDrop },
      createElement('div', { 'data-testid': 'panel-body' }, 'panel body'),
    ),
  );
  return { onDrop };
}

/**
 * Drive the seam, wrapped in `act()`.
 *
 * The same reason `os-drop-refusal.test.ts` gives: the listener runs synchronously but the caller's
 * `onDrop` may schedule React work, and without `act()` assertions on rendered output fail while
 * assertions on the mock pass — a confusing split this branch has already paid for once.
 */
async function dispatchDrop(
  detail: { panelId?: string; tabId?: string; paths: string[]; singleFile?: boolean },
): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(TREE_DROP_EVENT, { detail }));
  });
}

beforeEach(() => {
  clearTreeDrag();
  takeTreeDropEffect(); // read-and-clear, so no effect leaks between tests
});

afterEach(() => {
  clearTreeDrag();
});

describe('the tree-drop seam', () => {
  it('opens a single file dropped on THIS panel', async () => {
    const { onDrop } = mount();
    await dispatchDrop({ panelId: PANEL, paths: [FILE], singleFile: true });
    expect(onDrop).toHaveBeenCalledWith([FILE], true);
  });

  it('ignores a drop aimed at another panel', async () => {
    // Every panel registers a window-level listener, so without the panelId filter one drop would
    // open the file in all of them. The E2E had one panel in view and could not have seen this.
    const { onDrop } = mount();
    await dispatchDrop({ panelId: OTHER, paths: [FILE], singleFile: true });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('ignores a drop carrying no panel id at all', async () => {
    // A tab-chip drop sets `tabId` instead; a panel must not treat that as its own.
    const { onDrop } = mount();
    await dispatchDrop({ tabId: 'tab-1', paths: [FILE], singleFile: true });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('refuses a folder or a multi-select', async () => {
    // The claim `tree-drop-open.e2e.ts:194` existed for.
    const { onDrop } = mount();
    await dispatchDrop({ panelId: PANEL, paths: [FOLDER], singleFile: false });
    expect(onDrop).not.toHaveBeenCalled();

    await dispatchDrop({ panelId: PANEL, paths: [FILE, FOLDER], singleFile: false });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('reads the CURRENT accepts/onDrop after a re-render, not the first render’s', async () => {
    // The refs exist for this, and nothing tested that they are read. A listener closed over the
    // first render's props passes every test that never re-renders, and goes stale in the real app.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      createElement(
        TreeDropTarget,
        { panelId: PANEL, accepts: () => true, onDrop: first },
        createElement('div', null, 'body'),
      ),
    );
    rerender(
      createElement(
        TreeDropTarget,
        { panelId: PANEL, accepts: () => true, onDrop: second },
        createElement('div', null, 'body'),
      ),
    );

    await dispatchDrop({ panelId: PANEL, paths: [FILE], singleFile: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith([FILE], true);
  });
});

describe('the cursor the user sees before releasing', () => {
  /** `dragover` on the wrapper, with a dataTransfer whose dropEffect we can read back. */
  function dragOver(): { dropEffect: string } {
    const dataTransfer = { dropEffect: 'uninitialized' } as unknown as DataTransfer;
    fireEvent.dragOver(screen.getByTestId('panel-body').parentElement as HTMLElement, {
      dataTransfer,
    });
    return dataTransfer as unknown as { dropEffect: string };
  }

  it('shows copy for a payload the panel will take', () => {
    mount();
    setTreeDrag({ paths: [FILE], singleFile: true } as never);
    expect(dragOver().dropEffect).toBe('copy');
    expect(takeTreeDropEffect()).toBe('copy');
  });

  it('shows "not allowed" for a payload the panel will refuse, and publishes that refusal', () => {
    // Both halves matter. The cursor is what the user reads; the published effect is what the
    // window-level re-assert applies, and without it react-dnd's blanket rewrite would show `copy`
    // over a panel that is about to refuse.
    mount();
    setTreeDrag({ paths: [FOLDER], singleFile: false } as never);
    expect(dragOver().dropEffect).toBe('none');
    expect(takeTreeDropEffect()).toBe('none');
  });
});
