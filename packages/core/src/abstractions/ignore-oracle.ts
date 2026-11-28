/**
 * Which explorer entries the project's version control ignores (081 US8, FR-070 – FR-073).
 *
 * The answer comes from git itself, so `.gitignore` at every level, `.git/info/exclude`, the user's global excludes
 * and a nested repository's own rules all apply as git applies them. A project no repository holds still has its
 * `.gitignore` files applied, read from the project root (FR-073). The explorer only fades what this names; what it
 * shows and hides stays `explorer.excludeGlobs`' (FR-074).
 */
export interface IgnoreOracle {
  /**
   * Which of `relPaths` git ignores. Paths are posix and relative to `root`; a folder carries a trailing `/`, so
   * directory-only patterns match, and comes back spelt as it was asked. Never rejects: with git unavailable the answer
   * is empty (FR-073). Empty `relPaths` answers empty without asking git.
   */
  ignored(root: string, relPaths: readonly string[]): Promise<ReadonlySet<string>>;
}

/** The oracle for a host with no version control to ask: nothing is ignored. */
export const NoIgnoreOracle: IgnoreOracle = {
  ignored: () => Promise.resolve(new Set<string>()),
};
