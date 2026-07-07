/**
 * IShellDetection (Principle II, 005 Phase B) — detects terminal shells actually
 * installed on the machine, for the built-in flavour catalogue (FR-010, SC-003).
 * The abstract contract only; the concrete probe lives in `@throng/platform-windows`
 * (`WindowsShellDetection`) and is instantiated in UI main (inline, like 004's
 * `NodeFileSystem`). No OS calls here.
 */

/** A shell detected as present on the machine. */
export interface DetectedShell {
  /** Stable built-in id (e.g. 'windows-powershell', 'pwsh', 'cmd', 'git-bash'). */
  id: string;
  /** Human label for the Flavour dropdown. */
  label: string;
  /** Executable path or command resolvable on this machine. */
  file: string;
  /** Base arguments inherent to launching this shell (before user Startup Params). */
  defaultArgs: string[];
}

export interface IShellDetection {
  /**
   * The shells installed on this machine (built-in catalogue ∩ present). Returns
   * an array (possibly empty — the no-shells edge); side-effect-free; does not
   * spawn shells merely to list them.
   */
  detectInstalledShells(): Promise<DetectedShell[]>;
}
