import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, type NavigationHistory, type PersistedHistory } from '@throng/core';
import { NavigationHistoryService } from '../../src/main/navigation-history-service.js';
import { createHistoryPush } from '../../src/main/navigation-history-ipc.js';

/**
 * 044 T137 — `NavigationHistoryService`, the ONE owner of every editor and preview panel's history
 * (contracts/navigation-history.md §1, data-model §11, Principle XI).
 *
 * Driven through the REAL broadcast (`createHistoryPush`) onto fake windows, so "changed reaches every
 * window" is asserted where it is true — at the windows — rather than as a callback having been called.
 * Two windows here stand for the main window and a sub-workspace, one of which may hold the panel in a
 * background tab it has detached from.
 */

function fakeWindow(id: number) {
  const changed: Array<{ panelId: string; history: NavigationHistory }> = [];
  const contents = {
    id,
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => {
      if (channel === 'throng:history:changed') changed.push(payload as { panelId: string; history: NavigationHistory });
    },
  };
  return { changed, window: { isDestroyed: () => false, webContents: contents } };
}

const A = 'D:/p/a.md';
const B = 'D:/p/b.md';
const C = 'D:/p/c.md';
const D = 'D:/p/d.md';
const E = 'D:/p/e.md';

const persisted = (paths: string[], index: number): PersistedHistory => ({
  v: 1,
  entries: paths.map((filePath) => ({ filePath })),
  index,
});

const pathsOf = (h: NavigationHistory | undefined) => h?.entries.map((e) => e.filePath);

let cap: number;
let main: ReturnType<typeof fakeWindow>;
let sub: ReturnType<typeof fakeWindow>;
let service: NavigationHistoryService;

beforeEach(() => {
  cap = 10;
  main = fakeWindow(1);
  sub = fakeWindow(2);
  const push = createHistoryPush({ all: () => [main.window, sub.window] });
  service = new NavigationHistoryService({ cap: () => cap, broadcastChanged: push.broadcastChanged });
});

describe('attach — adopt if absent (FR-109, FR-110)', () => {
  it('a first attach parses the persisted history tolerantly and keeps it as the record', () => {
    const raw = {
      v: 1,
      entries: [{ filePath: A }, { nope: true }, { filePath: B }, { filePath: '' }],
      index: 3,
    } as unknown as PersistedHistory;

    const h = service.attach('ed1', 'editor', raw);

    expect(pathsOf(h)).toEqual([A, B]);
    expect(h.index).toBe(1);
    expect(service.get('ed1')).toBe(h);
  });

  it('a first attach with no persisted history starts empty', () => {
    expect(service.attach('ed1', 'editor', undefined)).toEqual(EMPTY_HISTORY);
  });

  it('two windows attaching one panel share ONE record, and changed reaches every window (FR-110, FR-112)', () => {
    const first = service.attach('pv1', 'preview', persisted([A, B], 1));
    // The second window's copy of the layout is older — it must not win.
    const second = service.attach('pv1', 'preview', persisted([C], 0));

    expect(second).toBe(first);
    expect(pathsOf(service.get('pv1'))).toEqual([A, B]);
    for (const w of [main, sub]) {
      expect(w.changed.at(-1)).toEqual({ panelId: 'pv1', history: first });
    }
  });

  it('a second attach after Send to Tab adopts the existing record unchanged rather than resetting it', () => {
    service.attach('ed1', 'editor', undefined);
    service.recordOpen('ed1', A);
    service.recordOpen('ed1', B);
    const before = service.get('ed1');

    // The remount in the new tab carries the layout's copy, which was written before B was opened.
    const after = service.attach('ed1', 'editor', persisted([A], 0));

    expect(after).toBe(before);
    expect(pathsOf(after)).toEqual([A, B]);
  });

  it('a history is per panel: one panel’s changes never touch another’s (FR-112)', () => {
    service.attach('ed1', 'editor', persisted([A, B], 1));
    const other = service.attach('ed2', 'editor', persisted([C, D], 1));

    service.moveTo('ed1', 0, A);
    service.recordOpen('ed1', E);

    expect(service.get('ed2')).toBe(other);
  });
});

describe('recording and moving', () => {
  it('recordOpen for a panel with no record creates an editor record whose first entry is the file (FR-103a)', () => {
    service.recordOpen('ed1', A);
    expect(pathsOf(service.get('ed1'))).toEqual([A]);
    expect(main.changed.at(-1)).toEqual({ panelId: 'ed1', history: service.get('ed1') });
  });

  it('recordOpen of the current file changes nothing and broadcasts nothing (FR-103)', () => {
    service.recordOpen('ed1', A);
    const before = service.get('ed1');
    const sent = main.changed.length;

    service.recordOpen('ed1', 'd:\\p\\A.md');

    expect(service.get('ed1')).toBe(before);
    expect(main.changed).toHaveLength(sent);
  });

  it('moveTo moves only when the entry still names the file the caller asked for', () => {
    service.attach('ed1', 'editor', persisted([A, B, C], 2));
    const entries = service.get('ed1')!.entries;

    expect(service.moveTo('ed1', 0, B)).toBe(false);
    expect(service.get('ed1')!.index).toBe(2);

    expect(service.moveTo('ed1', 0, A)).toBe(true);
    expect(service.get('ed1')!.index).toBe(0);
    expect(service.get('ed1')!.entries).toBe(entries); // FR-102: the list itself is untouched
    expect(main.changed.at(-1)?.history.index).toBe(0);
  });

  it('recordOpen carrying a persisted history adopts it when absent, records on top, and broadcasts ONCE (§6, amended)', () => {
    service.recordOpen('ed1', C, persisted([A, B], 1));

    expect(pathsOf(service.get('ed1'))).toEqual([A, B, C]);
    expect(main.changed).toEqual([{ panelId: 'ed1', history: service.get('ed1') }]);
  });

  it('recordOpen of the persisted current file adopts the history unchanged and still announces it once', () => {
    service.recordOpen('ed1', B, persisted([A, B], 1));

    expect(pathsOf(service.get('ed1'))).toEqual([A, B]);
    expect(service.get('ed1')!.index).toBe(1);
    expect(main.changed).toEqual([{ panelId: 'ed1', history: service.get('ed1') }]);
  });

  it('a persisted history is ignored when the panel already has a record (adopt if ABSENT)', () => {
    service.recordOpen('ed1', A);
    service.recordOpen('ed1', D, persisted([B, C], 1));
    expect(pathsOf(service.get('ed1'))).toEqual([A, D]);
  });

  it('moveTo carrying a persisted history adopts it first, then moves against it', () => {
    expect(service.moveTo('ed1', 0, A, persisted([A, B], 1))).toBe(true);
    expect(pathsOf(service.get('ed1'))).toEqual([A, B]);
    expect(service.get('ed1')!.index).toBe(0);
    expect(main.changed).toHaveLength(1);
  });

  it('recordOpen applies the live cap as it appends (FR-108)', () => {
    cap = 2;
    for (const p of [A, B, C]) service.recordOpen('ed1', p);
    expect(pathsOf(service.get('ed1'))).toEqual([B, C]);
  });
});

describe('setCurrentViewState — preview entries only (FR-101, FR-107)', () => {
  it('stores on the current entry of a preview', () => {
    service.attach('pv1', 'preview', persisted([A, B], 0));
    service.setCurrentViewState('pv1', { line: 12 });
    expect(service.get('pv1')!.entries[0]).toEqual({ filePath: A, viewState: { line: 12 } });
    expect(service.get('pv1')!.entries[1]).toEqual({ filePath: B });
  });

  it('never gives an editor entry a view state (H10)', () => {
    service.attach('ed1', 'editor', persisted([A], 0));
    const before = service.get('ed1');
    service.setCurrentViewState('ed1', { line: 12 });
    expect(service.get('ed1')).toBe(before);
  });
});

describe('recordJump — a same-document heading, preview records only (FR-115, data-model §14.3)', () => {
  const TOP = { line: 0, offsetRatio: 0 };
  const AT_12 = { line: 12, offsetRatio: 0 };

  it('on a preview record appends a same-file entry at arriving and broadcasts changed ONCE, to every window', () => {
    service.attach('pv1', 'preview', persisted([A, B], 1));
    main.changed.length = 0;
    sub.changed.length = 0;

    service.recordJump('pv1', TOP, AT_12);

    expect(service.get('pv1')).toEqual({
      entries: [{ filePath: A }, { filePath: B, viewState: TOP }, { filePath: B, viewState: AT_12 }],
      index: 2,
    });
    for (const w of [main, sub]) expect(w.changed).toEqual([{ panelId: 'pv1', history: service.get('pv1') }]);
  });

  it('applies the live cap as it appends (FR-108)', () => {
    service.attach('pv1', 'preview', persisted([A, B], 1));
    cap = 2;
    service.recordJump('pv1', TOP, AT_12);
    expect(pathsOf(service.get('pv1'))).toEqual([B, B]);
  });

  it('on an EDITOR record is a no-op with no broadcast (H10: editor entries never carry a place)', () => {
    service.attach('ed1', 'editor', persisted([A], 0));
    const before = service.get('ed1');
    main.changed.length = 0;

    service.recordJump('ed1', TOP, AT_12);

    expect(service.get('ed1')).toBe(before);
    expect(main.changed).toEqual([]);
  });

  it('for a panel with no record creates none and broadcasts nothing', () => {
    service.recordJump('nobody', TOP, AT_12);
    expect(service.get('nobody')).toBeUndefined();
    expect(main.changed).toEqual([]);
  });

  it('an equal jump broadcasts only the leaving place when it is new, and nothing when it is not', () => {
    service.attach('pv1', 'preview', persisted([A], 0));
    main.changed.length = 0;

    service.recordJump('pv1', AT_12, { line: 12, offsetRatio: 0 });
    expect(service.get('pv1')).toEqual({ entries: [{ filePath: A, viewState: AT_12 }], index: 0 });
    expect(main.changed).toHaveLength(1);

    service.recordJump('pv1', AT_12, AT_12);
    expect(main.changed).toHaveLength(1);
  });
});

describe('purge (FR-110)', () => {
  it('drops the record and tells every window with a NULL history — never an empty one a first attach could send (§2)', () => {
    service.attach('pv1', 'preview', persisted([A, B], 1));

    service.purge('pv1');

    expect(service.get('pv1')).toBeUndefined();
    for (const w of [main, sub]) expect(w.changed.at(-1)).toEqual({ panelId: 'pv1', history: null });
  });

  it('is idempotent: purging an unknown panel broadcasts nothing', () => {
    service.purge('nobody');
    expect(main.changed).toEqual([]);
  });

  it('an attach after a purge starts from what it brings, not from the purged record', () => {
    service.attach('ed1', 'editor', persisted([A, B], 1));
    service.purge('ed1');
    expect(pathsOf(service.attach('ed1', 'editor', persisted([C], 0)))).toEqual([C]);
  });
});

describe('applyCap — a historySize change reaches every record at once (FR-108)', () => {
  it('drops oldest first, never the current entry, and broadcasts only the records that changed', () => {
    service.attach('ed1', 'editor', persisted([A, B, C, D, E], 4));
    service.attach('pv1', 'preview', persisted([A, B, C, D, E], 0));
    service.attach('ed2', 'editor', persisted([A], 0));
    const untouched = service.get('ed2');
    main.changed.length = 0;

    cap = 2;
    service.applyCap();

    expect(pathsOf(service.get('ed1'))).toEqual([D, E]);
    expect(service.get('ed1')!.index).toBe(1);
    // The current entry is the OLDEST here, so the newest go instead.
    expect(pathsOf(service.get('pv1'))).toEqual([A, B]);
    expect(service.get('pv1')!.index).toBe(0);
    expect(service.get('ed2')).toBe(untouched);
    expect(main.changed.map((c) => c.panelId).sort()).toEqual(['ed1', 'pv1']);
  });
});

describe('path changes (FR-109, R14)', () => {
  it('rewritePaths follows a moved file and folder in EVERY record, mounted anywhere or nowhere', () => {
    // No window has attached `ed-bg` since restart — it is a record, and that is all the service needs.
    service.attach('ed1', 'editor', persisted([A, 'D:/p/docs/x.md'], 1));
    service.attach('ed-bg', 'editor', persisted(['D:/p/docs/y.md'], 0));
    service.attach('pv1', 'preview', persisted([C], 0));
    const untouched = service.get('pv1');
    main.changed.length = 0;
    sub.changed.length = 0;

    service.rewritePaths([
      { from: A, to: 'D:/p/moved/a.md' },
      { from: 'D:/p/docs', to: 'D:/p/manual' },
    ]);

    expect(pathsOf(service.get('ed1'))).toEqual(['D:/p/moved/a.md', 'D:/p/manual/x.md']);
    expect(service.get('ed1')!.index).toBe(1);
    expect(pathsOf(service.get('ed-bg'))).toEqual(['D:/p/manual/y.md']);
    expect(service.get('pv1')).toBe(untouched);
    expect(main.changed.map((c) => c.panelId).sort()).toEqual(['ed-bg', 'ed1']);
    expect(sub.changed.map((c) => c.panelId).sort()).toEqual(['ed-bg', 'ed1']);
  });

  it('rewriteCurrent on an editor’s Save-As re-point replaces the current entry — no second entry', () => {
    service.attach('ed1', 'editor', persisted([A, B], 1));

    service.rewriteCurrent('ed1', C);

    expect(pathsOf(service.get('ed1'))).toEqual([A, C]);
    expect(service.get('ed1')!.index).toBe(1);
    expect(main.changed.at(-1)).toEqual({ panelId: 'ed1', history: service.get('ed1') });
  });

  it('rewritePaths moves a preview’s jump chain whole — the two places in one file are not fused (H2a, FR-115)', () => {
    service.attach('pv1', 'preview', persisted([A], 0));
    service.recordJump('pv1', { line: 0, offsetRatio: 0 }, { line: 9, offsetRatio: 0 });

    service.rewritePaths([{ from: A, to: C }]);

    expect(service.get('pv1')).toEqual({
      entries: [
        { filePath: C, viewState: { line: 0, offsetRatio: 0 } },
        { filePath: C, viewState: { line: 9, offsetRatio: 0 } },
      ],
      index: 1,
    });
  });

  it('rewriteCurrent on a panel with no history yet — a new document’s first Save As — records it (H8)', () => {
    service.rewriteCurrent('ed-new', C);
    expect(pathsOf(service.get('ed-new'))).toEqual([C]);
  });
});
