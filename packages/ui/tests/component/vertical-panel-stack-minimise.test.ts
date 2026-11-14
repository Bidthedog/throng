/**
 * 068 US4 T048 (FR-037, data-model "Side-panel layout state") — a panel in a vertical stack can be
 * minimised to its header, the panel above takes the space, and restoring returns it to its earlier
 * height; minimised state and sizes persist under the stack's storage keys, and a stored state of the
 * wrong length falls back to the defaults.
 *
 * Layer: component — what the stack renders, its computed heights and its persistence. jsdom has no
 * layout, so the container's height is stubbed (the stack fits its panels to it).
 *
 * ANTI-VACUITY: the restore test asserts the minimised heights first, so a stack that never changed a
 * height would fail there, and the fallback test seeds a state that WOULD minimise if it were trusted.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VerticalPanelStack, type StackPanel } from '../../src/renderer/panes/vertical-panel-stack.js';

const SIZES_KEY = 'test.panelSizes';
const MIN_KEY = 'test.panelMinimised';
const CONTAINER = 600;

let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;
let originalObserver: typeof globalThis.ResizeObserver | undefined;

beforeEach(() => {
  localStorage.clear();
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement): DOMRect {
    const height = this.classList.contains('panel-stack') ? CONTAINER : 0;
    return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  if (originalObserver) globalThis.ResizeObserver = originalObserver;
});

const panels = (): StackPanel[] => [
  { key: 'a', minHeight: 100, defaultHeight: 300, render: () => createElement('div', { 'data-testid': 'panel-a' }, 'A') },
  {
    key: 'b',
    minHeight: 60,
    defaultHeight: 160,
    minimisable: true,
    minimisedHeight: 30,
    render: ({ minimised, toggleMinimise }) =>
      createElement(
        'div',
        { 'data-testid': 'panel-b', 'data-minimised': String(minimised) },
        createElement('button', { 'data-testid': 'toggle-b', onClick: toggleMinimise }, 'toggle'),
        minimised ? null : createElement('div', { 'data-testid': 'b-body' }, 'body'),
      ),
  },
];

function mount(): ReturnType<typeof render> {
  return render(
    createElement(VerticalPanelStack, { panels: panels(), storageKey: SIZES_KEY, minimisedStorageKey: MIN_KEY }) as ReactElement,
  );
}

const heightOf = (testId: string): number =>
  Number.parseFloat((screen.getByTestId(testId).closest('.sidebar-panel') as HTMLElement).style.height);

describe('minimise and restore (FR-037)', () => {
  it('fits both panels to the container before anything is minimised', () => {
    mount();
    expect(heightOf('panel-a') + heightOf('panel-b')).toBe(CONTAINER);
    expect(heightOf('panel-b')).toBe(160);
  });

  it('a minimised panel renders its header only, and the panel above takes the space', () => {
    mount();
    fireEvent.click(screen.getByTestId('toggle-b'));
    expect(screen.getByTestId('panel-b').getAttribute('data-minimised')).toBe('true');
    expect(screen.queryByTestId('b-body')).toBeNull();
    expect(heightOf('panel-b')).toBe(30);
    expect(heightOf('panel-a')).toBe(CONTAINER - 30);
  });

  it('restore returns the panel to its earlier height', () => {
    mount();
    fireEvent.click(screen.getByTestId('toggle-b'));
    expect(heightOf('panel-b')).toBe(30);
    fireEvent.click(screen.getByTestId('toggle-b'));
    expect(screen.getByTestId('panel-b').getAttribute('data-minimised')).toBe('false');
    expect(heightOf('panel-b')).toBe(160);
    expect(heightOf('panel-a')).toBe(CONTAINER - 160);
  });

  it('has no owner callback and no exported loader left: the pending badge no longer follows the panel (068 FR-059, H1)', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/panes/vertical-panel-stack.tsx'), 'utf8');
    expect(source).not.toContain('onMinimisedChange');
    expect(source).not.toMatch(/export function loadMinimisedFlags/);
  });

  it('a panel that is not minimisable cannot be minimised', () => {
    render(
      createElement(VerticalPanelStack, {
        panels: [
          { key: 'a', minHeight: 100, render: ({ toggleMinimise }) => createElement('button', { 'data-testid': 'toggle-a', onClick: toggleMinimise }) },
          { key: 'b', minHeight: 60, minimisable: true, render: () => createElement('div') },
        ],
        storageKey: SIZES_KEY,
        minimisedStorageKey: MIN_KEY,
      }),
    );
    const before = heightOf('toggle-a');
    fireEvent.click(screen.getByTestId('toggle-a'));
    expect(heightOf('toggle-a')).toBe(before);
    expect(localStorage.getItem(MIN_KEY) ?? '').not.toContain('true');
  });
});

describe('persistence (data-model "Side-panel layout state")', () => {
  it('stores the minimised flags and the sizes under the stack’s keys, and a remount restores them', () => {
    const first = mount();
    fireEvent.click(screen.getByTestId('toggle-b'));
    expect(JSON.parse(localStorage.getItem(MIN_KEY)!)).toEqual([false, true]);
    const stored = JSON.parse(localStorage.getItem(SIZES_KEY)!) as number[];
    expect(stored).toHaveLength(2);
    // The minimised panel keeps its last height in the sizes array (FR-037).
    expect(stored[1]).toBe(160);

    act(() => first.unmount());
    mount();
    expect(screen.getByTestId('panel-b').getAttribute('data-minimised')).toBe('true');
    expect(heightOf('panel-b')).toBe(30);
    fireEvent.click(screen.getByTestId('toggle-b'));
    expect(heightOf('panel-b')).toBe(160);
  });

  it('falls back to the defaults for a stored state of the wrong length', () => {
    localStorage.setItem(MIN_KEY, JSON.stringify([true]));
    localStorage.setItem(SIZES_KEY, JSON.stringify([50]));
    mount();
    expect(screen.getByTestId('panel-b').getAttribute('data-minimised')).toBe('false');
    expect(heightOf('panel-b')).toBe(160);
  });

  it('falls back to the defaults for stored state that is not an array of the right kind', () => {
    localStorage.setItem(MIN_KEY, '{"oops":true}');
    localStorage.setItem(SIZES_KEY, 'not json');
    mount();
    expect(screen.getByTestId('panel-b').getAttribute('data-minimised')).toBe('false');
  });
});
