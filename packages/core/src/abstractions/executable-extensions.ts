/**
 * Would the operating system RUN this file if it were opened? (045 FR-039a; Principle II.)
 *
 * FR-039 turns a Ctrl+click on an executable into a reveal rather than a launch, and that rule is
 * only as good as this answer. `@throng/core` must not name a single extension — the list is an OS
 * fact, it differs per platform, and on Windows the user can change part of it — so the rule lives
 * in core and the list lives behind this port.
 *
 * ══ TWO MEMBERS, AND THE SECOND IS WHY SC-010 CAN BE A TEST ══
 *
 * `isExecutable` is what the feature calls. `executableExtensions` is what the TEST calls: SC-010
 * asks that *every* extension the classification considers executable be unreachable by a click, at
 * every setting, and a success criterion written as a hand-copied list goes stale the first time an
 * implementation adds one. Reporting the set lets the assertion iterate whatever the implementation
 * actually believes, so the criterion and the code cannot drift apart.
 */
export interface IExecutableExtensions {
  /**
   * Answered from the file's EXTENSION alone — never from its contents, and never from a permission
   * bit. The answer is read at the time of the call, so a change the user makes to the OS's own list
   * takes effect without restarting throng. A folder is never executable.
   */
  isExecutable(path: string): boolean;

  /**
   * Every extension this implementation currently considers executable, each including its leading
   * dot. Read at the time of the call, for the same reason `isExecutable` is.
   */
  executableExtensions(): readonly string[];
}
