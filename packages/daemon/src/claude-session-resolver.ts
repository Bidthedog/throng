import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  isClaudeCodeProcess,
  logExpected,
  splitWindowsCommandLine,
  type ClaudeSessionMiss,
  type ClaudeSessionProcess,
  type IClaudeSessionResolver,
  type IProcessIdentity,
} from '@throng/core';

/** How far Claude Code's own recorded start (epoch ms) may sit from the process table's where the OS has no tick marker (Windows): generous for Claude's startup, far below a pid-reuse gap. */
const START_TOLERANCE_MS = 15_000;

/** Identities are cached per pid and start time; a long-lived daemon sees many processes, so the cache is bounded. */
const MAX_CACHED_IDENTITIES = 256;

/** Claude Code's session ids are UUIDs; anything else is never put into a command line. */
const SESSION_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export interface ClaudeSessionResolverDeps {
  /** Claude Code's config dir: `CLAUDE_CONFIG_DIR`, else the home folder's `.claude`. */
  readonly configDir: string;
  readonly os: 'windows' | 'linux';
  readonly identity: IProcessIdentity;
  /** Bound on one whole `resolve` call. */
  readonly timeoutMs: number;
  readonly readFile?: (path: string) => Promise<string>;
}

type Identity = { argv: readonly string[] | undefined; marker: string | undefined };
type Outcome = { sessionId: string; argv: readonly string[] } | { none: ClaudeSessionMiss };

/** The config dir Claude Code uses for this process environment (068 FR-049). */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.CLAUDE_CONFIG_DIR;
  return set !== undefined && set !== '' ? set : join(homedir(), '.claude');
}

/**
 * Finds the running Claude Code session behind a terminal's foreground process (068 FR-043).
 *
 * Reads only `sessions/<pid>.json`'s `pid`, `sessionId` and `procStart` (FR-049) — never a `.key`
 * file, never a conversation. The process's identity (argv, start marker) is cached by pid and
 * start time because it cannot change; the record is read afresh each call because Claude Code
 * rewrites it in place when the session changes (FR-044). It only reads, so a terminal that is
 * still running is never touched (Principle III).
 */
export class ClaudeSessionResolver implements IClaudeSessionResolver {
  private readonly identities = new Map<string, Promise<Identity>>();
  private readonly read: (path: string) => Promise<string>;

  /** How many process identities are held (a test seam for the bound). */
  get cachedIdentityCount(): number {
    return this.identities.size;
  }

  constructor(private readonly deps: ClaudeSessionResolverDeps) {
    this.read = deps.readFile ?? ((path) => readFile(path, 'utf8'));
  }

  async resolve(foreground: ClaudeSessionProcess, descendants: readonly ClaudeSessionProcess[]): Promise<Outcome> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<Outcome>((resolve) => {
      timer = setTimeout(() => resolve({ none: 'timeout' }), this.deps.timeoutMs);
      timer.unref();
    });
    try {
      return await Promise.race([this.resolveWithin(foreground, descendants), timeout]);
    } catch (error) {
      logExpected('claude-session-resolver: resolve', 'a process can exit mid-read; no session is reported and the plain command is kept', error);
      return { none: 'unreadable' };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async resolveWithin(foreground: ClaudeSessionProcess, descendants: readonly ClaudeSessionProcess[]): Promise<Outcome> {
    const candidates = [foreground, ...descendants].filter(isClaudeCodeProcess);
    if (candidates.length === 0) return { none: 'not-claude' };
    let firstMiss: ClaudeSessionMiss | undefined;
    for (const candidate of candidates) {
      const outcome = await this.resolveOne(candidate);
      if ('sessionId' in outcome) return outcome;
      firstMiss ??= outcome.none;
    }
    return { none: firstMiss ?? 'no-record' };
  }

  private identityOf(proc: ClaudeSessionProcess): Promise<Identity> {
    const key = `${proc.pid}:${proc.startedAt}`;
    let known = this.identities.get(key);
    if (known !== undefined) {
      // Most recently used last, so the oldest entry is the one a full cache gives up.
      this.identities.delete(key);
      this.identities.set(key, known);
    } else {
      known = Promise.all([this.deps.identity.argv(proc.pid), this.deps.identity.startMarker(proc.pid)]).then(([argv, marker]) => ({
        argv,
        marker,
      }));
      this.identities.set(key, known);
      while (this.identities.size > MAX_CACHED_IDENTITIES) {
        const oldest = this.identities.keys().next().value as string;
        this.identities.delete(oldest);
      }
      // A rejected read must not be cached.
      known.catch((error: unknown) => {
        this.identities.delete(key);
        logExpected('claude-session-resolver: read process identity', 'the process may have exited; the caller reports the miss', error);
      });
    }
    return known;
  }

  private async resolveOne(proc: ClaudeSessionProcess): Promise<Outcome> {
    const identity = await this.identityOf(proc);
    const argv = identity.argv ?? (this.deps.os === 'windows' ? splitWindowsCommandLine(proc.commandLine) : undefined);
    if (argv === undefined || argv.length === 0) return { none: 'unreadable' };

    let text: string;
    try {
      text = await this.read(join(this.deps.configDir, 'sessions', `${proc.pid}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { none: 'no-record' };
      logExpected('claude-session-resolver: read record', 'the record may be unreadable by this user; the plain command is kept', error);
      return { none: 'unreadable' };
    }

    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch (error) {
      logExpected('claude-session-resolver: parse record', 'Claude Code may be mid-rewrite of its record; the plain command is kept', error);
      return { none: 'unreadable' };
    }
    if (typeof record !== 'object' || record === null) return { none: 'unreadable' };
    const { pid, sessionId, procStart, startedAt } = record as Record<string, unknown>;
    if (typeof pid !== 'number' || typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return { none: 'unreadable' };
    // Which field identifies the process depends on how the platform can say when it started: only the one used is required.
    const usesTicks = identity.marker !== undefined;
    if (usesTicks ? typeof procStart !== 'string' : typeof startedAt !== 'number') return { none: 'unreadable' };
    const sameStart = usesTicks ? procStart === identity.marker : Math.abs((startedAt as number) - proc.startedAt) <= START_TOLERANCE_MS;
    if (pid !== proc.pid || !sameStart) return { none: 'mismatch' };
    return { sessionId, argv };
  }
}
