/**
 * What a MOUNTED preview panel can be asked to do from outside its own tree (044, FR-090c, FR-096c).
 *
 * Two callers cannot reach a panel's component: the window's key handler in `PreviewCommands`, which
 * resolves `preview.followLink` for whichever preview is active, and main's `focus` message
 * (`open-preview.ts`), which may name a heading to scroll to. Each panel registers its handles by id on
 * mount and removes them on unmount — the arrangement `workspace/panel-focus.ts` uses for focus, and for
 * the same reason: a module-level registry is reachable from a global handler without threading refs
 * through the tree.
 */

export interface PreviewPanelHandles {
  /** Follow the link that has keyboard focus inside this panel. `false` when no link has focus. */
  followFocusedLink(): boolean;
  /**
   * Scroll to the heading `fragment` names once the body shows the current file — or raise the one
   * `link-missing-heading` notice when it has none (FR-090c, FR-090e).
   */
  revealFragment(fragment: string): void;
  /**
   * 044 US7 — step to history entry `index`, which names `filePath` (FR-102, FR-107): `preview.navigate` with
   * the history intent and the view state being left, then main's reply handled in the panel.
   */
  navigateHistory(target: { index: number; filePath: string }): void;
  /** 047 US4 (research R7) — open this panel's Go to Heading pop-down (`preview.goToHeading`). */
  openHeadingOutline(): void;
}

const registry = new Map<string, PreviewPanelHandles>();

/** Register (or replace) a mounted preview panel's handles. Returns the matching unregister. */
export function registerPreviewPanelHandles(panelId: string, handles: PreviewPanelHandles): () => void {
  registry.set(panelId, handles);
  return () => {
    if (registry.get(panelId) === handles) registry.delete(panelId);
  };
}

/** Ctrl+Enter's dispatch (FR-096c). `false` when the panel is not mounted here or no link has focus. */
export function followFocusedPreviewLink(panelId: string): boolean {
  return registry.get(panelId)?.followFocusedLink() ?? false;
}

/**
 * Back / Forward on a preview (044 US7). `false` when the panel is not mounted here — a preview that is not
 * on screen cannot be focused, pointed at or have its header clicked, so no route reaches that case.
 */
export function navigatePreviewHistory(panelId: string, target: { index: number; filePath: string }): boolean {
  const handles = registry.get(panelId);
  if (!handles) return false;
  handles.navigateHistory(target);
  return true;
}

/** `focus` with a fragment (FR-090c). `false` when the panel is not mounted in this window yet. */
export function revealPreviewFragment(panelId: string, fragment: string): boolean {
  const handles = registry.get(panelId);
  if (!handles) return false;
  handles.revealFragment(fragment);
  return true;
}

/* ── 054 FR-031 — a match to reveal once the preview shows its file ─────────────────────────────── */

/**
 * A Find in Files match a preview was opened for (contracts/preview-ipc-054.md `reveal`). Renderer-local:
 * it never crosses to main. The preview reveals it once it has drawn `absPath`, or calls `fallback` — the
 * editor at the match — when what it drew cannot show it (FR-032).
 */
export interface PreviewReveal {
  readonly absPath: string;
  readonly from: number;
  readonly to: number;
  /** The matched text, as the search found it in the source. */
  readonly text: string;
  /** The match's 0-based source line, when the caller knows it. */
  readonly line: number | null;
  fallback(): void;
}

const pendingReveals = new Map<string, PreviewReveal>();
const revealListeners = new Map<string, () => void>();

/**
 * Hand panel `panelId` a match to reveal — whichever panel main's answer named (placed, focused,
 * navigated). A mounted panel is told at once (a FOCUSED preview draws nothing new); one that mounts later
 * finds it waiting. A newer reveal for the same panel replaces an older one.
 */
export function setPendingReveal(panelId: string, reveal: PreviewReveal): void {
  pendingReveals.set(panelId, reveal);
  revealListeners.get(panelId)?.();
}

/** The reveal waiting for `panelId`, removed — or `null` when there is none. */
export function takePendingReveal(panelId: string): PreviewReveal | null {
  const reveal = pendingReveals.get(panelId) ?? null;
  pendingReveals.delete(panelId);
  return reveal;
}

/** Whether a reveal is waiting for `panelId`. */
export function hasPendingReveal(panelId: string): boolean {
  return pendingReveals.has(panelId);
}

/** The reveal waiting for `panelId`, left in place — for a panel to check it is for the file it shows. */
export function peekPendingReveal(panelId: string): PreviewReveal | null {
  return pendingReveals.get(panelId) ?? null;
}

/** A mounted panel listens for reveals handed to it. Returns the unregister. */
export function onPendingReveal(panelId: string, listener: () => void): () => void {
  revealListeners.set(panelId, listener);
  return () => {
    if (revealListeners.get(panelId) === listener) revealListeners.delete(panelId);
  };
}

/** `preview.goToHeading` (047 US4). `false` when the panel is not mounted here. */
export function openPreviewHeadingOutline(panelId: string): boolean {
  const handles = registry.get(panelId);
  if (!handles) return false;
  handles.openHeadingOutline();
  return true;
}
