/**
 * 080 FR-063, FR-070 — the prompt every external link shows before throng hands it to the OS, asked of the window
 * the link was followed in (the focused throng window, else the main window) and drawn INLINE there by its
 * renderer's `LinkPromptHost`, with the common confirm dialog. It blocks that window only; the rest of throng
 * stays usable.
 *
 * Main sends `throng:linkPrompt:ask` with a request id and the address, and takes the answer on
 * `throng:linkPrompt:answer` only from that window's contents and only for that id. The window closing, its page
 * going away or its renderer crashing is Cancel, so a link is never left waiting. At most one is open:
 * `withExternalLinkPrompt` drops a second link while one is asked and calls `focusLinkPrompt`.
 *
 * The Help window's guide is a separate view drawn over its own page, so a dialog there would sit under it:
 * `cover` lets the Help window swap the view for a still of it while the prompt is up (`help-window.ts`).
 */
import { BrowserWindow, type WebContents } from 'electron';
import type { LinkPromptAnswer } from './external-link-prompt.js';

export interface LinkPromptDeps {
  getMainWindow: () => BrowserWindow | null;
  /** Change in Preferences: open Preferences at this setting (080 FR-064). */
  openPreferences: () => void;
  /** Make `win` ready to show the dialog over all of it; resolves the undo. The Help window's covers its guide. */
  cover?: (win: BrowserWindow) => Promise<() => void>;
}

/** What the window's prompt sends back. */
export type LinkPromptReply = LinkPromptAnswer | 'preferences';

interface Pending {
  id: number;
  win: BrowserWindow;
  settle: (reply: LinkPromptReply) => void;
}

let pending: Pending | null = null;
let nextId = 1;

/** The slice of `ipcMain` the answer channel needs. */
export interface LinkPromptIpcMain {
  on(channel: string, listener: (event: { sender: unknown }, id: unknown, reply: unknown) => void): void;
}

/** Wire the answer channel once, at start. */
export function registerLinkPromptIpc(ipc: LinkPromptIpcMain, deps: Pick<LinkPromptDeps, 'openPreferences'>): void {
  ipc.on('throng:linkPrompt:answer', (event, id, reply) => {
    const asked = pending;
    if (!asked || asked.win.isDestroyed() || event.sender !== asked.win.webContents || id !== asked.id) return;
    asked.settle(reply === 'open' ? 'open' : reply === 'preferences' ? 'preferences' : 'cancel');
    if (reply === 'preferences') deps.openPreferences();
  });
}

/** Bring the window showing the prompt forward (a second link while it is open). */
export function focusLinkPrompt(): void {
  const win = pending?.win;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

/** The window a link is being followed in, named by a caller that knows it (`openFromWindow`). */
let origin: BrowserWindow | null = null;

/**
 * Run `open` (which ends in `openExternal`) as a link followed in `win`, so its prompt asks that window, whichever
 * window has focus. The Help window's links leave from its guide view, which focus does not always name. The prompt
 * reads the window as it starts, so it is named only for the call.
 */
export function openFromWindow<T>(win: BrowserWindow | null, open: () => T): T {
  origin = win;
  try {
    return open();
  } finally {
    origin = null;
  }
}

/** Which window asks: the one a caller named, else the focused throng window, else the main window. */
function askingWindow(deps: LinkPromptDeps): BrowserWindow | undefined {
  if (origin && !origin.isDestroyed()) return origin;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const main = deps.getMainWindow();
  return main && !main.isDestroyed() ? main : undefined;
}

/**
 * How long the prompt waits for its window's cover (FR-070) before it asks without one. The Help window's cover is a
 * still from `capturePage`, which Windows can leave pending for a window it has not painted.
 */
export const LINK_PROMPT_COVER_MS = 1_000;

/** The cover's undo, or a no-op once the bound passes; a cover landing after that is undone as it lands. */
function boundedCover(cover: Promise<() => void>): Promise<() => void> {
  return new Promise((resolve) => {
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      resolve(() => undefined);
    }, LINK_PROMPT_COVER_MS);
    cover.then(
      (undo) => {
        if (late) undo();
        else {
          clearTimeout(timer);
          resolve(undo);
        }
      },
      () => {
        clearTimeout(timer);
        resolve(() => undefined);
      },
    );
  });
}

/** Ask the window the link was followed in; resolves `'open'` or `'cancel'`. */
export async function askToOpenLink(deps: LinkPromptDeps, url: string): Promise<LinkPromptAnswer> {
  // Read before the first await, while a caller's `openFromWindow` still names the window.
  const win = askingWindow(deps);
  // No window to ask is no one to say yes: the link does not open.
  if (!win) return 'cancel';
  const uncover = deps.cover ? await boundedCover(deps.cover(win)) : () => undefined;
  const contents: WebContents = win.webContents;
  const id = nextId++;
  const reply = await new Promise<LinkPromptReply>((resolve) => {
    let settled = false;
    const gone = (): void => settle('cancel');
    const settle = (answer: LinkPromptReply): void => {
      if (settled) return;
      settled = true;
      if (pending?.id === id) pending = null;
      win.removeListener('closed', gone);
      if (!contents.isDestroyed()) {
        contents.removeListener('did-start-navigation', gone);
        contents.removeListener('render-process-gone', gone);
      }
      resolve(answer);
    };
    pending = { id, win, settle };
    win.once('closed', gone);
    contents.once('did-start-navigation', gone);
    contents.once('render-process-gone', gone);
    contents.send('throng:linkPrompt:ask', { id, url });
  });
  uncover();
  return reply === 'open' ? 'open' : 'cancel';
}
