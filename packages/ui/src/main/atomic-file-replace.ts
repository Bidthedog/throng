/**
 * Replace a file's content all-or-nothing: stage the bytes in a temp sibling, then rename it over the
 * target. Shared by the config store (settings, themes, key bindings) and the editor save (#706), so a
 * write that fails part-way — a full disk, a dropped share — leaves the file exactly as it was.
 *
 * What a rename does NOT keep, and every caller accepts: the file gets a new inode, so a hard link to
 * the old one no longer sees the change, and identity beyond the mode bits (owner, ACLs, xattrs, a
 * creation time on some filesystems) is the new file's, not the old one's.
 */
import { access, chmod, constants, lstat, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { logCaught, logExpected } from '@throng/core';

/**
 * Rename failures that are worth retrying (issue #75).
 *
 * On Windows a replace-rename fails with EPERM/EACCES/EBUSY while ANOTHER process holds a
 * handle on the target without share-delete — Defender, the search indexer, or our own
 * watcher reading the file it was just told changed. The handle is released milliseconds later,
 * so the operation is not really failing, it is arriving early. Every other errno (a missing
 * source, a bad path) is a real fault and is reported at once rather than retried into a stall.
 */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Ceiling on the retry window. Comfortably longer than a scanner's handle (tens of ms), and
 *  far short of any caller's patience — a write that has not landed in a second has really failed. */
const RENAME_RETRY_BUDGET_MS = 1_000;
const RENAME_RETRY_INTERVAL_MS = 20;

/** Did this fail because the path does not exist? */
export function isAbsent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `op`, retrying it while it fails with a transient sharing violation, within a bounded budget.
 * Any other failure, or one that outlasts the budget, is thrown at once.
 */
export async function withTransientRetry<R>(op: () => Promise<R>): Promise<R> {
  const deadline = Date.now() + RENAME_RETRY_BUDGET_MS;
  for (;;) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!TRANSIENT_RENAME_CODES.has(code) || Date.now() >= deadline) throw err;
      await delay(RENAME_RETRY_INTERVAL_MS);
    }
  }
}

/**
 * `rename`, retried while the target is transiently locked (issue #75). Bounded so a genuinely stuck
 * handle surfaces as a failure instead of hanging the write.
 */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  await withTransientRetry(() => rename(from, to));
}

/**
 * What an atomic replace should rename onto. A rename onto a symlink replaces the link, which on Linux is how a file
 * kept in a dotfiles repository would quietly stop being kept there (062 FR-023). So a link is followed, and the
 * temp file is staged beside the real file, because a rename cannot cross filesystems.
 */
export async function replaceTarget(path: string): Promise<string> {
  const info = await lstat(path).catch((e: unknown) => {
    if (isAbsent(e)) logExpected('atomic-replace: inspect write target', 'a file written for the first time does not exist yet', e);
    else logCaught('atomic-replace: inspect write target', e);
    return null;
  });
  return info?.isSymbolicLink() ? realpath(path) : path;
}

/**
 * A replaced file keeps the permissions it had (062 FR-023), and a read-only one is refused: on Windows the rename fails,
 * but a POSIX rename replaces it without asking (FR-018's "the user's file is untouched"). Windows has no bits to carry.
 */
export async function keepMode(existing: string, staged: string): Promise<void> {
  if (process.platform === 'win32') return;
  const info = await stat(existing).catch((e: unknown) => {
    if (isAbsent(e)) logExpected('atomic-replace: read write target mode', 'a file written for the first time has no mode to keep', e);
    else logCaught('atomic-replace: read write target mode', e);
    return null;
  });
  if (info === null) return;
  await access(existing, constants.W_OK);
  await chmod(staged, info.mode & 0o7777);
}

/** Folder refusals that leave an in-place write as the only way to save a writable file in it. */
const STAGING_REFUSED_CODES = new Set(['EACCES', 'EPERM']);

let stageSeq = 0;

/**
 * Write `data` to `path` all-or-nothing (#706): staged in a hidden temp sibling of the real target (a symlink is
 * followed, so the link survives and its target is replaced), given the target's mode, then renamed over it with the
 * transient-lock retry. On any failure the temp is removed and the target is untouched.
 *
 * One fallback: a writable file in a folder the user cannot create files in cannot be staged at all. Writing it in
 * place, as every save did before #706, is the only way it can be saved; it is not atomic, and only that case takes it.
 */
export async function writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
  const target = await replaceTarget(path);
  stageSeq += 1;
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${stageSeq}.tmp`);
  try {
    await writeFile(tmp, data, { flag: 'wx' });
  } catch (err) {
    await removeStaged(tmp);
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (STAGING_REFUSED_CODES.has(code) && (await stat(target).then(() => true, () => false))) {
      logExpected('atomic-replace: stage temp', 'the folder refuses new files; the writable file is written in place', err);
      await writeFile(target, data);
      return;
    }
    throw err;
  }
  try {
    await keepMode(target, tmp);
    await renameWithRetry(tmp, target);
  } catch (err) {
    await removeStaged(tmp);
    throw err;
  }
}

async function removeStaged(tmp: string): Promise<void> {
  await rm(tmp, { force: true }).catch((e: unknown) => logCaught('atomic-replace: remove staged temp', e));
}
