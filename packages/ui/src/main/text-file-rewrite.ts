/**
 * Rewrite a text file nobody has open — `decode` → transform → `encode` (043 research R9; 054 FR-029).
 *
 * Extracted from `ReplaceCommitService.writeDirect` so the 054 task toggle writes a file through the
 * same rules a Replace All does, rather than a second copy of them:
 *
 * - confinement on the RESOLVED path, so a symlink cannot walk a write out of its project;
 * - a binary file and a file that is not valid UTF-8 are REFUSED, never transcoded — a non-fatal decode
 *   of Windows-1252 would write `EF BF BD` over every accented character;
 * - the file's own encoding, BOM, dominant line ending and mixed endings go back out unchanged;
 * - `isOpen` is asked once more with nothing between it and the write, because a `load()` in any await
 *   above makes the file open, and a disk write would then land behind a live buffer.
 */
import { decode, encode, isDecodableUtf8, isProbablyBinary, type EncodeOptions, type IFileSystem } from '@throng/core';

/** Why a rewrite wrote nothing, in the vocabulary 043 FR-058 reports. */
export type RewriteFailure = 'readOnly' | 'locked' | 'io' | 'missing' | 'outOfTree' | 'binary' | 'encoding';

/** What the transform decided: the new text (`null` = write nothing), and a value for the caller. */
export interface RewriteDecision<T> {
  next: string | null;
  value: T;
}

export type RewriteOutcome<T> =
  | { kind: 'failed'; reason: RewriteFailure }
  /** A document opened on the file during the rewrite; nothing was written. The caller takes the buffer path. */
  | { kind: 'becameOpen' }
  /** The transform wrote nothing. */
  | { kind: 'unchanged'; value: T }
  | { kind: 'written'; value: T; next: string };

export interface RewriteOptions {
  /** The confinement rule, applied to the resolved path. */
  allowed: (realPath: string) => boolean;
  /** Asked immediately before the write. */
  isOpen: (absPath: string) => boolean;
}

export async function textFileRewrite<T>(
  fs: IFileSystem,
  absPath: string,
  options: RewriteOptions,
  transform: (text: string) => RewriteDecision<T>,
): Promise<RewriteOutcome<T>> {
  let realPath: string;
  try {
    if (!(await fs.exists(absPath))) return { kind: 'failed', reason: 'missing' };
    realPath = await fs.realpath(absPath);
  } catch (e) {
    return { kind: 'failed', reason: rewriteFailureFor(e) };
  }
  if (!options.allowed(realPath)) return { kind: 'failed', reason: 'outOfTree' };

  try {
    const bytes = await fs.readBytes(realPath);
    if (isProbablyBinary(bytes)) return { kind: 'failed', reason: 'binary' };
    if (!isDecodableUtf8(bytes)) return { kind: 'failed', reason: 'encoding' };
    const file = decode(bytes);

    const decision = transform(file.text);
    if (decision.next === null) return { kind: 'unchanged', value: decision.value };

    // The SAME metadata the decode reported: this file's own bytes are the only authority on how it is
    // written back. Mixed endings are kept line by line, or a one-line edit arrives as a whole-file diff.
    const opts: EncodeOptions = { encoding: file.encoding, hasBom: file.hasBom, lineEnding: file.lineEnding };
    if (file.mixedLineEndings) opts.mixedLineEndings = file.mixedLineEndings;
    const out = encode(decision.next, opts);

    if (options.isOpen(absPath)) return { kind: 'becameOpen' };
    await fs.writeBytes(realPath, out);
    return { kind: 'written', value: decision.value, next: decision.next };
  } catch (e) {
    return { kind: 'failed', reason: rewriteFailureFor(e) };
  }
}

/** An OS error, said in the vocabulary 043 FR-058 reports. */
export function rewriteFailureFor(e: unknown): RewriteFailure {
  const code = (e as { code?: string } | null)?.code;
  if (code === 'ENOENT') return 'missing';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'readOnly';
  if (code === 'EBUSY' || code === 'ETXTBSY') return 'locked';
  return 'io';
}
