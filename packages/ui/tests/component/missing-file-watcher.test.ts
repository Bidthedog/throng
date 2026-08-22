import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The tab-open "could not open" scan (006 FR-100/FR-105 · 030 FR-029/FR-035).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-missing-aggregate.e2e.ts` (035 T055):
 *   - `:78`  lists ALL missing files on a tab in one notice (FR-100 · 030 FR-029/FR-035)
 *   - `:318` does NOT raise the notice on delete / remount while the tab stays active (FR-105)
 *   - `:355` editor.warnOnMissingFile=false suppresses the report entirely
 *
 * ══ WHAT THOSE THREE COST, AND WHY IT WAS THE WRONG PRICE ══
 *
 * Three Electron launches, three temp projects, real files deleted through a real context menu into
 * the real recycle bin, and a watcher round trip — to observe a `useEffect` that compares one string
 * with the string it saw last time and calls a callback per missing editor.
 *
 * Two of them also carried a 700 ms `sleep-justified` wait, and the justification was honest: with
 * the setting off, or with the tab never re-selected, there is NOTHING observable that separates
 * "the scan ran and reported nothing" from "the scan has not run yet". That is a real problem when
 * the scan is behind an app; here the timer is fake and the distinction is exact.
 *
 * `MissingFileWatcher` had no test of any kind — only `notice-supersede.test.ts` names the file, and
 * that one is about the cause key it emits rather than about when it emits at all.
 *
 * ══ WHAT IS NOT HERE ══
 *
 * That two reports MERGE into one notice. The E2E asserted `panel-failure-notice` has count 1, and
 * that is the notification model's rule, not this component's — the watcher's own job is to report
 * each casualty separately, which is exactly what FR-035 changed it to do. `editor-missing-aggregate`
 * keeps a test for the merge, over a real deletion.
 */

/* ────────────────────────────────────────────────────────────────────────── *
 * The three seams the watcher reads
 * ────────────────────────────────────────────────────────────────────────── */

const workspace = vi.hoisted(() => ({ value: { layout: null as unknown } }));
const settings = vi.hoisted(() => ({ warnOnMissingFile: true }));
const reported = vi.hoisted(() => ({ calls: [] as { panelId: string; causeKind?: string }[] }));

vi.mock('../../src/renderer/state/workspace-store.js', () => ({
  useWorkspace: () => workspace.value,
}));

vi.mock('../../src/renderer/config/config-store.js', () => ({
  useAppSettings: () => ({ editor: settings }),
}));

vi.mock('../../src/renderer/workspace/panel-failure-notice.js', () => ({
  useReportPanelFailure: () => (entry: { panelId: string; causeKind?: string }) =>
    void reported.calls.push(entry),
}));

const { MissingFileWatcher } = await import('../../src/renderer/editor/missing-file-watcher.js');
const { setEditorState, removeEditorState } = await import(
  '../../src/renderer/editor/editor-state.js'
);

/* ────────────────────────────────────────────────────────────────────────── *
 * The fixture
 * ────────────────────────────────────────────────────────────────────────── */

interface PanelSpec {
  id: string;
  kind?: string;
  missing?: boolean;
  /** The AUTHORITY's verdict on the path, as a restored panel receives it (#277). */
  unloadable?: boolean;
}

/** A tab holding `panels` side by side, and the editor states they publish. */
function tab(id: string, panels: PanelSpec[]): Record<string, unknown> {
  for (const p of panels) {
    setEditorState(p.id, {
      filePath: `C:/proj/${p.id}.txt`,
      displayName: `${p.id}.txt`,
      fileMissing: p.missing ?? false,
      unloadable: p.unloadable ?? false,
    });
  }
  return {
    id,
    title: id,
    activePanelId: panels[0]?.id,
    root:
      panels.length === 1
        ? { type: 'panel', id: panels[0].id, kind: panels[0].kind ?? 'editor', title: panels[0].id }
        : {
            type: 'split',
            id: `${id}-split`,
            direction: 'row',
            children: panels.map((p) => ({
              type: 'panel',
              id: p.id,
              kind: p.kind ?? 'editor',
              title: p.id,
            })),
          },
  };
}

function setLayout(tabs: Record<string, unknown>[], activeTabId: string): void {
  workspace.value = { layout: { tabs, activeTabId } };
}

const seeded: string[] = [];
function seed(id: string, panels: PanelSpec[]): Record<string, unknown> {
  for (const p of panels) seeded.push(p.id);
  return tab(id, panels);
}

beforeEach(() => {
  vi.useFakeTimers();
  reported.calls = [];
  settings.warnOnMissingFile = true;
  workspace.value = { layout: null };
});

afterEach(() => {
  vi.useRealTimers();
  for (const id of seeded.splice(0)) removeEditorState(id);
});

const mount = () => render(createElement(MissingFileWatcher, null));

/** The scan is deliberately deferred, to let the tab's editors mount and publish. */
const runScan = (): void => {
  vi.advanceTimersByTime(400);
};

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-100 — every casualty on the tab, not the first one
 * ────────────────────────────────────────────────────────────────────────── */

describe('activating a tab reports EVERY editor whose file is gone (FR-100)', () => {
  it('reports both of two missing editors, naming each panel', () => {
    // The E2E's fixture: two editors on one tab, both files deleted underneath them.
    setLayout([seed('t1', [{ id: 'a', missing: true }, { id: 'b', missing: true }])], 't1');
    mount();
    runScan();

    expect(reported.calls.map((c) => c.panelId).sort()).toEqual(['a', 'b']);
  });

  it('says WHAT KIND of failure it is, so the notice can supersede the tree’s report', () => {
    // Without `path-missing` the notice has no cause key, and one renamed folder produced two
    // notices 265 ms apart — measured, and the reason this field exists (FR-029).
    setLayout([seed('t1', [{ id: 'a', missing: true }])], 't1');
    mount();
    runScan();

    expect(reported.calls).toHaveLength(1);
    expect(reported.calls[0].causeKind).toBe('path-missing');
  });

  it('leaves a healthy editor beside a missing one alone', () => {
    setLayout([seed('t1', [{ id: 'ok' }, { id: 'gone', missing: true }])], 't1');
    mount();
    runScan();

    expect(reported.calls.map((c) => c.panelId)).toEqual(['gone']);
  });

  it('reports nothing at all when every file is there', () => {
    setLayout([seed('t1', [{ id: 'a' }, { id: 'b' }])], 't1');
    mount();
    runScan();

    expect(reported.calls).toEqual([]);
  });

  it('reports a panel the AUTHORITY judged unreadable, not only one that failed its own load (#277)', () => {
    /*
     * ══ ISSUE #277 — WHY THE CONSOLIDATED NOTICE NEVER APPEARED ══
     *
     * Two flags can say a panel is defeated by its path, and they are deliberately distinct:
     *
     *   `fileMissing` — a view ATTEMPTED A LOAD and was refused.
     *   `unloadable`  — the AUTHORITY decided the path is unreadable, and broadcast it.
     *
     * Restoring a persisted panel after a restart takes neither of the load paths. It adopts the
     * authority's state through `getContent` — where `fileMissing` is still false, because nothing
     * has touched the disk yet — and returns. The verification it then requests comes back on the
     * sync channel as `unloadable: true`, which raises the in-panel banner, and nothing ever writes
     * `fileMissing`.
     *
     * So on a cold open into a project whose root had been renamed away, this scan skipped every
     * panel. Measured with a probe against the real app: two panels, both `hasState: true`, both
     * `unloadable: true`, both `fileMissing: false`, zero reports — while the user was looking at
     * two per-panel banners saying the files could not be read.
     *
     * That is the whole of #277: FR-034a's consolidated notice cannot supersede the file tree's
     * report of the same absent folder if it is never raised.
     *
     * The E2E `editor-missing-aggregate.e2e.ts` covers the same defect over a real restart and a
     * real rename; this is the same claim at the layer that actually decides it.
     */
    setLayout([seed('t1', [{ id: 'restored', unloadable: true }])], 't1');
    mount();
    runScan();

    expect(reported.calls.map((c) => c.panelId)).toEqual(['restored']);
    expect(reported.calls[0].causeKind).toBe('path-missing');
  });

  it('scans only EDITOR panels — a terminal has no file to be missing', () => {
    setLayout([seed('t1', [{ id: 'term', kind: 'terminal', missing: true }])], 't1');
    mount();
    runScan();

    expect(reported.calls).toEqual([]);
  });

  it('does not report an editor on an INACTIVE tab', () => {
    // The scan discovers the casualties in the tab being activated. A tab nothing has rendered is
    // exactly what it is for, but it is reached by activating it, not by existing.
    const active = seed('t1', [{ id: 'a' }]);
    const other = seed('t2', [{ id: 'b', missing: true }]);
    setLayout([active, other], 't1');
    mount();
    runScan();

    expect(reported.calls).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-105 — once per ACTIVATION, and not once per render
 * ────────────────────────────────────────────────────────────────────────── */

describe('the scan fires on a tab CHANGE and on nothing else (FR-105)', () => {
  it('does not re-report when the tab stays active and a file goes missing under it', () => {
    /*
     * THE RULE THIS COMPONENT EXISTS FOR. Dragging or moving a panel remounts its editor without
     * changing the active tab, and a warning fired from each editor's own mount effect would
     * re-warn on every such move. So the scan lives here, keyed on the tab.
     *
     * The E2E proved it by deleting a real file and then waiting 700 ms for a notice that never
     * came — the only way to distinguish "did not fire" from "has not fired yet" when the clock is
     * real. Here the clock is not.
     *
     * ══ IT IS GUARDED TWICE, AND NEITHER GUARD ALONE CAN BE RED-PROVEN ══
     *
     * The dependency array is `[activeTabId, warn]`, so a layout change re-renders this component
     * without re-running the effect at all. And the effect's first line returns when the tab has
     * not moved, so it would refuse even if it did re-run. Removing EITHER leaves this test green;
     * only removing BOTH reddens it — measured, both ways round.
     *
     * That is over-determination, not a hole, and it is written down rather than rounded away
     * because the two lines look redundant to a reader and one of them will eventually be deleted
     * as tidying. The test survives that deletion, which is the useful property: it fails on the
     * pair, so the second removal is the one that turns red.
     */
    setLayout([seed('t1', [{ id: 'a' }])], 't1');
    const { rerender } = mount();
    runScan();
    expect(reported.calls).toEqual([]);

    // The file goes away while the tab stays active, exactly as a delete does — and the LAYOUT is
    // rebuilt around it, exactly as a panel drag or a remount rebuilds it.
    setEditorState('a', { fileMissing: true });
    setLayout([tab('t1', [{ id: 'a', missing: true }])], 't1');
    rerender(createElement(MissingFileWatcher, null));
    runScan();

    expect(reported.calls, 'the tab never changed, so the scan never ran again').toEqual([]);
  });

  it('DOES report once the tab is re-selected — so the silence above is not vacuous', () => {
    const t1 = seed('t1', [{ id: 'a', missing: true }]);
    const t2 = seed('t2', [{ id: 'b' }]);
    setLayout([t1, t2], 't1');
    const { rerender } = mount();
    runScan();
    expect(reported.calls.map((c) => c.panelId)).toEqual(['a']);

    // …away, and back. Re-selection is an activation, and it scans again.
    reported.calls = [];
    setLayout([t1, t2], 't2');
    rerender(createElement(MissingFileWatcher, null));
    runScan();
    setLayout([t1, t2], 't1');
    rerender(createElement(MissingFileWatcher, null));
    runScan();

    expect(reported.calls.map((c) => c.panelId)).toEqual(['a']);
  });

  it('does not scan a tab that was left before the delay elapsed', () => {
    /*
     * The scan is deferred so the tab's editors can mount and publish their load state. A user
     * clicking through three tabs faster than that would otherwise get three tabs' worth of reports
     * for two tabs they never looked at — which is what the effect's `clearTimeout` prevents.
     */
    const t1 = seed('t1', [{ id: 'a', missing: true }]);
    const t2 = seed('t2', [{ id: 'b' }]);
    setLayout([t1, t2], 't1');
    const { rerender } = mount();

    vi.advanceTimersByTime(100); // …less than the delay
    setLayout([t1, t2], 't2');
    rerender(createElement(MissingFileWatcher, null));
    runScan();

    expect(reported.calls, 't1 was gone before its scan was due').toEqual([]);
  });

  it('does not scan at all before the delay elapses', () => {
    setLayout([seed('t1', [{ id: 'a', missing: true }])], 't1');
    mount();

    vi.advanceTimersByTime(100);
    expect(reported.calls).toEqual([]);

    runScan();
    expect(reported.calls).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The setting
 * ────────────────────────────────────────────────────────────────────────── */

describe('editor.warnOnMissingFile turns the whole thing off', () => {
  it('reports nothing with the setting off, however many files are gone', () => {
    settings.warnOnMissingFile = false;
    setLayout([seed('t1', [{ id: 'a', missing: true }, { id: 'b', missing: true }])], 't1');
    mount();
    runScan();

    expect(reported.calls).toEqual([]);
  });

  it('starts reporting when the setting is turned back on mid-tab (#288)', () => {
    /*
     * ══ ISSUE #288 — THE `warn` DEPENDENCY WAS INERT, AND THIS IS THE REPRODUCTION ══
     *
     * The effect's dependency list is `[activeTabId, warn]`, hand-written under an
     * `eslint-disable exhaustive-deps` — so `warn` is there deliberately, and the only reason to put
     * it there is for the effect to re-run when the setting changes.
     *
     * It could not. The effect's FIRST line was `if (activeTabId === prev.current) return;`, and on
     * a `warn`-only change the tab has not moved, so it returned before `warn` was ever consulted.
     * The dependency was dead: the setting took effect the next time the user switched tabs, and
     * not before.
     *
     * 035 recorded that as a characterisation test — asserting the behaviour the code HAD, with a
     * note saying the product decision was owed. #288 is that decision, and it went the way the
     * dependency list always implied: a user who turns the warning back on while looking at a tab
     * is asking about the tab they are looking at.
     *
     * The guard itself is still required, and the test above is what protects it: a layout rebuild
     * on an unchanged tab must NOT re-report. So the fix cannot be "delete the early return" — it
     * has to distinguish a tab that did not move from a setting that did.
     */
    settings.warnOnMissingFile = false;
    setLayout([seed('t1', [{ id: 'a', missing: true }])], 't1');
    const { rerender } = mount();
    runScan();
    expect(reported.calls).toEqual([]);

    settings.warnOnMissingFile = true;
    rerender(createElement(MissingFileWatcher, null));
    runScan();

    expect(
      reported.calls.map((c) => c.panelId),
      'turning the warning back on scans the tab the user is looking at',
    ).toEqual(['a']);
  });

  it('…and honours the setting from the next activation onward', () => {
    // The same sequence, with a tab change after the setting is restored. This is the route by
    // which the setting does take effect, and it is what makes the test above a latency finding
    // rather than a broken setting.
    settings.warnOnMissingFile = false;
    const t1 = seed('t1', [{ id: 'a', missing: true }]);
    const t2 = seed('t2', [{ id: 'b' }]);
    setLayout([t1, t2], 't1');
    const { rerender } = mount();
    runScan();
    expect(reported.calls).toEqual([]);

    settings.warnOnMissingFile = true;
    setLayout([t1, t2], 't2');
    rerender(createElement(MissingFileWatcher, null));
    runScan();
    setLayout([t1, t2], 't1');
    rerender(createElement(MissingFileWatcher, null));
    runScan();

    expect(reported.calls.map((c) => c.panelId)).toEqual(['a']);
  });
});
