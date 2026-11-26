// Layer: component — the stand-in state is published by the real `use-editor` history step, and the scan runs on a real tab change.
import { act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { getEditorState } from '../../src/renderer/editor/editor-state.js';
import { __resetHistoryStore, setPanelHistory } from '../../src/renderer/navigation/history-store.js';
import { useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { mountEditor } from './helpers/mount-editor.js';

/**
 * 081 US2, FR-012 — a path the user only passed through in Back/Forward history raises no tab-open notice (#728).
 *
 * #728 candidate cause: "notices name a panel the user cannot find". A Back step onto a file that is gone puts
 * the panel in the could-not-read state (044 FR-106d): the banner is that condition's one surface, and main keeps
 * the document's `fileMissing` false for it (`editor-coordinator.ts`, 044 FR-105). The renderer set its own
 * `fileMissing` anyway, so the next tab change reported the stand-in as a casualty.
 */

interface Reported {
  panelId: string;
}

const reported = vi.hoisted(() => ({ calls: [] as Reported[] }));

vi.mock('../../src/renderer/workspace/panel-failure-notice.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useReportPanelFailure: () => (entry: Reported) => void reported.calls.push(entry),
}));

/** Past the scan's own 300 ms delay, so it has sampled. */
const PAST_THE_SCAN_MS = 400;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ws: { current: ReturnType<typeof useWorkspace> | null } = { current: null };
function GrabWorkspace(): null {
  ws.current = useWorkspace();
  return null;
}

afterEach(() => {
  reported.calls = [];
  ws.current = null;
  __resetHistoryStore();
  Reflect.deleteProperty(window, 'throng');
});

describe('a Back/Forward stand-in is not a casualty (081 FR-012; #728 "a panel the user cannot find")', () => {
  it('a Back step onto a gone path, then a tab switch away and back, raises no notice', async () => {
    const h = mountEditor({
      doc: { text: 'const b = 1;\n', version: 1, absPath: 'C:/proj/b.ts' },
      withMissingFileWatcher: true,
      extras: [createElement(GrabWorkspace, { key: 'grab' })],
    });
    await waitFor(() => expect(h.calls.verifyPath).toHaveBeenCalled());
    h.pushSync({ verified: true }); // the healthy restore answered
    await sleep(PAST_THE_SCAN_MS);
    expect(reported.calls, 'precondition: the healthy panel was not reported').toEqual([]);

    // Back onto a file that is gone. The harness answers a load of a path it holds nothing for with `io`.
    act(() => setPanelHistory('p-ed', { v: 1, entries: [{ filePath: 'C:/proj/gone.ts' }, { filePath: 'C:/proj/b.ts' }], index: 1 }));
    await act(() =>
      getEditorActions('p-ed')!.openFile('C:/proj/gone.ts', {
        navigation: { kind: 'history', index: 0, filePath: 'C:/proj/gone.ts' },
      }),
    );
    expect(getEditorState('p-ed')?.unloadable, 'precondition: the stand-in shows the could-not-read banner').toBe(true);

    // A tab switch away and back: the scan re-arms on each change.
    let other = '';
    act(() => {
      other = ws.current!.addTab();
    });
    act(() => ws.current!.setActiveTab(other));
    await sleep(PAST_THE_SCAN_MS);
    act(() => ws.current!.setActiveTab('t1'));
    await sleep(PAST_THE_SCAN_MS);

    expect(
      reported.calls.filter((c) => c.panelId === 'p-ed'),
      'the stand-in was reported as a file the user cannot open',
    ).toEqual([]);
  });
});
