/**
 * 050 T087 (FR-034, SC-011, research R17) — the "no entry" cursor over anything that is not a drop target.
 *
 * Playwright cannot see the OS cursor, so what is provable here is the value the browser reads when the
 * `dragover` has finished propagating: `dataTransfer.dropEffect`. `none` is what makes the cursor a
 * circle-with-a-slash; `copy` over a Projects row or the title bar promised a paste that would not happen.
 *
 * `useNoDropNavigation` (`composition-root.tsx`) owns an OS `Files` drag and leaves alone an event a target
 * has already claimed, which is what keeps an editor's `copy` a single write (`os-drop.e2e.ts`).
 *
 * The tree's OWN drags no longer travel as web drags (067 FR-110), so their pointer is covered where it is
 * decided: `tree-pointer-backend.test.ts`.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useNoDropNavigation } from '../../src/renderer/composition-root.js';

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
