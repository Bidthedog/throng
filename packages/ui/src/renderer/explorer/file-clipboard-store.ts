/**
 * The renderer's window onto the application-wide file clipboard (050 FR-001..FR-005).
 *
 * The clipboard LIVES IN MAIN — one value for the whole application, pushed to every window. It used
 * to be `useState` inside `useExplorerData`, which is exactly why it could not cross a project switch:
 * the tree remounts for the other project and takes its state with it. So this module keeps no
 * authority of its own. It caches main's last answer so a render has something to read, subscribes to
 * main's pushes while anything is listening, and re-reads `get()` whenever the first listener arrives —
 * which is how a tree remounted for another project (or a pane hidden and shown) gets the clipboard
 * back rather than a copy that went with the old component.
 *
 * ONE subscription for the window, however many components read it: the grey rows of the tree, the
 * Paste menu item and the paste handler all see the same value from the same push.
 */
import { useSyncExternalStore } from 'react';
import { normaliseForCompare, type FileClipboard } from '@throng/core';
import type { FilesOkOrError } from '../global.js';

let value: FileClipboard = null;
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;
/** Bumped on every attach, so a stale `get()` answer from a previous attach cannot overwrite a newer push. */
let epoch = 0;
/** A push seen since the current attach began: it is newer than any `get()` still in flight. */
let pushedSinceAttach = false;

function publish(next: FileClipboard): void {
  value = next;
  for (const l of [...listeners]) l();
}

function attach(): void {
  epoch += 1;
  const mine = epoch;
  pushedSinceAttach = false;
  const bridge = window.throng?.fileClipboard;
  if (!bridge) return;
  detach = bridge.onChange((next) => {
    pushedSinceAttach = true;
    publish(next);
  });
  void bridge
    .get()
    .then((fromMain) => {
      // A push that arrived while `get` was in flight is the newer fact.
      if (mine === epoch && !pushedSinceAttach) publish(fromMain);
    })
    .catch(() => {
      /* no answer leaves the cached value standing */
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
    }
  };
}

const snapshot = (): FileClipboard => value;

/** The clipboard, live. `null` when empty. */
export function useFileClipboard(): FileClipboard {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Put the active project's `relPaths` on the clipboard (main resolves them; the root is refused). */
export function setFileClipboard(
  mode: 'cut' | 'copy',
  relPaths: readonly string[],
): Promise<FilesOkOrError | undefined> {
  return window.throng?.fileClipboard?.set(mode, relPaths) ?? Promise.resolve(undefined);
}

/** Empty the clipboard in every window (FR-005). */
export function clearFileClipboard(): void {
  window.throng?.fileClipboard?.clear();
}

/**
 * Whether `absPath` is on the clipboard AS A CUT (FR-004) — compared on normalised paths, so the
 * separator, the case and a trailing slash cannot make a cut row look uncut.
 */
export function isCut(clipboard: FileClipboard, absPath: string): boolean {
  if (clipboard === null || clipboard.mode !== 'cut') return false;
  const wanted = normaliseForCompare(absPath);
  return clipboard.items.some((it) => normaliseForCompare(it.absPath) === wanted);
}

/** Test seam: forget the cache and every listener, as a fresh window would. */
export function resetFileClipboardStoreForTests(): void {
  detach?.();
  detach = null;
  listeners.clear();
  value = null;
  epoch += 1;
  pushedSinceAttach = false;
}
