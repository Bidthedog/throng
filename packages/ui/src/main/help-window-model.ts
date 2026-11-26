/**
 * The Help window's decisions (080 FR-048, FR-051), Electron-free so they are tested on their own; `help-window.ts`
 * applies them.
 */

/** What the toolbar learns about the page (`throng:help:state`). */
export interface HelpViewState {
  readonly title: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** FR-051 — what a key or mouse press in the view does to its history, if anything. */
export function historyStepFor(input: { type: string; key: string; alt: boolean; control: boolean; meta: boolean; shift: boolean }): 'back' | 'forward' | undefined {
  if (input.type !== 'keyDown' || !input.alt || input.control || input.meta || input.shift) return undefined;
  if (input.key === 'ArrowLeft') return 'back';
  if (input.key === 'ArrowRight') return 'forward';
  return undefined;
}

/** Where the view sits: the window's content area below the toolbar. */
export function viewBoundsFor(content: { width: number; height: number }, top: number): { x: number; y: number; width: number; height: number } {
  const y = Math.max(0, Math.min(Math.round(top), content.height));
  return { x: 0, y, width: content.width, height: Math.max(0, content.height - y) };
}
