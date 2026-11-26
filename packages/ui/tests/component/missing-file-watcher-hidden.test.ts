// Layer: component — the scan's timing and Focus Mode's store are renderer state; a fake clock makes "not yet" exact.
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 081 US2, FR-012 / FR-012a — a panel Focus Mode hides is not named until it is shown, then once (#728).
 *
 * #728 candidate cause: "notices name a panel the user cannot find". Focus Mode is the only way a panel in the
 * shown tab is hidden (research R4). The scan reported every casualty in the tab, so a notice named a panel the
 * user could not see or reach until they left Focus Mode. Q3 settled the fix: defer the report until the panel is
 * next shown, then raise it once.
 */

const workspace = vi.hoisted(() => ({ value: { layout: null as unknown } }));
const reported = vi.hoisted(() => ({ calls: [] as { panelId: string }[] }));

vi.mock('../../src/renderer/state/workspace-store.js', () => ({
  useWorkspace: () => workspace.value,
}));

vi.mock('../../src/renderer/config/config-store.js', () => ({
  useAppSettings: () => ({ editor: { warnOnMissingFile: true } }),
}));

vi.mock('../../src/renderer/workspace/panel-failure-notice.js', () => ({
  useReportPanelFailure: () => (entry: { panelId: string }) => void reported.calls.push(entry),
}));

const { MissingFileWatcher } = await import('../../src/renderer/editor/missing-file-watcher.js');
const { setEditorState, removeEditorState } = await import('../../src/renderer/editor/editor-state.js');
const { maximisePanel, restoreAll } = await import('../../src/renderer/workspace/maximise-store.js');

const TAB = 't1';
const PANELS = ['shown', 'gone'];

function seedTab(): void {
  setEditorState('shown', { filePath: 'C:/proj/shown.txt', displayName: 'shown.txt' });
  setEditorState('gone', { filePath: 'C:/proj/gone.txt', displayName: 'gone.txt', fileMissing: true, unloadable: true });
  workspace.value = {
    layout: {
      activeTabId: TAB,
      tabs: [
        {
          id: TAB,
          title: TAB,
          activePanelId: 'shown',
          root: {
            type: 'split',
            id: 'split',
            direction: 'row',
            children: PANELS.map((id) => ({ type: 'panel', id, kind: 'editor', title: id })),
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  reported.calls = [];
});

afterEach(() => {
  restoreAll(TAB);
  vi.useRealTimers();
  for (const id of PANELS) removeEditorState(id);
  workspace.value = { layout: null };
});

const runScan = (): void => {
  act(() => {
    vi.advanceTimersByTime(400);
  });
};

describe('a panel hidden by Focus Mode (081 FR-012, FR-012a; #728 "a panel the user cannot find")', () => {
  it('raises no notice while hidden, and exactly one when Focus Mode ends', () => {
    maximisePanel(TAB, 'shown'); // `gone` is hidden behind it
    seedTab();
    render(createElement(MissingFileWatcher, null));
    runScan();

    expect(reported.calls, 'the notice names a panel Focus Mode hides').toEqual([]);

    act(() => restoreAll(TAB));
    runScan();
    expect(reported.calls.map((c) => c.panelId)).toEqual(['gone']);

    // Focus Mode again and out again: the deferred report was raised, and is not raised twice.
    act(() => maximisePanel(TAB, 'shown'));
    act(() => restoreAll(TAB));
    runScan();
    expect(reported.calls.map((c) => c.panelId)).toEqual(['gone']);
  });

  it('raises nothing when the file opens before the panel is shown', () => {
    maximisePanel(TAB, 'shown');
    seedTab();
    render(createElement(MissingFileWatcher, null));
    runScan();

    act(() => setEditorState('gone', { fileMissing: false, unloadable: false }));
    act(() => restoreAll(TAB));
    runScan();
    expect(reported.calls).toEqual([]);
  });
});
