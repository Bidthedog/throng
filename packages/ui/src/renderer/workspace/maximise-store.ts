/**
 * 054 FR-070 – FR-076 — the maximise stack: which target, if any, fills a tab's middle section.
 *
 * Module-level rather than React state, like `split-mode.ts` and `panel-flash.ts`: the writers are the
 * window dispatcher (the chord), a panel's header and title menu, a diagram's Full Pane control and the
 * open paths, none of which share a component; the readers are the tab body, every panel box and the
 * modal gates. It is never in `Tab` or the layout, so it is never saved (FR-076), never crosses windows,
 * and a restart shows every tab un-maximised.
 *
 * Per tab, a STACK, bottom → top: at most one panel, then the sections nested over it (FR-074). A target
 * is shown in place — the panel is never re-parented, because re-parenting remounts xterm and CodeMirror
 * (research R7) — so all this holds is ids; `.tab-body[data-maximised]` and its CSS do the showing.
 *
 * A section target carries the `render` the maximise layer draws into its portal. The section's own
 * state lives in the component that registered it, above the portal, so it survives the move.
 */
import { useSyncExternalStore, type ReactNode } from 'react';

export interface PanelTarget {
  readonly kind: 'panel';
  readonly panelId: string;
}

export interface SectionTarget {
  readonly kind: 'section';
  readonly panelId: string;
  readonly sectionId: string;
  /** What the maximise layer draws for this section. Re-registering the same section replaces it. */
  readonly render: () => ReactNode;
}

export type MaximiseTarget = PanelTarget | SectionTarget;

const EMPTY: readonly MaximiseTarget[] = Object.freeze([]);

/** Tab id → its stack. Each stack is replaced, never mutated, so a snapshot is stable for React. */
const stacks = new Map<string, readonly MaximiseTarget[]>();
const listeners = new Set<() => void>();
let tabOfPanel: ((panelId: string) => string | null) | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function set(tabId: string, next: readonly MaximiseTarget[]): void {
  const prev = stacks.get(tabId) ?? EMPTY;
  if (prev.length === next.length && prev.every((t, i) => t === next[i])) return;
  if (next.length === 0) stacks.delete(tabId);
  else stacks.set(tabId, Object.freeze([...next]));
  notify();
}

/** The tab's stack, bottom → top. Empty when nothing is maximised. */
export function getMaximiseStack(tabId: string): readonly MaximiseTarget[] {
  return stacks.get(tabId) ?? EMPTY;
}

/** The panel a whole-panel target holds, or `null` (nothing maximised, or a section alone). */
export function maximisedPanelOf(tabId: string): string | null {
  const bottom = getMaximiseStack(tabId)[0];
  return bottom?.kind === 'panel' ? bottom.panelId : null;
}

/** The panel the tab's targets belong to — the one panel left visible — or `null`. */
function ownerOf(stack: readonly MaximiseTarget[]): string | null {
  return stack[0]?.panelId ?? null;
}

/**
 * Whether `panelId` is hidden by a maximised target in `tabId` (FR-072, FR-074): something is maximised
 * and it is not this panel's. The caller vouches that the panel is in that tab.
 */
export function isPanelHidden(tabId: string, panelId: string): boolean {
  const owner = ownerOf(getMaximiseStack(tabId));
  return owner !== null && owner !== panelId;
}

/** Maximise a whole panel. Whatever the tab had maximised is restored first (FR-074). */
export function maximisePanel(tabId: string, panelId: string): void {
  const stack = getMaximiseStack(tabId);
  if (stack.length === 1 && stack[0]?.kind === 'panel' && stack[0].panelId === panelId) return;
  set(tabId, [{ kind: 'panel', panelId }]);
}

/**
 * The Maximise / Restore Panel command and header control on `panelId`: restores it — with every
 * section nested over it — when it is the maximised panel, maximises it otherwise.
 */
export function toggleMaximisePanel(tabId: string, panelId: string): void {
  if (maximisedPanelOf(tabId) === panelId) set(tabId, EMPTY);
  else maximisePanel(tabId, panelId);
}

/**
 * Maximise a section of `panelId` (a diagram's Full Pane, FR-046f). It nests over that panel when the
 * panel is the maximised one (or one of its sections is on top); over anything else it replaces the
 * stack. Calling it again for the section already present only replaces its `render`.
 */
export function maximiseSection(
  tabId: string,
  panelId: string,
  sectionId: string,
  render: () => ReactNode,
): void {
  const stack = getMaximiseStack(tabId);
  const entry: SectionTarget = { kind: 'section', panelId, sectionId, render };
  const at = stack.findIndex((t) => t.kind === 'section' && t.panelId === panelId && t.sectionId === sectionId);
  if (at >= 0) {
    set(tabId, stack.map((t, i) => (i === at ? entry : t)));
    return;
  }
  if (stack.length === 0 || ownerOf(stack) === panelId) set(tabId, [...stack, entry]);
  else set(tabId, [entry]);
}

/** Esc, a Restore control, the command: step back exactly one level. A no-op when nothing is maximised. */
export function restore(tabId: string): void {
  const stack = getMaximiseStack(tabId);
  if (stack.length === 0) return;
  set(tabId, stack.slice(0, -1));
}

/** Restore the tab all the way to its layout. */
export function restoreAll(tabId: string): void {
  set(tabId, EMPTY);
}

/** `panelId` closed (or left the window): every entry it owns goes, in whichever tab holds it (FR-075). */
export function panelClosed(panelId: string): void {
  for (const [tabId, stack] of [...stacks]) {
    set(tabId, stack.filter((t) => t.panelId !== panelId));
  }
}

/** `panelId` changed type in place: a whole-panel target stays, its sections cannot outlive the type. */
export function panelTypeChanged(panelId: string): void {
  for (const [tabId, stack] of [...stacks]) {
    set(tabId, stack.filter((t) => t.kind === 'panel' || t.panelId !== panelId));
  }
}

/** A section's component unmounted (its block was deleted, its panel re-rendered without it). */
export function sectionUnmounted(tabId: string, panelId: string, sectionId: string): void {
  const stack = getMaximiseStack(tabId);
  set(tabId, stack.filter((t) => !(t.kind === 'section' && t.panelId === panelId && t.sectionId === sectionId)));
}

/**
 * The window's workspace store tells this module which tab holds a panel, so a caller that has only a
 * panel id — an open path, a menu built deep in a panel — can still ask about it. Returns the unregister.
 */
export function registerPanelTabResolver(next: (panelId: string) => string | null): () => void {
  tabOfPanel = next;
  return () => {
    if (tabOfPanel === next) tabOfPanel = null;
  };
}

/** The tab holding `panelId`, as the registered resolver knows it, or `null`. */
export function tabOfMaximisePanel(panelId: string): string | null {
  return tabOfPanel?.(panelId) ?? null;
}

/**
 * Whether the tab holding `panelId` has anything maximised — the modal gate (FR-074) for a caller with
 * only a panel id: the Split rows, which are built deep in each panel's own menus.
 */
export function isPanelTabMaximised(panelId: string): boolean {
  const tabId = tabOfMaximisePanel(panelId);
  return tabId !== null && getMaximiseStack(tabId).length > 0;
}

/** The tabs with something maximised, for pruning entries whose panel or tab has gone. */
export function maximisedTabIds(): string[] {
  return [...stacks.keys()];
}

/** Whether `panelId` is hidden by its own tab's maximised target — for callers with no tab id. */
export function isPanelHiddenAnywhere(panelId: string): boolean {
  const tabId = tabOfMaximisePanel(panelId);
  return tabId !== null && isPanelHidden(tabId, panelId);
}

/**
 * An open is about to land in `panelId` (FR-074): when that panel is hidden by a maximised target, the
 * tab is restored first so the user sees where the file went. Returns whether it restored.
 */
export function ensurePanelVisible(panelId: string): boolean {
  const tabId = tabOfMaximisePanel(panelId);
  if (tabId === null || !isPanelHidden(tabId, panelId)) return false;
  restoreAll(tabId);
  return true;
}

/** Called on every change. Returns the unsubscribe. */
export function subscribeMaximise(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface TabMaximise {
  /** The stack, bottom → top. */
  readonly stack: readonly MaximiseTarget[];
  /** Anything maximised in this tab — a panel or a section. While true the tab is modal (FR-074). */
  readonly isMaximised: boolean;
  /** The whole-panel target, or `null`. */
  readonly maximisedPanelId: string | null;
  /** The section on top of the stack, or `null`. */
  readonly topSection: SectionTarget | null;
  /** Whether `panelId` (in this tab) is hidden by the target. */
  readonly isHidden: (panelId: string) => boolean;
}

function describeTab(tabId: string, stack: readonly MaximiseTarget[]): TabMaximise {
  const top = stack[stack.length - 1];
  return {
    stack,
    isMaximised: stack.length > 0,
    maximisedPanelId: stack[0]?.kind === 'panel' ? stack[0].panelId : null,
    topSection: top?.kind === 'section' ? top : null,
    isHidden: (panelId) => isPanelHidden(tabId, panelId),
  };
}

/** The modal state of `tabId`, re-rendering on every change to that tab's stack. */
export function useTabMaximise(tabId: string): TabMaximise {
  const stack = useSyncExternalStore(
    subscribeMaximise,
    () => getMaximiseStack(tabId),
    () => getMaximiseStack(tabId),
  );
  return describeTab(tabId, stack);
}

/** The whole-panel target of `tabId` (`null` for none, or no tab), re-rendering on change. */
export function useMaximisedPanel(tabId: string | null): string | null {
  const read = (): string | null => (tabId === null ? null : maximisedPanelOf(tabId));
  return useSyncExternalStore(subscribeMaximise, read, read);
}

/**
 * Whether the section `sectionId` of `panelId` is one of the tab's targets — what a section reads to
 * swap its Full Pane control for Restore and to leave its in-place slot empty while the layer draws it.
 */
export function useSectionMaximised(tabId: string, panelId: string, sectionId: string): boolean {
  const read = (): boolean =>
    getMaximiseStack(tabId).some((t) => t.kind === 'section' && t.panelId === panelId && t.sectionId === sectionId);
  return useSyncExternalStore(subscribeMaximise, read, read);
}

/** Tests only: every tab un-maximised, no resolver, no listeners carried between tests. */
export function __resetMaximise(): void {
  stacks.clear();
  tabOfPanel = null;
}
