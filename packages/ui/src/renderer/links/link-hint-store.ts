import { useSyncExternalStore } from 'react';
import { LINK_HINT_MS } from '@throng/core';
import type { AnchorRect } from '../common/clamp-to-viewport.js';

/**
 * 045 FR-165, FR-166 (round four) — the ONE link hint in the whole app.
 *
 * A module-level singleton, not React state owned by any one panel: FR-166 requires at most one hint
 * to exist across every panel and window, and the cheapest way to guarantee that is for there to be
 * exactly one place a hint can live. `showLinkHint` REPLACES whatever is up — a second hint is never
 * additive, it is the first hint's replacement (FR-166's "at most one").
 *
 * `hideLinkHint` is idempotent and safe to call from anywhere (a global keydown/blur listener, a
 * surface's own Ctrl+click handler) without either caller having to know whether a hint is actually
 * showing.
 */
export interface LinkHintRequest {
  /** FR-168's words — the caller (terminal/editor/preview) has already worded it. */
  readonly text: string;
  /** FR-165b: the link's own bottom-right corner — its last row's, for a link spanning several. */
  readonly anchor: AnchorRect;
  /**
   * The panel that raised it (review round four, terminal I4).
   *
   * A hint describes a link in a particular panel, and a panel can be destroyed inside the 2.5 s the
   * hint lives — `Ctrl+W` on a terminal a moment after a plain click left the hint floating over
   * whatever replaced it, still naming the dead terminal's link. There is still only ONE hint in the
   * app (FR-166): this is not a second store keyed by panel, it is the one hint knowing whose it is,
   * so a panel closing can hide its OWN and never somebody else's.
   */
  readonly owner?: string;
}

let current: LinkHintRequest | null = null;
const listeners = new Set<() => void>();
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LinkHintRequest | null {
  return current;
}

/** FR-165 / FR-166 — show the hint, replacing any hint already up. Hides after `ms` (FR-165d). */
export function showLinkHint(request: LinkHintRequest, ms: number = LINK_HINT_MS): void {
  if (hideTimer !== undefined) clearTimeout(hideTimer);
  current = request;
  notify();
  hideTimer = setTimeout(hideLinkHint, ms);
}

/** FR-165d — hide at once. Idempotent: a caller never needs to know whether one is showing. */
export function hideLinkHint(): void {
  if (hideTimer !== undefined) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
  if (current === null) return;
  current = null;
  notify();
}

/**
 * FR-165d — hide the hint only if `owner` raised it. A panel's disposal calls this; a hint with no
 * owner, or another panel's, is left alone, because a destroy is not a reason to take away a hint
 * describing a link that is still on screen.
 */
export function hideLinkHintFor(owner: string): void {
  if (current === null || current.owner !== owner) return;
  hideLinkHint();
}

/** The hint's live state, for the one mounted `<LinkHint>` (`link-hint.tsx`). */
export function useLinkHint(): LinkHintRequest | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** A point-in-time read without subscribing — for a caller (a test) that is not a render. */
export function peekLinkHint(): LinkHintRequest | null {
  return current;
}
