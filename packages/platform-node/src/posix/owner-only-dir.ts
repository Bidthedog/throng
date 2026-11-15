import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import process from 'node:process';

/**
 * A folder only its owner may use. Refuses one that is someone else's, or a symlink (062 FR-011, FR-013). Shared by
 * every POSIX platform: Linux's runtime folder and macOS's `$TMPDIR/throng` take the same check (070 R1, R4).
 */
export function ensureOwnerOnlyDir(dir: string, uid: number | undefined = process.getuid?.()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  if (!info.isDirectory()) throw new Error(`"${dir}" is not a folder, so throng cannot keep its data there.`);
  if (uid !== undefined && info.uid !== uid) {
    throw new Error(`"${dir}" belongs to another user, so throng cannot use it. Remove it, then start throng again.`);
  }
  if ((info.mode & 0o077) !== 0) chmodSync(dir, 0o700);
}
