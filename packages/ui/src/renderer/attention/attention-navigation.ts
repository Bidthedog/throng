import { useEffect, useRef } from 'react';
import { collectPanels, type WorkspaceLayout } from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { focusLocalPanel, type PreviewPlacementWorkspace } from '../preview/open-preview.js';
import { getAttentionMarks } from './attention-store.js';
import { panelHoldingFocus } from './focus-reporter.js';
import { nextMarkedTarget } from './go-to-next.js';

/**
 * Taking the user to a marked panel (057 FR-034, FR-080, FR-080a; research R14).
 *
 * Three routes arrive here — a toast's link, an OS notification click, and Go to Next Marked Panel — and
 * main routes the first two by sending `throng:attention:focusPanel` to the window that hosts the panel.
 * One function answers all three, so they cannot disagree about what "go to" means.
 */

export interface NavigationTarget {
  panelId: string;
  projectId: string;
}

/** What navigation needs of a window, named structurally so a test can drive it without a provider tree. */
export interface NavigationHost {
  /** The layout this window shows RIGHT NOW. */
  layout(): WorkspaceLayout | null;
  /** The workspace store as of now (its object is replaced every render). */
  ws(): PreviewPlacementWorkspace;
  /** `null` in a window that cannot change project (a sub-workspace). */
  switchProject: ((projectId: string) => Promise<void>) | null;
  /** Resolves with the first layout matching `match` — now, or when the store next produces one — or `null` on timeout. */
  awaitLayout(match: (layout: WorkspaceLayout) => boolean): Promise<WorkspaceLayout | null>;
}

const holds = (layout: WorkspaceLayout | null, panelId: string): layout is WorkspaceLayout =>
  layout !== null && layout.tabs.some((tab) => collectPanels(tab.root).some((p) => p.id === panelId));

/**
 * Bring `target` forward and give it the keyboard. In this window's layout it is `focusLocalPanel`;
 * in another project it is `switchProject` → wait for THAT project's layout → `focusLocalPanel`
 * (the pending-switch mark `switchProject` sets is what lets the workspace pane take focus,
 * `active-pane.ts`). `switchProject` consults no reachability, so a project hidden in a minimised
 * category is reached and the category stays minimised (FR-080a).
 *
 * `false`, and nothing else, for a panel that no longer exists: the mark's owner dismisses it, and a
 * notice here would be a second report of a condition main already settled.
 */
export async function navigateToPanel(
  host: NavigationHost,
  target: NavigationTarget,
  /**
   * Go to Next only: the panels marked in the target's project. Before that project's layout is loaded
   * core could only order them by raise time, so once it is, the FIRST of them in tab-then-panel order
   * is the one to focus (FR-080, T071) — not necessarily `target.panelId`.
   */
  marked?: ReadonlySet<string>,
): Promise<boolean> {
  const here = host.layout();
  if (holds(here, target.panelId)) return focusLocalPanel(host.ws(), here, target.panelId);
  if (host.switchProject === null) return false;
  await host.switchProject(target.projectId);
  const there = await host.awaitLayout((l) => l.projectId === target.projectId);
  if (!holds(there, target.panelId)) return false;
  const first =
    marked === undefined
      ? undefined
      : there.tabs.flatMap((tab) => collectPanels(tab.root)).find((p) => marked.has(p.id));
  return focusLocalPanel(host.ws(), there, first?.id ?? target.panelId);
}

/* ─── the window-level entry point the command uses ───────────────────────────────────────── */

let navigator: ((target: NavigationTarget) => Promise<boolean>) | null = null;

/** Register (or clear) how THIS window navigates; the chord's handler has no route into a component's state. */
export function registerAttentionNavigation(fn: ((target: NavigationTarget) => Promise<boolean>) | null): void {
  navigator = fn;
}

/** Navigate this window to `target`. `false` when nothing is mounted or the panel is gone. */
export function requestAttentionNavigation(target: NavigationTarget): Promise<boolean> {
  return navigator === null ? Promise.resolve(false) : navigator(target);
}

let goToNext: (() => boolean) | null = null;

/**
 * Go to Next Marked Panel for this window (FR-080): true when something was marked and navigation
 * started, false — doing nothing, raising nothing — when nothing is (US7 AS2) or no window is mounted.
 */
export function requestNextMarkedPanel(): boolean {
  return goToNext === null ? false : goToNext();
}

/** How long a project switch may take to produce its layout before navigation gives up. */
const LAYOUT_WAIT_MS = 5000;

/**
 * Mounted once per window (both shells). Answers `throng:attention:focusPanel` and registers this
 * window's navigator for Go to Next Marked Panel. A sub-workspace window passes `switchProjects={false}`:
 * it hosts panels from several projects and has no project of its own to switch.
 */
export function AttentionNavigation({ switchProjects = true }: { switchProjects?: boolean }): null {
  const ws = useWorkspace();
  const { switchProject, projects, categories } = useProjects();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const listRef = useRef({ projects, categories });
  listRef.current = { projects, categories };
  const switchRef = useRef(switchProject);
  switchRef.current = switchProject;
  const waiters = useRef<Array<{ match: (l: WorkspaceLayout) => boolean; resolve: (l: WorkspaceLayout | null) => void }>>([]);

  // Wake whoever is waiting for a layout, on every layout this store produces.
  useEffect(() => {
    const layout = ws.layout;
    if (layout === null) return;
    waiters.current = waiters.current.filter((w) => {
      if (!w.match(layout)) return true;
      w.resolve(layout);
      return false;
    });
  }, [ws.layout]);

  useEffect(() => {
    const host: NavigationHost = {
      layout: () => wsRef.current.layout,
      ws: () => wsRef.current,
      switchProject: switchProjects ? (id) => switchRef.current(id) : null,
      awaitLayout: (match) =>
        new Promise((resolve) => {
          const current = wsRef.current.layout;
          if (current !== null && match(current)) {
            resolve(current);
            return;
          }
          const waiter = { match, resolve };
          waiters.current.push(waiter);
          setTimeout(() => {
            if (!waiters.current.includes(waiter)) return;
            waiters.current = waiters.current.filter((w) => w !== waiter);
            resolve(null);
          }, LAYOUT_WAIT_MS);
        }),
    };
    const navigate = (target: NavigationTarget): Promise<boolean> => navigateToPanel(host, target);
    registerAttentionNavigation(navigate);
    goToNext = () => {
      const target = nextMarkedTarget({
        layout: wsRef.current.layout,
        focusedPanelId: panelHoldingFocus(),
        projects: listRef.current.projects,
        categories: listRef.current.categories,
        marks: getAttentionMarks(),
      });
      if (target === null) return false;
      // This window cannot reach every panel (one a sub-workspace window hosts, say): when it cannot,
      // main routes it to the window that can, exactly as it does for a toast's link.
      const marks = getAttentionMarks();
      const marked = new Set(marks.filter((m) => m.projectId === target.projectId).map((m) => m.panelId));
      void navigateToPanel(host, target, marked).then((ok) => {
        if (!ok) window.throng?.attention?.goTo?.(target.panelId);
      });
      return true;
    };
    const off = window.throng?.attention?.onFocusPanel?.((target) => void navigate(target));
    return () => {
      registerAttentionNavigation(null);
      goToNext = null;
      off?.();
    };
  }, [switchProjects]);

  return null;
}
