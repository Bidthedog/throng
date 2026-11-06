/**
 * Log rotation and retention, decided purely (#123, 066 FR-018 – FR-020).
 *
 * The daemon outlives the UI and can run for days, so an unbounded log is not a tidiness problem
 * but a disk-filling one — and the process it would fill the disk of is the user's, in the
 * background, with no console to warn them. The policy is injected (Constitution Principle X) and
 * the DECISIONS are here, separate from the file operations, so both halves can be tested: one
 * without a disk, the other against a real directory.
 *
 * Two separate rules:
 * - **Roll-over** — a file that reaches `maxFileBytes` is renamed to its next generation and a fresh
 *   one started. Nothing is deleted by rolling over.
 * - **Retention** — the folder keeps the files of the last `keepDays` ACTIVE days (days throng wrote
 *   anything, so a fortnight away does not empty it), then trims oldest-first to `maxTotalBytes`.
 *   This replaces 031 FR-015's keep-N-files rule (066 FR-020).
 */

const MB = 1024 * 1024;

export interface RetentionPolicy {
  /** How many distinct days with log activity to keep. */
  keepDays: number;
  /** The most the logs folder may hold; the oldest files go first. */
  maxTotalBytes: number;
  /** Roll a file over once it would exceed this many bytes. */
  maxFileBytes: number;
}

/** Three active days, a 100 MB folder, 1 MiB files (066 clarifications Q2, Q3). */
export const DEFAULT_RETENTION: RetentionPolicy = { keepDays: 3, maxTotalBytes: 100 * MB, maxFileBytes: 1_048_576 };

/** The bounds a configured policy is clamped to; `maxTotalBytes`' ceiling is the setting's hardMax. */
export const RETENTION_BOUNDS = {
  keepDays: { min: 1, max: 30 },
  maxTotalBytes: { min: 50 * MB, max: 65_536 * MB },
  maxFileBytes: { min: 1024 },
} as const;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp a configured policy into one that cannot misbehave. */
export function normaliseRetention(policy: Partial<RetentionPolicy> | undefined): RetentionPolicy {
  const keepDays = Math.floor(finiteOr(policy?.keepDays, DEFAULT_RETENTION.keepDays));
  const maxTotalBytes = Math.floor(finiteOr(policy?.maxTotalBytes, DEFAULT_RETENTION.maxTotalBytes));
  const maxFileBytes = Math.floor(finiteOr(policy?.maxFileBytes, DEFAULT_RETENTION.maxFileBytes));
  return {
    keepDays: Math.min(RETENTION_BOUNDS.keepDays.max, Math.max(RETENTION_BOUNDS.keepDays.min, keepDays)),
    maxTotalBytes: Math.min(RETENTION_BOUNDS.maxTotalBytes.max, Math.max(RETENTION_BOUNDS.maxTotalBytes.min, maxTotalBytes)),
    maxFileBytes: Math.max(RETENTION_BOUNDS.maxFileBytes.min, maxFileBytes),
  };
}

/**
 * Whether writing `incomingBytes` to a file already `currentBytes` long should roll over FIRST.
 *
 * Checked before the write, not after, so a single enormous record cannot leave a file over the
 * limit until the next one happens along. A record larger than the whole budget still gets written
 * (truncating a stack trace to satisfy a size cap would defeat the point of keeping it) — it simply
 * lands in a freshly rotated file of its own.
 */
export function shouldRotate(currentBytes: number, incomingBytes: number, maxFileBytes: number): boolean {
  return currentBytes > 0 && currentBytes + incomingBytes > maxFileBytes;
}

/** The generation-suffixed name of a rotated file: `main.log` → `main.1.log`. */
export function rotatedName(baseName: string, generation: number): string {
  const dot = baseName.lastIndexOf('.');
  return dot <= 0
    ? `${baseName}.${generation}`
    : `${baseName.slice(0, dot)}.${generation}${baseName.slice(dot)}`;
}

/** The name the live file rolls over to: one past the highest generation already present. */
export function nextRotatedName(baseName: string, existingNames: readonly string[]): string {
  const dot = baseName.lastIndexOf('.');
  const stem = dot <= 0 ? baseName : baseName.slice(0, dot);
  const ext = dot <= 0 ? '' : baseName.slice(dot);
  let highest = 0;
  for (const name of existingNames) {
    if (!name.startsWith(`${stem}.`) || !name.endsWith(ext)) continue;
    const middle = name.slice(stem.length + 1, name.length - ext.length);
    if (/^\d+$/.test(middle)) highest = Math.max(highest, Number(middle));
  }
  return rotatedName(baseName, highest + 1);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** The local calendar day of a timestamp, `YYYYMMDD` — the user's day, not UTC's. */
export function logDayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** A process's log file for one session: `<component>-YYYYMMDD-HHMMSS-<pid>.log`, local time. */
export function sessionFileName(component: string, startedAt: Date, pid: number): string {
  const time = `${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}`;
  return `${component}-${logDayOf(startedAt.getTime())}-${time}-${pid}.log`;
}

/** One file in the logs folder, as retention sees it. */
export interface LogFileInfo {
  name: string;
  bytes: number;
  /** Last write. A file's day is the day it was last written, so a live file is always today's. */
  modifiedMs: number;
}

/**
 * The logs a process reopens under the same name every run — UI main's, the daemon's, and the daemon's
 * stdout/stderr file. Whichever process owns one may hold it open however long ago it last wrote.
 */
export const FIXED_LOG_NAMES: readonly string[] = ['main.log', 'daemon.log', 'daemon-startup.log'];

/**
 * The pid that owns a per-process log, from its name: a session file (`pty-agent-20261106-090507-4242.log`,
 * rolled or not) or a legacy agent log (`throng-agent-123.log`). A fixed name (`main.log`, `daemon.log`,
 * `daemon-startup.log`) has none: whichever process owns it reuses it.
 */
export function logFilePid(name: string): number | undefined {
  const match = /-\d{8}-\d{6}-(\d+)(?:\.\d+)?\.log$/.exec(name) ?? /^throng-agent-(\d+)\.log$/.exec(name);
  return match ? Number(match[1]) : undefined;
}

export interface RetentionPlan {
  delete: readonly string[];
  trimmedBytes: number;
}

/**
 * A file that has been rolled over (`x.3.log`) is closed, and so is a crash report (`crashes/…`, written
 * whole); any other file may still be some process's live log.
 */
function isClosed(name: string): boolean {
  return name.includes('/') || /\.\d+\.[^.]+$/.test(name) || /\.\d+$/.test(name);
}

/**
 * What to delete from the logs folder (FR-019, FR-019a).
 *
 * 1. Keep files whose day is among the last `keepDays` distinct days present, today always counted.
 * 2. Of those, while the total exceeds `maxTotalBytes`, delete the oldest first.
 * Never an un-rotated file that may still be some process's live log: one written `today`, or one
 * `isLive` says a running process holds — a quiet daemon's `daemon-startup.log` can go days without a
 * write. On Linux deleting a live file leaves its writer appending to an unlinked inode, a log nobody can
 * read. The caller decides liveness (it can ask the OS; core cannot).
 */
export function retentionPlan(
  files: readonly LogFileInfo[],
  policy: RetentionPolicy,
  today: string,
  isLive: (name: string) => boolean = () => false,
): RetentionPlan {
  const { keepDays, maxTotalBytes } = normaliseRetention(policy);
  const dayOf = new Map(files.map((f) => [f, logDayOf(f.modifiedMs)]));
  const protectedFile = (f: LogFileInfo): boolean => !isClosed(f.name) && (dayOf.get(f) === today || isLive(f.name));

  // Today is always an active day: the caller is running, and about to write, today.
  const days = [...new Set([today, ...dayOf.values()])].sort().reverse();
  const keptDays = new Set(days.slice(0, keepDays));

  const doomed: LogFileInfo[] = [];
  const kept: LogFileInfo[] = [];
  for (const f of files) {
    if (keptDays.has(dayOf.get(f) ?? '') || protectedFile(f)) kept.push(f);
    else doomed.push(f);
  }

  let total = kept.reduce((sum, f) => sum + f.bytes, 0);
  for (const f of [...kept].sort((a, b) => a.modifiedMs - b.modifiedMs)) {
    if (total <= maxTotalBytes) break;
    if (protectedFile(f)) continue;
    doomed.push(f);
    total -= f.bytes;
  }

  return { delete: doomed.map((f) => f.name), trimmedBytes: doomed.reduce((sum, f) => sum + f.bytes, 0) };
}
