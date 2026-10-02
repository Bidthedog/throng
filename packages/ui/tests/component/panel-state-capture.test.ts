/**
 * 049 T010 — the renderer's side of the cross-window panel-state hand-off (research R3,
 * contracts/panel-state-handoff.md): composing a `PanelSnapshot` per panel from the live captures and the
 * saved view state of an unmounted panel, and seeding a received snapshot into this window's stores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelSnapshot } from '@throng/core';
import {
  claimAndSeedPanelState,
  registerPanelStateCapture,
  seedPanelState,
  stashPanelState,
} from '../../src/renderer/workspace/panel-state-capture.js';
import {
  clearEditorViewState,
  peekEditorViewState,
  saveEditorViewState,
} from '../../src/renderer/editor/editor-view-state.js';
import {
  clearTerminalViewState,
  peekTerminalViewState,
  saveTerminalViewState,
} from '../../src/renderer/terminal/terminal-view-state.js';
import {
  __resetFindState,
  closeFind,
  getFindSession,
  openFind,
  setTerm,
} from '../../src/renderer/search/search-store.js';
import { registerPanelSearch, unregisterPanelSearch } from '../../src/renderer/search/search-controller.js';

const EDITOR = { selection: { ranges: [{ anchor: 3, head: 9 }], main: 0 }, scrollAnchor: 120 };
const TERMINAL = { offsetFromBottom: 40, selection: { start: { x: 1, y: 2 }, end: { x: 5, y: 2 } } };

describe('panel state capture (049 T010)', () => {
  let stash: ReturnType<typeof vi.fn>;
  let claim: ReturnType<typeof vi.fn>;
  const unregister: (() => void)[] = [];

  beforeEach(() => {
    stash = vi.fn(async () => undefined);
    claim = vi.fn(async () => ({}));
    const w = window as unknown as { throng?: Record<string, unknown> };
    w.throng = { ...(w.throng ?? {}), panelState: { stash, claim } };
    __resetFindState();
  });
  afterEach(() => {
    unregister.splice(0).forEach((u) => u());
    for (const id of ['p1', 'p2']) {
      clearEditorViewState(id);
      clearTerminalViewState(id);
    }
    closeFind('p1');
    __resetFindState();
  });

  it('sends one snapshot per id, composed from every registered live section', async () => {
    unregister.push(registerPanelStateCapture('p1', 'editor', () => EDITOR));
    unregister.push(registerPanelStateCapture('p2', 'terminal', () => TERMINAL));
    await stashPanelState(['p1', 'p2']);
    expect(stash).toHaveBeenCalledTimes(1);
    const sent = stash.mock.calls[0]![0] as PanelSnapshot[];
    expect(sent).toEqual([
      { panelId: 'p1', editor: EDITOR },
      { panelId: 'p2', terminal: TERMINAL },
    ]);
  });

  it('sends an empty-sectioned snapshot for a panel with nothing to say', async () => {
    await stashPanelState(['p1']);
    expect(stash.mock.calls[0]![0]).toEqual([{ panelId: 'p1' }]);
  });

  it('prefers a live capture over the peeked saved entry of an unmounted panel', async () => {
    saveEditorViewState('p1', { selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 }, scrollAnchor: 0 });
    unregister.push(registerPanelStateCapture('p1', 'editor', () => EDITOR));
    await stashPanelState(['p1']);
    expect((stash.mock.calls[0]![0] as PanelSnapshot[])[0]!.editor).toEqual(EDITOR);
  });

  it('falls back to the peeked saved entry when the panel is unmounted, without consuming it', async () => {
    saveEditorViewState('p1', EDITOR);
    saveTerminalViewState('p2', TERMINAL);
    await stashPanelState(['p1', 'p2']);
    const sent = stash.mock.calls[0]![0] as PanelSnapshot[];
    expect(sent[0]!.editor).toEqual(EDITOR);
    expect(sent[1]!.terminal).toEqual(TERMINAL);
    expect(peekEditorViewState('p1')).toEqual(EDITOR);
    expect(peekTerminalViewState('p2')).toEqual(TERMINAL);
  });

  it('unregistering removes the live capture', async () => {
    const off = registerPanelStateCapture('p1', 'editor', () => EDITOR);
    off();
    await stashPanelState(['p1']);
    expect(stash.mock.calls[0]![0]).toEqual([{ panelId: 'p1' }]);
  });

  it('seeds each section into its map only where the map has no entry for the panel', () => {
    const existing = { selection: { ranges: [{ anchor: 1, head: 1 }], main: 0 }, scrollAnchor: 7 };
    saveEditorViewState('p2', existing);
    seedPanelState({
      p1: { panelId: 'p1', editor: EDITOR, terminal: TERMINAL },
      p2: { panelId: 'p2', editor: EDITOR },
    });
    expect(peekEditorViewState('p1')).toEqual(EDITOR);
    expect(peekTerminalViewState('p1')).toEqual(TERMINAL);
    expect(peekEditorViewState('p2')).toEqual(existing);
  });

  it('claimAndSeedPanelState claims the ids and seeds what comes back', async () => {
    claim.mockResolvedValueOnce({ p1: { panelId: 'p1', editor: EDITOR } });
    await claimAndSeedPanelState(['p1', 'p2']);
    expect(claim).toHaveBeenCalledWith(['p1', 'p2']);
    expect(peekEditorViewState('p1')).toEqual(EDITOR);
  });

  it('claimAndSeedPanelState survives a failing claim', async () => {
    claim.mockRejectedValueOnce(new Error('boom'));
    await expect(claimAndSeedPanelState(['p1'])).resolves.toBeUndefined();
  });

  it('is symmetric: a snapshot stashed from one set of stores seeds another the same way', async () => {
    saveEditorViewState('p1', EDITOR);
    await stashPanelState(['p1']);
    const sent = stash.mock.calls[0]![0] as PanelSnapshot[];
    clearEditorViewState('p1');
    seedPanelState(Object.fromEntries(sent.map((s) => [s.panelId, s])));
    expect(peekEditorViewState('p1')).toEqual(EDITOR);
  });

  it('carries an open find session in the find section and seeds it where none exists (US1 scenario 5)', async () => {
    registerPanelSearch('p1', {
      panelKind: 'preview',
      seedFromSelection: () => '',
      setQuery: () => ({ current: 2, total: 5 }),
      findNext: () => ({ current: 2, total: 5 }),
      findPrevious: () => ({ current: 2, total: 5 }),
      restore: () => ({ current: 2, total: 5 }),
      currentFrom: () => 33,
      close: () => undefined,
    });
    openFind('p1', 'preview');
    setTerm('p1', 'foo');
    await stashPanelState(['p1']);
    const sent = stash.mock.calls[0]![0] as PanelSnapshot[];
    expect(sent[0]!.find).toMatchObject({ panelId: 'p1', term: 'foo', count: { current: 2, total: 5 }, currentFrom: 33 });
    expect(sent[0]!.find).not.toHaveProperty('openSeq');

    __resetFindState();
    unregisterPanelSearch('p1');
    seedPanelState({ p1: sent[0]! });
    expect(getFindSession('p1')).toMatchObject({ term: 'foo', currentFrom: 33 });
    // A session already there is not overwritten.
    seedPanelState({ p1: { ...sent[0]!, find: { ...sent[0]!.find!, term: 'bar' } } });
    expect(getFindSession('p1')?.term).toBe('foo');
  });
});
