/**
 * The renderer's side of the cross-window panel-state hand-off (049 R3, FR-000, FR-000a;
 * contracts/panel-state-handoff.md).
 *
 * A tear-off COPIES a panel into another window whose renderer starts with empty module-scoped stores
 * (`editor-view-state`, `terminal-view-state`, the find sessions, …). Constitution XI says the panel keeps its
 * state through that move, so the sending window {@link stashPanelState}s a snapshot per moved panel into main
 * BEFORE the receiving window can mount it, and the receiver {@link claimAndSeedPanelState}s them before it
 * renders the workspace. Both directions are window-kind-agnostic: nothing here knows which window is sending
 * or receiving, so any future route (a reattach) uses the same two calls.
 *
 * Each section has two halves:
 *   - a LIVE capture, registered by whatever is mounted for the panel (`registerPanelStateCapture`), and
 *   - a SAVED capture, read without consuming from the module map that holds a panel's state while it is
 *     unmounted (a tab switch parks it there).
 * A live capture wins: a mounted view is newer than whatever it saved last time it unmounted.
 */
import type { PanelSnapshot } from '@throng/core';
import { peekEditorViewState, seedEditorViewState } from '../editor/editor-view-state.js';
import { peekTerminalViewState, seedTerminalViewState } from '../terminal/terminal-view-state.js';
import { seedFindSession, snapshotFindSession } from '../search/search-store.js';
import { peekPreviewSelection, seedPreviewSelection } from '../preview/preview-selection-store.js';

/** The sections a mounted view captures live (the find session is read from the search store instead). */
export type LiveSection = 'editor' | 'terminal' | 'previewSelection';

type Captured<S extends LiveSection> = NonNullable<PanelSnapshot[S]>;

/** panelId → section → live capture. */
const live = new Map<string, Map<LiveSection, () => unknown>>();

/**
 * Register `capture` as `section`'s live capture for `panelId`. Returns the unregister, which removes THIS
 * registration only — a remount that registered again before the old cleanup ran keeps its own.
 */
export function registerPanelStateCapture<S extends LiveSection>(
  panelId: string,
  section: S,
  capture: () => Captured<S> | undefined,
): () => void {
  let sections = live.get(panelId);
  if (!sections) live.set(panelId, (sections = new Map()));
  sections.set(section, capture);
  return () => {
    const current = live.get(panelId);
    if (current?.get(section) !== capture) return;
    current.delete(section);
    if (current.size === 0) live.delete(panelId);
  };
}

/** Saved (unmounted) state per section; each is a non-consuming read of the map the section parks in. */
const peeks: Partial<Record<LiveSection, (panelId: string) => unknown>> = {
  editor: peekEditorViewState,
  terminal: peekTerminalViewState,
  previewSelection: peekPreviewSelection,
};

const SECTIONS: readonly LiveSection[] = ['editor', 'terminal', 'previewSelection'];

/** Compose the snapshot of one panel from its live captures, falling back to what it saved when unmounted. */
export function snapshotPanel(panelId: string): PanelSnapshot {
  const snapshot: PanelSnapshot = { panelId };
  const sections = live.get(panelId);
  for (const section of SECTIONS) {
    const value = sections?.get(section)?.() ?? peeks[section]?.(panelId);
    if (value !== undefined) (snapshot as unknown as Record<string, unknown>)[section] = value;
  }
  // The find session lives in the search store whether or not the panel is mounted (043 rule 3).
  const find = snapshotFindSession(panelId);
  if (find) snapshot.find = find;
  return snapshot;
}

/** Send one snapshot per id to main. Resolves once main holds them; never rejects (a failed hand-off must not block the move). */
export async function stashPanelState(panelIds: readonly string[]): Promise<void> {
  if (panelIds.length === 0) return;
  try {
    await window.throng?.panelState.stash(panelIds.map(snapshotPanel));
  } catch {
    // The panel still moves; it simply arrives without its view state.
  }
}

/** Write each received section into its store, only where this window has no entry for the panel yet. */
export function seedPanelState(snapshots: Readonly<Record<string, PanelSnapshot>>): void {
  for (const [panelId, snapshot] of Object.entries(snapshots)) {
    if (snapshot.editor) seedEditorViewState(panelId, snapshot.editor);
    if (snapshot.terminal) seedTerminalViewState(panelId, snapshot.terminal);
    if (snapshot.previewSelection) seedPreviewSelection(panelId, snapshot.previewSelection);
    if (snapshot.find) seedFindSession(snapshot.find);
  }
}

/** Claim main's snapshots for `panelIds` and seed them; resolves (never rejects) before the caller renders. */
export async function claimAndSeedPanelState(panelIds: readonly string[]): Promise<void> {
  if (panelIds.length === 0) return;
  try {
    const claimed = await window.throng?.panelState.claim(panelIds);
    if (claimed) seedPanelState(claimed);
  } catch {
    // No hand-off: the panels mount with default state.
  }
}
