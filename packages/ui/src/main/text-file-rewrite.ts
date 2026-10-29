/**
 * Rewrite a text file nobody has open — `decode` → transform → `encode` (043 research R9; 054 FR-029).
 *
 * Extracted from `ReplaceCommitService.writeDirect` so the 054 task toggle writes a file through the
 * same rules a Replace All does, rather than a second copy of them:
 *
 * - confinement on the RESOLVED path, so a symlink cannot walk a write out of its project;
 * - the file is read through the editor's own detection (059): a binary, UTF-32 or undecodable file is
 *   REFUSED, never transcoded;
 * - the file's own encoding, BOM, dominant line ending and mixed endings go back out unchanged, and a
 *   result that encoding cannot hold is refused with nothing written (059 FR-021, FR-051);
 * - `isOpen` is asked once more with nothing between it and the write, because a `load()` in any await
 *   above makes the file open, and a disk write would then land behind a live buffer.
 */
import {
  UnrepresentableTextError,
  encode,
  readText,
  type EncodeOptions,
  type EncodingId,
  type IFileSystem,
  type CodePageId,
} from '@throng/core';

/** Why a rewrite wrote nothing, in the vocabulary 043 FR-058 reports. */
export type RewriteFailure =
  | 'readOnly'
  | 'locked'
  | 'io'
  | 'missing'
  | 'outOfTree'
  | 'binary'
  // 059: UTF-32 (FR-006); not lossless in the encoding it claims (FR-014); the result holds a character
  // the file's encoding cannot (FR-021).
  | 'utf32'
  | 'not-decodable'
  | 'unrepresentable';

/** What the transform decided: the new text (`null` = write nothing), and a value for the caller. */
export interface RewriteDecision<T> {
  next: string | null;
  value: T;
}

export type RewriteOutcome<T> =
  /** `encoding` names the file's encoding for `not-decodable` and `unrepresentable`, so the report can. */
  | { kind: 'failed'; reason: RewriteFailure; encoding?: EncodingId }
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
  /** `editor.fallbackEncoding` (059 FR-069): the editor's last detection step, not a second one. */
  fallbackEncoding?: CodePageId;
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
    const read = readText(bytes, undefined, options.fallbackEncoding);
    if (!read.ok) return { kind: 'failed', reason: read.reason, ...('encoding' in read ? { encoding: read.encoding } : {}) };
    const file = read.file;

    const decision = transform(file.text);
    if (decision.next === null) return { kind: 'unchanged', value: decision.value };

    // The SAME metadata the decode reported: this file's own bytes are the only authority on how it is
    // written back. Mixed endings are kept line by line, or a one-line edit arrives as a whole-file diff.
    const opts: EncodeOptions = { encoding: file.encoding, hasBom: file.hasBom, lineEnding: file.lineEnding };
    if (file.mixedLineEndings) opts.mixedLineEndings = file.mixedLineEndings;
    let out: Uint8Array;
    try {
      out = encode(decision.next, opts);
    } catch (e) {
      if (e instanceof UnrepresentableTextError) return { kind: 'failed', reason: 'unrepresentable', encoding: file.encoding };
      throw e;
    }

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
