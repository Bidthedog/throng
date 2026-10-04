/**
 * 050 T087 (FR-034, SC-011, research R17) — the "no entry" cursor over anything that is not a drop target.
 *
 * Playwright cannot see the OS cursor, so what is provable here is the value the browser reads when the
 * `dragover` has finished propagating: `dataTransfer.dropEffect`. `none` is what makes the cursor a
 * circle-with-a-slash; `copy` over a Projects row or the title bar promised a paste that would not happen.
 *
 * Two window listeners decide it, and each owns one kind of drag:
 *   - the file tree's (`file-tree.tsx`), registered after react-dnd's backend, for the tree's OWN drags;
 *   - `useNoDropNavigation` (`composition-root.tsx`), for an OS `Files` drag.
 * Both must leave alone an event a target has already claimed, which is what keeps an editor's `copy`
 * a single write (`os-drop.e2e.ts`).
 */
import { renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useNoDropNavigation } from '../../src/renderer/composition-root.js';
import { clearTreeDrag, setTreeDrag, setTreeDropEffect, takeTreeDropEffect } from '../../src/renderer/explorer/tree-drag-store.js';
import { resetPendingRevealForTests } from '../../src/renderer/explorer/pending-reveal.js';
import {
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';

/** A `dragover` carrying a plain-object `dataTransfer` whose every `dropEffect` write is recorded. */
function dragOver(
  target: EventTarget,
  types: string[],
  initial = 'move',
): { event: Event; effect: () => string; writes: string[] } {
  const writes: string[] = [];
  let value = initial;
  const dataTransfer = {
    types,
    effectAllowed: 'copyMove',
    get dropEffect() {
      return value;
    },
    set dropEffect(next: string) {
      value = next;
      writes.push(next);
    },
  };
  const event = new Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'ctrlKey', { value: false });
  Object.defineProperty(event, 'shiftKey', { value: false });
  Object.defineProperty(event, 'altKey', { value: false });
  target.dispatchEvent(event);
  return { event, effect: () => value, writes };
}

describe('an OS file drag over nothing (050 T087, FR-034, useNoDropNavigation)', () => {
  let unmount: () => void;
  beforeEach(() => {
    unmount = renderHook(() => useNoDropNavigation()).unmount;
  });
  afterEach(() => unmount());

  it('ends with dropEffect `none` — and the event is still defaultPrevented, so a drop cannot navigate', () => {
    const over = dragOver(document.body, ['Files'], 'copy');

    expect(over.effect()).toBe('none');
    expect(over.event.defaultPrevented).toBe(true);
  });

  it('still prevents the DROP, which would otherwise navigate the window to the file (018 FR-061a)', () => {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
  });

  it('writes nothing when a target already claimed the event (its `copy` is the only write)', () => {
    const claim = (e: Event): void => {
      e.preventDefault();
      (e as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect = 'copy';
    };
    const host = document.createElement('div');
    host.addEventListener('dragover', claim);
    document.body.append(host);

    const over = dragOver(host, ['Files'], 'none');
    host.remove();

    expect(over.writes).toEqual(['copy']);
    expect(over.effect()).toBe('copy');
  });
});

describe('a tree drag over something that is not a target (050 T087, FR-034, file-tree.tsx)', () => {
  beforeAll(installResizeObserver);
  afterAll(uninstallResizeObserver);
  beforeEach(() => {
    localStorage.clear();
    resetPendingRevealForTests();
    takeTreeDropEffect();
  });
  afterEach(() => {
    clearTreeDrag();
    takeTreeDropEffect();
    localStorage.clear();
    Reflect.deleteProperty(window, 'throng');
  });

  it('ends with dropEffect `none` over an element nothing claimed — a Projects pane row included', async () => {
    const m = await mountExplorer(standardHost, {});
    setTreeDrag({ paths: ['C:/projects/demo/a.txt'], singleFile: true } as never);
    const row = document.createElement('div');
    row.dataset.testid = 'project-row';
    document.body.append(row);

    const over = dragOver(row, ['application/x-throng'], 'copy');
    row.remove();
    m.unmount();

    expect(over.effect()).toBe('none');
  });

  it('keeps `copy` when a target chose it', async () => {
    const m = await mountExplorer(standardHost, {});
    setTreeDrag({ paths: ['C:/projects/demo/a.txt'], singleFile: true } as never);
    const target = document.createElement('div');
    target.addEventListener('dragover', () => setTreeDropEffect('copy'));
    document.body.append(target);

    const over = dragOver(target, ['application/x-throng'], 'none');
    target.remove();
    m.unmount();

    expect(over.effect()).toBe('copy');
  });
});
