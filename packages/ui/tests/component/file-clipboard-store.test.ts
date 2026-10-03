/**
 * 050 T023 (FR-001, FR-004, FR-005) — the renderer's view of the application-wide file clipboard.
 *
 * The clipboard is owned by main and survives a project switch, which unmounts and remounts the whole
 * tree. So the renderer holds NO copy of its own that could be lost with a component: `useFileClipboard`
 * reads main's value on mount (`get`), follows every push (`onChange`), and two components using it
 * see one value. A consumer that unmounts and remounts reads the clipboard back from main — which is
 * what keeps a cut greyed after the user switches away from its project and back.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileClipboard } from '@throng/core';
import {
  isCut,
  resetFileClipboardStoreForTests,
  useFileClipboard,
} from '../../src/renderer/explorer/file-clipboard-store.js';

const item = (absPath: string, projectId = 'p1') => ({ absPath, projectId, projectRoot: 'C:/a' });

let current: FileClipboard;
let listeners: Set<(c: FileClipboard) => void>;
let get: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;
let clear: ReturnType<typeof vi.fn>;

function push(next: FileClipboard): void {
  current = next;
  act(() => {
    for (const l of listeners) l(next);
  });
}

beforeEach(() => {
  resetFileClipboardStoreForTests();
  current = null;
  listeners = new Set();
  get = vi.fn(() => Promise.resolve(current));
  set = vi.fn(() => Promise.resolve({ ok: true }));
  clear = vi.fn();
  (window as unknown as { throng: unknown }).throng = {
    fileClipboard: {
      get,
      set,
      clear,
      onChange: (cb: (c: FileClipboard) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
});

function Probe({ id }: { id: string }): ReactElement {
  const clipboard = useFileClipboard();
  return createElement(
    'span',
    { 'data-testid': id },
    clipboard === null ? 'empty' : `${clipboard.mode}:${clipboard.items.map((i) => i.absPath).join(',')}`,
  );
}

describe('useFileClipboard (050 T023)', () => {
  it('starts from what main holds', async () => {
    current = { mode: 'cut', items: [item('C:/a/x.txt')] };
    render(createElement(Probe, { id: 'one' }));
    await waitFor(() => expect(screen.getByTestId('one').textContent).toBe('cut:C:/a/x.txt'));
    expect(get).toHaveBeenCalled();
  });

  it('is empty before main answers, then follows every push', async () => {
    render(createElement(Probe, { id: 'one' }));
    expect(screen.getByTestId('one').textContent).toBe('empty');
    push({ mode: 'copy', items: [item('C:/a/y.txt')] });
    expect(screen.getByTestId('one').textContent).toBe('copy:C:/a/y.txt');
    push(null);
    expect(screen.getByTestId('one').textContent).toBe('empty');
  });

  it('gives two components the same value from ONE subscription', async () => {
    render(createElement('div', null, createElement(Probe, { id: 'a' }), createElement(Probe, { id: 'b' })));
    push({ mode: 'cut', items: [item('C:/a/z')] });
    expect(screen.getByTestId('a').textContent).toBe('cut:C:/a/z');
    expect(screen.getByTestId('b').textContent).toBe('cut:C:/a/z');
    expect(listeners.size, 'each consumer subscribed on its own').toBe(1);
  });

  it('reads the clipboard back from main after every consumer unmounted and remounted (FR-001)', async () => {
    const first = render(createElement(Probe, { id: 'one' }));
    push({ mode: 'cut', items: [item('C:/a/keep.txt')] });
    expect(screen.getByTestId('one').textContent).toBe('cut:C:/a/keep.txt');

    first.unmount();
    expect(listeners.size, 'the last consumer left its subscription behind').toBe(0);
    // While nobody listens, another window changes it — no push reaches us.
    current = { mode: 'cut', items: [item('C:/b/other.txt', 'p2')] };

    render(createElement(Probe, { id: 'two' }));
    await waitFor(() => expect(screen.getByTestId('two').textContent).toBe('cut:C:/b/other.txt'));
  });
});

describe('isCut (050 T023, FR-004)', () => {
  const cutOf = (...paths: string[]): FileClipboard => ({ mode: 'cut', items: paths.map((p) => item(p)) });

  it('compares normalised paths: separators, case and a trailing slash do not matter', () => {
    const clipboard = cutOf('C:\\Proj\\src\\a.ts');
    expect(isCut(clipboard, 'c:/proj/src/a.ts')).toBe(true);
    expect(isCut(clipboard, 'C:/Proj/src/a.ts/')).toBe(true);
    expect(isCut(clipboard, 'C:/Proj/src/b.ts')).toBe(false);
  });

  it('is false for a copy, and for an empty clipboard', () => {
    expect(isCut({ mode: 'copy', items: [item('C:/a/x')] }, 'C:/a/x')).toBe(false);
    expect(isCut(null, 'C:/a/x')).toBe(false);
  });

  it('does not match a path that merely shares a prefix', () => {
    expect(isCut(cutOf('C:/a/foo'), 'C:/a/foobar')).toBe(false);
  });
});
