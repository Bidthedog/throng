/**
 * IShellIntegration (Principle II) — OS file-manager integration for the
 * "Open in file explorer" action (FR-035), plus opening a URL in the OS default
 * handler (044 FR-091 — R10). The abstract contract only; the concrete
 * Electron-`shell`-backed implementation lives in the UI main process
 * (research D10). No OS calls here.
 */
/**
 * 045 FR-036, T229 (`contracts/platform-ports.md` §7.2) — what an OS action the user asked for by name
 * came to. A refusal is a VALUE carrying the OS's own words, so the one notice that reports it can name
 * them; `osReason` rather than `reason`, which is `LinkActionOutcome`'s discriminant.
 */
export type ShellActionResult = { readonly ok: true } | { readonly ok: false; readonly osReason: string };

export interface IShellIntegration {
  /**
   * Open the OS file manager with `path` SELECTED in its parent folder (files). Resolves
   * `{ ok: false, osReason }` when the OS refuses, never rejects for that (T229).
   */
  revealInFileManager(path: string): Promise<ShellActionResult>;
  /** Open `path` (a folder) so the manager shows ITS CONTENTS (folders/root). */
  openFolder(path: string): Promise<void>;
  /**
   * Open `url` in the OS default handler — a browser for `http:`/`https:`, the default mail client
   * for `mailto:` (044 FR-091). The caller has already validated the scheme; this seam trusts it.
   */
  openExternal(url: string): Promise<void>;
  /**
   * 045 FR-036. Open a FILE in the application the OS associates with it.
   *
   * A **file**, deliberately: FR-030 makes this a file-only link target, and a folder is served by
   * `openFolder`. An implementation refuses a folder and a path that has gone, and a refusal — those
   * two, or the OS's own — resolves `{ ok: false, osReason }` naming the path and a reason, so one
   * notice can carry both (SI1–SI3, the *one condition, one notice* rule; §7.2). This is the ONLY route
   * by which a link can run an executable, and only when the user chooses it by name — FR-039 keeps
   * every gesture away from it. Open Program is this call on an executable (FR-170, S8).
   */
  openWithDefaultProgram(path: string): Promise<ShellActionResult>;
}
