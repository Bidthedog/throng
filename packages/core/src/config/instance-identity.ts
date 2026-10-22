/**
 * One running throng per user — the pure half of the instance guard (058 FR-018, FR-018b;
 * contracts/instance-lock.md; research D5, D5a).
 *
 * The guard itself (`packages/ui/src/main/instance-guard.ts`) owns the pipe and Electron's lock.
 * Everything it decides with is here, OS-free and usable in every boundary including the renderer
 * (which is why this does its own path splitting rather than importing `node:path`):
 *
 *   - the lock's name, derived from the daemon pipe so it follows the namespace exactly (D8);
 *   - a copy's identity — the folder holding its executable, plus its version;
 *   - whether two identities are the same copy (case-insensitive, separators normalised — the same
 *     comparison `daemon-lifecycle.ts` `sameEntry` uses);
 *   - the one-line launch message a losing launch sends;
 *   - the different-copy notice's wording.
 */

/** Suffix that turns a namespace (the daemon pipe name) into its instance-lock pipe. */
export const INSTANCE_LOCK_SUFFIX = '.instance';

/** The instance-lock pipe for the namespace `pipeName`. */
export function instanceLockName(pipeName: string): string {
  return `${pipeName}${INSTANCE_LOCK_SUFFIX}`;
}

/** A copy of throng: where it is installed or extracted, and which version it is. */
export interface CopyIdentity {
  readonly installRoot: string;
  readonly version: string;
}

/** The folder holding `filePath`, splitting on either separator. */
function parentFolder(filePath: string): string {
  const cut = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return cut <= 0 ? filePath : filePath.slice(0, cut);
}

/** The identity of the copy whose executable is `execPath`. */
export function copyIdentity(execPath: string, version: string): CopyIdentity {
  return { installRoot: parentFolder(execPath), version };
}

/** An install root reduced to its comparable form. */
function comparableRoot(root: string): string {
  return root.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** True when `a` and `b` are the same copy — the same install root. The version is not compared. */
export function isSameCopy(a: Pick<CopyIdentity, 'installRoot'>, b: Pick<CopyIdentity, 'installRoot'>): boolean {
  return comparableRoot(a.installRoot) === comparableRoot(b.installRoot);
}

/**
 * True when a daemon entry script lies inside a packaged copy — under its `resources\app` tree
 * (throng is not asar-packed). A daemon started from a source checkout is not (058 research D7):
 * that is the line between a daemon another copy may replace and one it must leave alone.
 */
export function isPackagedEntry(entryPath: string): boolean {
  return entryPath.replace(/\\/g, '/').toLowerCase().includes('/resources/app/');
}

/**
 * What a losing launch tells the running instance. `version` is null when the launch arrived
 * through Electron's `second-instance` event from a pre-058 copy, which sends no data.
 */
export interface LaunchMessage {
  readonly execPath: string;
  readonly version: string | null;
}

/** Serialise a launch message as the one line the pipe carries. */
export function formatLaunchMessage(message: LaunchMessage): string {
  return `${JSON.stringify({ execPath: message.execPath, version: message.version })}\n`;
}

/** Parse one line from the instance pipe; anything not exactly a launch message is `null`. */
export function parseLaunchMessage(raw: string): LaunchMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { execPath, version } = record;
  if (typeof execPath !== 'string' || execPath === '') return null;
  if (!('version' in record) || (version !== null && typeof version !== 'string')) return null;
  return { execPath, version };
}

/** The facts the different-copy notice states (data-model `DifferentCopyNotice`). */
export interface DifferentCopyNotice {
  readonly runningRoot: string;
  readonly runningVersion: string;
  readonly launchedRoot: string;
}

/** The different-copy notice's wording (contracts/instance-lock.md). */
export function differentCopyNoticeText(notice: DifferentCopyNotice): string {
  return (
    `throng is already running from ${notice.runningRoot} (version ${notice.runningVersion}). ` +
    `To open the copy at ${notice.launchedRoot}, close this one first.`
  );
}
