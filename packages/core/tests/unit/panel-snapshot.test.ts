/**
 * 049 T004 — the shape of a panel-state hand-off snapshot (data-model *PanelSnapshot*). Main holds
 * renderer-supplied JSON between two windows, so it accepts only what this guard accepts and drops
 * anything over the size cap (contracts/panel-state-handoff.md, main-side rule 2).
 */
import { describe, expect, it } from 'vitest';
import { isPanelSnapshot, MAX_PANEL_SNAPSHOT_BYTES, panelSnapshotBytes } from '@throng/core';

const find = {
  panelId: 'p1',
  panelKind: 'preview',
  replaceShown: false,
  term: 'id',
  replacement: '',
  modes: { caseSensitive: false, wholeWord: false },
  count: { current: 2, total: 5 },
  seeded: false,
  currentFrom: 120,
};
const editor = { selection: { ranges: [{ anchor: 3, head: 9 }], main: 0 }, scrollAnchor: 400 };
const terminal = { offsetFromBottom: 37, selection: { start: { x: 1, y: 4 }, end: { x: 12, y: 4 } } };
const previewSelection = { from: 10, to: 12, text: 'id' };

describe('isPanelSnapshot', () => {
  it('accepts a snapshot with only a panel id', () => {
    expect(isPanelSnapshot({ panelId: 'p1' })).toBe(true);
  });

  it('accepts every section, alone and together', () => {
    expect(isPanelSnapshot({ panelId: 'p1', find })).toBe(true);
    expect(isPanelSnapshot({ panelId: 'p1', editor })).toBe(true);
    expect(isPanelSnapshot({ panelId: 'p1', terminal })).toBe(true);
    expect(isPanelSnapshot({ panelId: 'p1', terminal: { offsetFromBottom: 0 } })).toBe(true);
    expect(isPanelSnapshot({ panelId: 'p1', previewSelection })).toBe(true);
    expect(isPanelSnapshot({ panelId: 'p1', find, editor, terminal, previewSelection })).toBe(true);
  });

  it('accepts a find session whose current match offset is unknown', () => {
    expect(isPanelSnapshot({ panelId: 'p1', find: { ...find, currentFrom: null } })).toBe(true);
  });

  it('rejects anything that is not a plain object with a panel id', () => {
    for (const v of [null, undefined, 42, 'p1', [], {}, { panelId: '' }, { panelId: 7 }]) {
      expect(isPanelSnapshot(v)).toBe(false);
    }
  });

  it('rejects a non-finite number in any section', () => {
    expect(isPanelSnapshot({ panelId: 'p1', editor: { ...editor, scrollAnchor: Number.NaN } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', terminal: { offsetFromBottom: Infinity } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', previewSelection: { ...previewSelection, to: Number.NaN } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', find: { ...find, count: { current: 1, total: Infinity } } })).toBe(false);
  });

  it('rejects a section of the wrong shape', () => {
    expect(isPanelSnapshot({ panelId: 'p1', editor: { selection: { ranges: 'x', main: 0 }, scrollAnchor: 1 } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', editor: { selection: { ranges: [{ anchor: 1 }], main: 0 }, scrollAnchor: 1 } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', terminal: { offsetFromBottom: 1, selection: { start: { x: 1 } } } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', previewSelection: { from: 1, to: 2 } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', find: { ...find, panelKind: 'explorer' } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', find: { ...find, term: 3 } })).toBe(false);
    expect(isPanelSnapshot({ panelId: 'p1', find: { ...find, modes: { caseSensitive: 'yes', wholeWord: false } } })).toBe(false);
  });
});

describe('panelSnapshotBytes', () => {
  it('is the JSON length', () => {
    const s = { panelId: 'p1', previewSelection };
    expect(panelSnapshotBytes(s)).toBe(JSON.stringify(s).length);
  });

  it('caps at 64 KB', () => {
    expect(MAX_PANEL_SNAPSHOT_BYTES).toBe(65536);
  });
});
