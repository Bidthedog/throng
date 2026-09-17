/**
 * Which renderer-supplied URLs main hands to the platform seam's `openExternal` — ONE POLICY PER CALLER
 * (020 FR-003a; 024 US7 / FR-019; 044 FR-091 — R10).
 *
 * | Caller | Channel | Opens |
 * |---|---|---|
 * | About links, terminal links (024 US7) | `throng:openExternal` | `http:`, `https:` |
 * | `window.open` from any renderer (024 FR-019b) | the window-open guard | `http:`, `https:` |
 * | a Markdown preview's links (044 FR-091) | `throng:preview:openExternal` | `http:`, `https:`, `mailto:` |
 *
 * Anything else — `javascript:`, `file:`, `data:`, a shell path — is refused everywhere, so a crafted
 * manifest entry, a hostile terminal URL or a hostile document cannot run code or open a local file.
 *
 * ## Why two predicates and not one wider one
 *
 * 044 first widened the single check to accept `mailto:` for every caller. 024 FR-019 is explicit that a
 * terminal opens `http` and `https` ONLY, naming `mailto:` among the schemes it must not open, and 044
 * never superseded it — the terminal renderer's own filter was then the only thing keeping it true. Main
 * enforces it again, per caller (adversarial review ruling). Every caller is a renderer, so the channel a
 * request arrives on IS the caller; there is no flag in the payload for a renderer to set.
 */
import type { IForegroundHandoff, IShellIntegration } from '@throng/core';

const HTTP = /^https?:\/\//i;
const MAILTO = /^mailto:/i;

/** About, terminal links and the window-open guard: `http:` and `https:` only (024 FR-019). */
export function isSafeExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && HTTP.test(url);
}

/** A Markdown preview's external links: `http:`, `https:` and `mailto:` (044 FR-091). */
export function isSafePreviewLinkUrl(url: unknown): url is string {
  return typeof url === 'string' && (HTTP.test(url) || MAILTO.test(url));
}

/** The subset of `ipcMain` this registers on. */
export interface OpenExternalIpcMain {
  on(channel: string, listener: (event: unknown, url: unknown) => void): void;
}

/**
 * The two open-external channels, each behind its caller's policy — and both handing the foreground
 * on before they open (044 FR-119).
 *
 * ══ Why the handoff, and why it is the same call #199 made ══
 *
 * Windows only lets the process that already OWNS the foreground hand it on. throng owns it here:
 * the Ctrl+click landed in a throng window. The browser does not — and when it is ALREADY RUNNING,
 * `ShellExecute` does not start a process, it hands the URL to that existing one, whose
 * `SetForegroundWindow` the OS then refuses. The result is the reported symptom: the browser flashes
 * and throng stays in front. (With no browser running, the new process gets the foreground under the
 * OS's started-by-the-foreground-process rule, which is why the two cases behave differently.)
 *
 * `IForegroundHandoff.allow()` — `AllowSetForegroundWindow(ASFW_ANY)` — is the sanctioned hand-on,
 * and #199 already established it for the same lock met from a terminal. Here, as there:
 * - the grant is made by main, the process that owns the window, because nowhere else may make it;
 * - it is made at the moment of the user's own action, which is the only moment throng can honestly
 *   attribute the new window to them, and the scope the OS gives it (it decays with the user's next
 *   input elsewhere);
 * - it is made ONCE per accepted URL, after the scheme check, so a refused `javascript:` never buys
 *   a stranger the foreground;
 * - its result is ignored. A hint to the window manager must not decide whether a link opens, and
 *   the value means nothing on its own — see the seam's own note on why no test may assert it.
 */
export function registerOpenExternalIpc(
  ipc: OpenExternalIpcMain,
  shell: IShellIntegration,
  foregroundHandoff: IForegroundHandoff,
  /**
   * One line per accepted open (#198). A double-opened link left nothing in any log, so a report of
   * two browser tabs could not say whether throng asked twice or something else opened the second.
   */
  log: (line: string) => void = () => {},
): void {
  const handOverAndOpen = (url: string): void => {
    log(`open-external: ${url}`);
    foregroundHandoff.allow();
    void shell.openExternal(url);
  };
  // The licence link opens in the user's default browser — no in-app navigation, so the sandboxed About
  // window is never replaced by a view of gnu.org — and so does a terminal's link (024 US7).
  ipc.on('throng:openExternal', (_event, url) => {
    if (isSafeExternalUrl(url)) handOverAndOpen(url);
  });
  ipc.on('throng:preview:openExternal', (_event, url) => {
    if (isSafePreviewLinkUrl(url)) handOverAndOpen(url);
  });
}
