/**
 * Where the user is in the hierarchy, and the way back (055 FR-060, FR-092): Back and the breadcrumb, in
 * the window's full-width header (FR-112) rather than inside the left column, so neither scrolls away.
 *
 * ══ IT SHOWS THE LEVEL THE LIST SHOWS ══
 *
 * The list resolves the view's focus against the FILTERED tree: a filter or Hide ended can take the
 * focused node away, and the list then shows its nearest remaining ancestor. The breadcrumb must name that
 * level, not the one asked for — so the list publishes the path it resolved (`publishShownPath`) and this
 * reads it, rather than filtering the tree a second time per capture (Principle XII).
 */
import { useSyncExternalStore, type ReactElement } from 'react';
import { Breadcrumb } from './breadcrumb.js';
import { IconButton } from '../common/icon-button.js';
import { focusOn, useSession, useView } from './monitor-session.js';

let shown: readonly string[] | null = null;
const listeners = new Set<() => void>();

const samePath = (a: readonly string[] | null, b: readonly string[]): boolean =>
  a !== null && a.length === b.length && a.every((id, i) => id === b[i]);

/** The list's resolved focus path; listeners hear only a real change. */
export function publishShownPath(path: readonly string[] | null): void {
  if (path === null ? shown === null : samePath(shown, path)) return;
  shown = path;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function MonitorLocation(): ReactElement | null {
  const { tree } = useSession();
  const view = useView();
  const published = useSyncExternalStore(subscribe, () => shown);
  if (tree === null) return null;
  const path = published ?? view.focusPath;
  return (
    <div className="monitor-location" data-testid="monitor-location">
      <IconButton
        token="navigateBack"
        title="Back"
        testId="breakdown-back"
        className="icon-button breakdown__back"
        disabled={path.length < 2}
        onClick={() => focusOn(path.slice(0, -1))}
      />
      <Breadcrumb tree={tree} path={path} onGo={focusOn} />
    </div>
  );
}

/** Tests only. */
export function __resetShownPath(): void {
  shown = null;
}
