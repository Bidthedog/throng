/**
 * Which files have an open preview, in ANY window (044, FR-012, FR-014, data-model §12).
 *
 * Fed only by main's broadcast `throng:preview:openChanged`, which carries a canonical path and nothing
 * else. It is what lets an editor's status-bar button draw PRESSED, and its Open Preview item draw
 * DISABLED, for a preview opened in another window (contracts/menus-and-controls.md §7).
 *
 * ══ ONE SPELLING ══
 *
 * Main keys the broadcast by `normaliseForCompare` (forward slashes, lower-cased, no trailing
 * separator), and so does every entry and every lookup here. An editor asking about
 * `D:\Proj\README.md` must find the preview main announced as `d:/proj/readme.md`; comparing any other
 * way would draw the button unpressed for a file whose preview is plainly open.
 *
 * `open: false` arrives only when main holds no run for the path, so it simply removes the entry.
 */
import { useSyncExternalStore } from 'react';
import { normaliseForCompare, type PreviewOpenChanged } from '@throng/core';

const open = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** Apply one `openChanged` broadcast. */
export function applyPreviewOpenChanged(evt: PreviewOpenChanged): void {
  const key = normaliseForCompare(evt.path);
  if (evt.open) {
    if (open.has(key)) return;
    open.add(key);
  } else if (!open.delete(key)) {
    return;
  }
  emit();
}

/** Whether a file has an open preview, however its path is spelled. */
export function isPreviewOpen(absPath: string): boolean {
  return open.has(normaliseForCompare(absPath));
}

/** The same, re-rendering when it changes. `false` for no path (an editor with no file). */
export function usePreviewOpen(absPath: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (absPath ? open.has(normaliseForCompare(absPath)) : false),
    () => false,
  );
}

/**
 * Replace the whole set with main's answer to `openPaths` — every path that has a run right now.
 * Replaced, not merged: an entry this window held from before (a listener torn down and set up again)
 * that main no longer reports is closed.
 */
function seedPreviewOpenPaths(paths: readonly string[]): void {
  const next = new Set(paths.map((p) => normaliseForCompare(p)));
  if (next.size === open.size && [...next].every((p) => open.has(p))) return;
  open.clear();
  for (const p of next) open.add(p);
  emit();
}

/** What the listener needs of `window.throng.preview`. `openPaths` absent: no seed, broadcasts only. */
export interface PreviewOpenBridge {
  onOpenChanged: (cb: (evt: PreviewOpenChanged) => void) => () => void;
  openPaths?: () => Promise<string[]>;
}

/**
 * Subscribe this window's store to main's broadcast, and seed it (contracts/preview-ipc.md §1
 * `openPaths`). Returns the unsubscribe. A window with no preview bridge (a test, the preferences
 * window) subscribes to nothing.
 *
 * ══ SUBSCRIBE, ASK, BUFFER, SEED, REPLAY ══
 *
 * A window created after a preview opened — a sub-workspace window, a reload — has heard no broadcast
 * for it, so it asks main which paths are open. The order is what makes that safe:
 *
 * 1. subscribe first, so no broadcast sent after the question can be missed;
 * 2. hold every broadcast that arrives before the reply;
 * 3. apply the seed, then the held broadcasts IN ORDER.
 *
 * So an `open: false` for a preview closed while the question was in flight wins over the seed that
 * still listed it — the seed describes an earlier moment than the broadcast does. A seed that fails is
 * not fatal: the held broadcasts are applied and the store carries on from them.
 */
export function listenForPreviewOpenChanged(bridge: PreviewOpenBridge | undefined): () => void {
  if (!bridge) return () => {};
  let active = true;
  let held: PreviewOpenChanged[] | null = bridge.openPaths ? [] : null;
  const unsubscribe = bridge.onOpenChanged((evt) => {
    if (held !== null) held.push(evt);
    else applyPreviewOpenChanged(evt);
  });
  const replay = (seed: readonly string[] | null): void => {
    if (!active) return;
    if (seed !== null) seedPreviewOpenPaths(seed);
    const pending = held ?? [];
    held = null;
    for (const evt of pending) applyPreviewOpenChanged(evt);
  };
  if (bridge.openPaths) {
    bridge.openPaths().then(
      (paths) => replay(Array.isArray(paths) ? paths : null),
      (error: unknown) => {
        console.error('[preview] could not read the open previews', error);
        replay(null);
      },
    );
  }
  return () => {
    active = false;
    held = null;
    unsubscribe();
  };
}

/** Tests only. */
export function __resetPreviewOpenStore(): void {
  open.clear();
  emit();
}
