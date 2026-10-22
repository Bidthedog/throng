/**
 * A completed MOVE never leaves its source row behind (050 FR-025b; gate flake on
 * `explorer-keyboard-selection.e2e.ts:53`, release.yml run 39514654648).
 *
 * Layer: component — the defect is the order in which the tree merges two listings of one folder; only
 * a rendered tree over a controllable `files.list` can hold that order still. No real disk or app needed.
 *
 * The E2E cut `a.txt` from the root and pasted it into `sub`. The moved row appeared under `sub`,
 * selected — and the ORIGINAL root-level row stayed in the tree for the whole timeout: a ghost.
 *
 * The mechanism, held still here: a re-read of the root that was ISSUED before the move (a watcher
 * report, coalesced and dispatched just ahead of the paste) is still in flight when the move lands. The
 * paste's own re-read of the root is issued after the move, answers first, and removes the row. Then
 * the older read answers and its pre-move listing is merged over the newer one. Nothing re-reads the
 * root again, so the row it put back stays until something unrelated touches the folder.
 */
import { act, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  entry,
  installResizeObserver,
  mountExplorer,
  standardHost,
  uninstallResizeObserver,
} from './helpers/explorer-harness.js';
import { TransferCompletionHost } from '../../src/renderer/explorer/transfer-completion.js';
import { resetPendingRevealForTests } from '../../src/renderer/explorer/pending-reveal.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';

beforeAll(installResizeObserver);
afterAll(uninstallResizeObserver);
beforeEach(() => {
  localStorage.clear();
  resetPendingRevealForTests();
});
afterEach(() => {
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

const ROOT = 'C:/projects/demo';

const rowsLabelled = (tree: HTMLElement, label: string): HTMLElement[] =>
  within(tree)
    .queryAllByRole('treeitem')
    .filter((r) => r.querySelector('.tree-label')?.textContent === label);

describe('a completed move and a root listing read before it (050 FR-025b)', () => {
  it('drops a listing issued BEFORE the move when it answers after a newer one', async () => {
    const m = await mountExplorer(standardHost, {
      extra: createElement(TransferCompletionHost),
      listing: {
        '': [entry('sub', 'folder'), entry('a.txt', 'file'), entry('b.txt', 'file')],
        sub: [],
      },
    });
    await waitFor(() => expect(rowsLabelled(m.tree, 'a.txt')).toHaveLength(1));

    // Hold the NEXT listing of the root. It is answered with what the disk held when it was ISSUED
    // — exactly what a readdir dispatched before the rename returns — but only when released.
    let releaseStale: (() => void) | null = null;
    const original = m.files.files.list.getMockImplementation()!;
    m.files.files.list.mockImplementation((relDir: string) => {
      if (relDir !== '' || releaseStale) return original(relDir);
      const snapshot: FileTreeEntry[] = [...(m.files.dirs.get('') ?? [])];
      return new Promise((resolve) => {
        releaseStale = () => resolve({ entries: snapshot });
      });
    });

    // A watcher report naming the root, landing just ahead of the paste.
    const onChange = m.files.files.onChange.mock.calls[0]![0] as (evt: {
      relDir: string;
      relDirs?: string[];
    }) => void;
    act(() => onChange({ relDir: '', relDirs: [''] }));
    await waitFor(() => expect(releaseStale).not.toBeNull()); // the pre-move read is in flight

    // The move lands on disk, and the paste reports it done.
    m.files.dirs.set('', [entry('sub', 'folder'), entry('b.txt', 'file')]);
    m.files.dirs.set('sub', [entry('a.txt', 'file')]);
    m.transfer.done({
      jobId: 'job-1',
      targetProjectId: 'project-a',
      placed: [`${ROOT}/sub/a.txt`],
      undo: { kind: 'move', items: [{ from: `${ROOT}/a.txt`, to: `${ROOT}/sub/a.txt` }] },
    });

    // The paste's own (newer) re-read and the reveal have both landed: one a.txt, a level down.
    await waitFor(() => {
      const rows = rowsLabelled(m.tree, 'a.txt');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.getAttribute('aria-level')).toBe('3');
    });

    // Only now does the read issued BEFORE the move answer.
    await act(async () => {
      releaseStale!();
      await new Promise((r) => setTimeout(r, 50));
    });

    const rows = rowsLabelled(m.tree, 'a.txt');
    expect(rows.map((r) => r.getAttribute('aria-level'))).toEqual(['3']);
  });
});
