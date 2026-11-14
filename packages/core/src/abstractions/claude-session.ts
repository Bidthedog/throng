/** A process the resolver is asked about: what the daemon already holds from the process table. */
export interface ClaudeSessionProcess {
  pid: number;
  /** The `ChildProcess` start time the daemon already holds. */
  startedAt: number;
  commandLine: string;
  executablePath?: string;
}

/** Why no session was identified (068 FR-047); logged at debug, never raised as a notice. */
export type ClaudeSessionMiss = 'not-claude' | 'no-record' | 'mismatch' | 'unreadable' | 'timeout';

/**
 * What only the operating system knows about a process, read to match it against Claude Code's
 * session record (068 FR-043). Each answer is absent when the platform cannot give it: the
 * resolver then falls back to what the process table already reported.
 */
export interface IProcessIdentity {
  /** The process's real argument vector, not a re-split command line. */
  argv(pid: number): Promise<readonly string[] | undefined>;
  /** The platform's own start marker, in its own units (Linux: /proc stat start ticks, as a string). */
  startMarker(pid: number): Promise<string | undefined>;
}

/** Reads Claude Code's own session record for a running process (068 FR-043, FR-049). */
export interface IClaudeSessionResolver {
  /** The running Claude Code session for this process tree, or a reason it has none. Never throws. */
  resolve(
    foreground: ClaudeSessionProcess,
    descendants: readonly ClaudeSessionProcess[],
  ): Promise<{ sessionId: string; argv: readonly string[] } | { none: ClaudeSessionMiss }>;
}
