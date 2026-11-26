/**
 * 081 US8 (FR-070, FR-072, FR-072a) — the File Explorer fades the entries git ignores.
 *
 * The tree draws a listing at once, unfaded, and asks main which of its entries git ignores; the rows git names take
 * `tree-row--ignored`, and so does everything shown beneath an ignored folder. A watch report that names a
 * `.gitignore` asks again about every listed entry.
 *
 * Layer: component — the asking and the marking are decided in `use-explorer-data` and `tree-node`; a fake bridge
 * stands in for main, whose answer comes from git (proven by `git-ignore-oracle.integration.test.ts`).
 */
import { act, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  entry,
  fakeFiles,
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const LISTING = () => ({
  '': [entry('build', 'folder'), entry('src', 'folder'), entry('a.log', 'file'), entry('b.txt', 'file')],
  build: [entry('app.js', 'file')],
  src: [entry('main.ts', 'file')],
});

type ChangeEvent = { relDir: string; relDirs?: string[]; ignoreRulesChanged?: boolean };

/** A files bridge over {@link LISTING} whose `ignored` answers from `answer`, and whose watch the test can fire. */
function bridge(answer: (relPaths: readonly string[]) => Promise<{ ignored: string[] }>) {
  const { files } = fakeFiles(LISTING());
  const listeners = new Set<(evt: ChangeEvent) => void>();
  const ignored = vi.fn(answer);
  const api = {
    ...files,
    ignored,
    onChange: vi.fn((cb: (evt: ChangeEvent) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
  };
  const emit = (evt: ChangeEvent): void => {
    act(() => {
      for (const l of [...listeners]) l(evt);
    });
  };
  return { api, ignored, emit };
}

const answerFrom = (names: readonly string[]) => (relPaths: readonly string[]) =>
  Promise.resolve({ ignored: relPaths.filter((p) => names.includes(p)) });

const fadedRows = (tree: HTMLElement): string[] =>
  [...tree.querySelectorAll('.tree-row--ignored .tree-label')].map((el) => el.textContent ?? '');
const shownRows = (tree: HTMLElement): string[] =>
  [...tree.querySelectorAll('.tree-row .tree-label')].map((el) => el.textContent ?? '');

/** Open `build` and `src` on mount, as a restored project would. */
const expandOnMount = (): void => {
  localStorage.setItem('throng.explorer.tree.project-a', JSON.stringify({ expanded: ['build', 'src'], selectedId: null }));
};

describe('entries git ignores are drawn faded (081 US8)', () => {
  it('marks the ignored file and folder, and not their siblings, asking with a trailing / for a folder', async () => {
    const b = bridge(answerFrom(['build/', 'a.log']));
    const m = await mountExplorer(standardHost, { listing: LISTING(), extraBridge: { files: b.api } });
    await waitFor(() => expect(fadedRows(m.tree)).toEqual(['build', 'a.log']));
    expect(b.ignored).toHaveBeenCalledWith(['build/', 'src/', 'a.log', 'b.txt']);
  });

  it('fades everything shown beneath an ignored folder', async () => {
    expandOnMount();
    const b = bridge(answerFrom(['build/']));
    const m = await mountExplorer(standardHost, { listing: LISTING(), extraBridge: { files: b.api } });
    await waitFor(() => expect(shownRows(m.tree)).toContain('app.js'));
    await waitFor(() => expect(fadedRows(m.tree)).toEqual(['build', 'app.js']));
  });

  it('draws the listing at once and fades the ignored rows when the answer arrives', async () => {
    let release!: (value: { ignored: string[] }) => void;
    const b = bridge(
      (relPaths) =>
        new Promise((resolve) => {
          release = (v) => resolve({ ignored: v.ignored.filter((p) => relPaths.includes(p)) });
        }),
    );
    const m = await mountExplorer(standardHost, { listing: LISTING(), extraBridge: { files: b.api } });
    await waitFor(() => expect(shownRows(m.tree)).toContain('a.log'));
    await waitFor(() => expect(b.ignored).toHaveBeenCalled());
    expect(fadedRows(m.tree)).toEqual([]);
    await act(async () => release({ ignored: ['a.log'] }));
    await waitFor(() => expect(fadedRows(m.tree)).toEqual(['a.log']));
  });

  it('asks again about every listed entry when a .gitignore changes, and follows the new answer', async () => {
    expandOnMount();
    let names: string[] = ['a.log'];
    const b = bridge((relPaths) => Promise.resolve({ ignored: relPaths.filter((p) => names.includes(p)) }));
    const m = await mountExplorer(standardHost, { listing: LISTING(), extraBridge: { files: b.api } });
    await waitFor(() => expect(fadedRows(m.tree)).toEqual(['a.log']));
    await waitFor(() => expect(b.ignored).toHaveBeenCalledTimes(3));

    names = ['src/', 'b.txt'];
    b.emit({ relDir: '', relDirs: [''], ignoreRulesChanged: true });
    await waitFor(() => expect(fadedRows(m.tree)).toEqual(['src', 'main.ts', 'b.txt']));
    const asked = b.ignored.mock.calls.slice(3).map(([relPaths]) => [...relPaths].sort());
    expect(asked).toEqual(
      expect.arrayContaining([['a.log', 'b.txt', 'build/', 'src/'], ['build/app.js'], ['src/main.ts']]),
    );
  });

  it('does not ask again for a watch report that changes nothing and names no .gitignore', async () => {
    const b = bridge(answerFrom(['a.log']));
    const m = await mountExplorer(standardHost, { listing: LISTING(), extraBridge: { files: b.api } });
    await waitFor(() => expect(fadedRows(m.tree)).toEqual(['a.log']));
    const before = b.ignored.mock.calls.length;
    b.emit({ relDir: '', relDirs: [''] });
    await waitFor(() => expect(b.api.list.mock.calls.filter(([d]) => d === '').length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(b.ignored.mock.calls.length).toBe(before);
  });
});
