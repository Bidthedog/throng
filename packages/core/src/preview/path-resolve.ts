/**
 * Resolving a document-relative path to an absolute one, as a rule about STRINGS (044, R6, R7, R9).
 *
 * Core has no `node:path` (Principle II), and the two callers that need this — link and image
 * classification in the renderer's sanitiser hook, and the `throng-preview:` protocol's confinement
 * in main — must agree exactly on what a relative path names, or a path the renderer calls "inside the
 * project" could be one main serves from somewhere else. So both resolve here.
 *
 * `path-id.ts`'s `isUnderPath` REFUSES a `..` segment rather than resolving it, and says why: it has
 * no filesystem and a `..` arriving there means the path came from somewhere it should not. That is
 * the right answer for a stored path and the wrong one for a Markdown link, where `../README.md` is
 * the ordinary way to write a sibling. This module resolves `..` first, so what reaches `isUnderPath`
 * never carries one — and a `..` that climbs above the root prefix is an escape, answered `null`.
 *
 * Internal to `preview/`: not exported from the barrel.
 */
import type { PathSeparator } from '../fs/path-canon.js';

interface ParsedPath {
  /** `C:`, `\\server\share`, or `''` for a POSIX root or a relative path. */
  prefix: string;
  /** Whether the path starts at a root (always true for a drive or UNC prefix). */
  rooted: boolean;
  segments: string[];
}

const UNC = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/;
const DRIVE = /^[A-Za-z]:/;

function parse(path: string): ParsedPath {
  const unc = UNC.exec(path);
  if (unc) {
    return { prefix: `\\\\${unc[1]}\\${unc[2]}`, rooted: true, segments: split(path.slice(unc[0].length)) };
  }
  const drive = DRIVE.exec(path);
  if (drive) return { prefix: drive[0], rooted: true, segments: split(path.slice(2)) };
  return { prefix: '', rooted: /^[\\/]/.test(path), segments: split(path) };
}

function split(path: string): string[] {
  return path.split(/[\\/]+/).filter((s) => s.length > 0);
}

function format(parsed: ParsedPath, sep: PathSeparator): string {
  const body = parsed.segments.join(sep);
  if (parsed.prefix.startsWith('\\\\')) {
    const unc = sep === '\\' ? parsed.prefix : parsed.prefix.replace(/\\/g, '/');
    return body ? `${unc}${sep}${body}` : unc;
  }
  const head = parsed.prefix + (parsed.rooted ? sep : '');
  return head + body;
}

/** The separator a root is written in — a backslash anywhere means a Windows-spelled path. */
export function separatorOf(root: string): PathSeparator {
  return root.includes('\\') ? '\\' : '/';
}

/**
 * `relative` resolved against the directory `base`, written with `sep`; `null` when it climbs above
 * `base`'s root prefix, or when a segment carries a `:` (a drive, a scheme, or an NTFS stream — none
 * of which is a file name inside a project).
 *
 * `relative` is treated as relative even when it starts with a separator: callers decide what a
 * root-relative path is relative TO, and pass that as `base`.
 */
export function resolveAgainst(base: string, relative: string, sep: PathSeparator): string | null {
  const parsed = parse(base);
  const segments = [...parsed.segments];
  for (const part of split(relative)) {
    if (part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    if (part.includes(':')) return null;
    segments.push(part);
  }
  return format({ ...parsed, segments }, sep);
}

/** The directory holding `file`. */
export function directoryOf(file: string, sep: PathSeparator): string {
  const parsed = parse(file);
  return format({ ...parsed, segments: parsed.segments.slice(0, -1) }, sep);
}
