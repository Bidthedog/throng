/**
 * Which renderer-supplied URLs main hands to the platform seam's `openExternal` — ONE POLICY PER CALLER
 * (020 FR-003a; 024 US7 / FR-019; 044 FR-091 — R10).
 *
 * | Caller | Channel | Opens |
 * |---|---|---|
 * | About links, terminal links (024 US7) | `throng:openExternal` | `http:`, `https:` |
 * | `window.open` from any renderer (024 FR-019b) | the window-open guard | `http:`, `https:` |
 * | a Markdown preview's links (044 FR-091) | `throng:preview:openExternal` | `http:`, `https:`, `mailto:` |
 * | a terminal's and an editor's links (045 FR-157 – FR-159) | `throng:linkUri:openExternal` | `http:`, `https:`, and allowlisted schemes not refused |
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
import {
  CORE_REFUSED_URI_SCHEMES,
  protocolAllowlistSet,
  resourceClass,
  sanitiseLinkTarget,
  type IForegroundHandoff,
  type IRefusedUriSchemes,
  type IShellIntegration,
} from '@throng/core';

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

/**
 * 045 FR-156 – FR-159 — the value a terminal's or an editor's link hands the OS URL opener, or `null`.
 *
 * Re-sanitised here, because the renderer is not trusted to have done it (FR-156): a control character
 * or a NUL refuses it, and a crafted tail is cut, so what opens is the ONE sanitised value. `file:` is
 * refused always — a `file:` URI never reaches the OS URL opener (FR-037) — and otherwise the link's
 * class decides (`resourceClass`, the one scheme gate): web and loopback open; a protocol link opens
 * only while its scheme is allowlisted AND not refused, refused winning (FR-159).
 */
export function allowedLinkUri(
  url: unknown,
  allowlist: ReadonlySet<string>,
  refused: ReadonlySet<string>,
): string | null {
  if (typeof url !== 'string') return null;
  const clean = sanitiseLinkTarget(url);
  if (!clean.ok) return null;
  if (/^file:/i.test(clean.value)) return null;
  const cls = resourceClass(clean.value, allowlist, refused);
  return cls === 'web' || cls === 'loopback' || cls === 'protocol' ? clean.value : null;
}

/** {@link allowedLinkUri} as a predicate — what the policy table above calls the channel's rule. */
export function isAllowedLinkUri(
  url: unknown,
  allowlist: ReadonlySet<string>,
  refused: ReadonlySet<string>,
): url is string {
  return allowedLinkUri(url, allowlist, refused) !== null;
}

/** The subset of `ipcMain` the `throng:linkUri:*` channels register on. */
export interface LinkUriIpcMain {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

/**
 * 045 round four (plan twelfth and thirteenth passes) — the `throng:linkUri:*` channels: the ONE route
 * a web, loopback or allowlisted protocol link takes out of the app, from a terminal or an editor.
 *
 * A NEW registration beside {@link registerOpenExternalIpc}, whose `{ on }`-only signature and policies
 * stay exactly as they are: About and the window-open guard keep `http(s)` only, and a preview keeps
 * 044's own `mailto:`. This channel's policy is the link's: the allowlist is READ PER REQUEST, so an
 * edit takes effect on the next gesture with no restart (FR-159), and the refused set is core's
 * OS-neutral half united with the platform's (`IRefusedUriSchemes`).
 *
 * The foreground is handed on before the open, once per accepted URI and never for a refused one —
 * the same reasoning as {@link registerOpenExternalIpc}'s. Protocol handlers are NOT de-elevated this
 * round (plan round four, *Reported to the maintainer* item 10).
 */
export function registerLinkUriIpc(
  ipc: LinkUriIpcMain,
  refused: IRefusedUriSchemes,
  readAllowlist: () => readonly string[],
  shell: IShellIntegration,
  foregroundHandoff: IForegroundHandoff,
  log: (line: string) => void = () => {},
): void {
  const refusedAll: ReadonlySet<string> = new Set([
    ...CORE_REFUSED_URI_SCHEMES,
    ...refused.refusedSchemes(),
  ]);
  // T288 (research R34): the platform's half, asked once per window by `refused-schemes-client.ts` so
  // a refused scheme is never DRAWN as a link either. A list, not a Set, across the bridge.
  ipc.handle('throng:linkUri:refusedSchemes', () => [...refused.refusedSchemes()]);
  ipc.on('throng:linkUri:openExternal', (_event, url) => {
    const value = allowedLinkUri(url, protocolAllowlistSet(readAllowlist()), refusedAll);
    if (value === null) return;
    log(`open-link-uri: ${value}`);
    foregroundHandoff.allow();
    void shell.openExternal(value);
  });
}
