/**
 * Three seams 062 adds (FR-049). Written in terms of behaviour, so each of Windows, Linux and macOS can supply its own
 * without changing a caller. Contract suites are in `@throng/core/testing`.
 */

/** Where this user's settings and data live on this platform. `dev` keeps a source run apart from an installed one. */
export interface IUserDirectories {
  configRoot(devMode: boolean): string;
  dataDir(devMode: boolean): string;
  /** Make a folder ready to hold user data, private to its owner where the platform can say so. */
  prepare(dir: string): void;
}

/** Puts a deleted item back. Rejects with a plain reason when it cannot, and never replaces what is there now. */
export interface ITrashRestore {
  /** `deletedAt` (epoch ms) picks among several deletions of one path: the closest at or before it. */
  restore(originalPath: string, deletedAt: number): Promise<void>;
}

/** Which volume a path is on, for gating checks that may hang (045 FR-121). */
export interface IVolumeRoots {
  rootOf(path: string): string;
  /** Whether a root is on someone else's machine, so that a full stuck map may gate it. */
  isNetwork(root: string): boolean;
}

/** One process, as the orphan sweep needs it. `ppid` is -1 when the platform says it has no living parent. */
export interface OrphanCandidate {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
  readonly createdMs: number;
  readonly commandLine: string;
}

/** The process table and the means to end one process, for the daemon's startup sweep. */
export interface IOrphanProcesses {
  snapshot(): Promise<OrphanCandidate[]>;
  /** Ends `pid` and reports whether that could be attempted. */
  kill(pid: number): boolean | Promise<boolean>;
}
