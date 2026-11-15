/**
 * The `throng` command on the user's PATH (070 FR-024a, research R20, data-model.md *ICommandLineInstall*).
 *
 * Where a platform's installer already puts `throng` on the path (Windows, Linux), the seam is unavailable and its
 * actions do not appear. On macOS a link in `/usr/local/bin` points at a script inside the app bundle.
 *
 * State transitions: `absent → ours` (install); `other → ours` (install with `replaceOther`, after the user
 * confirms); `ours → absent` (uninstall); `ours → ours-broken` (bundle moved, observed at start); `ours-broken → ours`
 * (install).
 */
export type CommandLineStatus =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ours'; readonly linkPath: string }
  /** The link points at a throng bundle that has moved or gone. */
  | { readonly kind: 'ours-broken'; readonly linkPath: string; readonly target: string }
  /** Something that is not throng's has the name. */
  | { readonly kind: 'other'; readonly linkPath: string; readonly target: string };

export interface ICommandLineInstall {
  readonly available: boolean;
  /** Why not, in words for the user, when `available` is false. */
  readonly unavailableReason?: string;
  status(): Promise<CommandLineStatus>;
  /**
   * Put the command in place. Rejects with a reason when the user declines the system prompt, when the install fails,
   * or when something else has the name and `replaceOther` is false. Never replaces another program's link unasked.
   */
  install(opts: { readonly replaceOther: boolean }): Promise<CommandLineStatus>;
  /** Remove the command, only when it is throng's own. Answers the state afterwards. */
  uninstall(): Promise<CommandLineStatus>;
}

/** The seam where the platform's installer owns the command (Windows, Linux): no actions, a stated reason. */
export class NoCommandLineInstall implements ICommandLineInstall {
  readonly available = false;

  constructor(readonly unavailableReason: string) {}

  async status(): Promise<CommandLineStatus> {
    return { kind: 'absent' };
  }

  install(): Promise<CommandLineStatus> {
    return Promise.reject(new Error(this.unavailableReason));
  }

  uninstall(): Promise<CommandLineStatus> {
    return Promise.reject(new Error(this.unavailableReason));
  }
}
