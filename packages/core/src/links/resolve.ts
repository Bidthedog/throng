import type { IPathForms } from '../abstractions/path-forms.js';
import { isUnderPath } from '../fs/path-id.js';
import type { LinkCandidate } from './types.js';

/**
 * 045 R1–R11 and M1–M6 — `contracts/link-resolution.md` §2 and §3. Pure, and it touches no disk.
 *
 * ══ AN ORDERED LIST, NOT AN ANSWER ══
 *
 * `resolveCandidate` says where to LOOK, in order; main looks, and the first location that exists
 * is the link (R1). Splitting it that way is what keeps every ordering rule in this file testable
 * without a filesystem — and the ordering rules are the whole substance of the feature:
 *
 *   R5  a relative path tries the BASE DIRECTORY before the project root, because a path a command
 *       printed almost always means that command's own folder (US1 scenario 8);
 *   R6  a leading-`/` path tries the PROJECT ROOT before the platform's own meaning, because
 *       `/test.txt` in a project's terminal means the project's `test.txt` (#394's own example);
 *   R7  the reading WITH a position is tried before the reading without, so whichever exists
 *       decides whether a trailing `:42:7` was a position or part of the name. Detection emits the
 *       two readings in that order and this function preserves it per candidate; the caller
 *       concatenates in candidate order.
 *
 * ══ WHAT THIS FILE MAY NOT KNOW ══
 *
 * No operating system, no drive letter, no separator of its own (FR-026, Principle II). Every
 * spelling that needs mapping — `/d/x`, `~`, `file:` — goes through `IPathForms`; a form the
 * platform already understands is passed through exactly as written, because the platform accepts
 * it either way and choosing a separator here would be naming one. Where this file joins a relative
 * path onto a base it borrows the separator the BASE is already spelled with, which is a fact about
 * the string in hand rather than about the OS.
 */

export interface LinkResolutionContext {
  /** FR-022 / FR-023: the editor's own folder, or the terminal's live cwd. */
  readonly baseDirectory?: string;
  /** The owning project's root, or `null` for a panel that has none (R11). */
  readonly projectRoot: string | null;
  readonly pathForms: IPathForms;
}

const FILE_SCHEME = /^file:/i;
const ANY_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const DRIVE_FORM = /^[A-Za-z]:[\\/]/;
const UNC_FORM = /^[\\/]{2}[^\\/]+[\\/]/;
const HOME_FORM = /^~(?:[\\/]|$)/;

export function resolveCandidate(
  candidate: LinkCandidate,
  ctx: LinkResolutionContext,
): string[] {
  const text = candidate.text;
  if (text.length === 0) return [];

  // R8 / FR-012. A `file:` URI is converted here and NEVER handed to a URL opener (FR-037).
  if (FILE_SCHEME.test(text)) return only(ctx.pathForms.fromFileUrl(text));

  // R2. A form the platform already understands maps to itself. Checked before the generic scheme
  // test so `C:\x` is never mistaken for a URI.
  if (DRIVE_FORM.test(text)) return [text];
  if (UNC_FORM.test(text)) return [text];

  // R4 / FR-025.
  if (HOME_FORM.test(text)) return only(ctx.pathForms.fromHomeForm(text));

  // FR-013. Any other scheme is not a path and resolves to nothing.
  if (ANY_SCHEME.test(text)) return [];

  const out: string[] = [];

  if (text.startsWith('/') || text.startsWith('\\')) {
    // R6: the project root FIRST.
    if (ctx.projectRoot !== null) out.push(join(ctx.projectRoot, text.slice(1)));
    // R3: then the drive forms, if this is one…
    const drive = ctx.pathForms.fromDriveForm(text);
    // …and otherwise the platform's own meaning of the path, unmapped (R9 — no WSL access).
    out.push(drive ?? text);
    return dedupe(out);
  }

  // R5: relative — the base directory first, then the project root. R10 is this rule with no base
  // directory supplied, which needs no clause of its own.
  if (ctx.baseDirectory !== undefined && ctx.baseDirectory.length > 0) {
    out.push(join(ctx.baseDirectory, text));
  }
  if (ctx.projectRoot !== null) out.push(join(ctx.projectRoot, text));
  return dedupe(out);
}

/**
 * M1–M6 / FR-021. Is the RESOLVED location inside the owning project's root?
 *
 * M6 is the whole implementation, and it is a hard rule rather than a preference: the comparison is
 * `isUnderPath`, and no fourth near-copy of it is written here. `path-id.ts`'s own docstring records
 * three that already exist in this codebase, and a fourth is precisely the DRY violation that file
 * was written to warn about. Delegating also brings three behaviours this rule needs, for free and
 * consistently with every other containment question in the app: case folding and separator folding
 * (M2 — all five spellings of one file give one verdict), a segment-boundary match so `C:\throng-old`
 * is not "inside" `C:\throng`, and a refusal to answer for a path carrying `..` rather than a guess.
 *
 * M3 falls out of the signature: a panel with no owning project has no root, so nothing is inside
 * it. M5 likewise — this is a rule about strings, so a symlink or junction is judged on the location
 * it NAMES and no `realpath` is consulted, because there is nothing here that could consult one.
 * M4 is the caller's: it passes the root of `Panel.originProjectId`, and there is no second root
 * hidden in here for it to disagree with (Principle XI).
 */
export function isLinkInProject(resolvedPath: string, projectRoot: string | null): boolean {
  if (projectRoot === null || projectRoot.length === 0) return false;
  if (resolvedPath.length === 0) return false;
  return isUnderPath(resolvedPath, projectRoot);
}

function only(path: string | null): string[] {
  return path === null || path.length === 0 ? [] : [path];
}

/**
 * Join a relative path onto a base, in the base's OWN separator, collapsing `.` and `..`.
 *
 * Borrowing the base's separator is deliberate: it keeps the joined path spelled the way the thing
 * that produced the base spells paths, and it means this file never has to name one. A base with no
 * separator at all is spelled forward-slash, which is the only arbitrary choice here and applies to
 * nothing a real project root or working directory looks like.
 */
function join(base: string, relative: string): string {
  const separator = base.includes('\\') ? '\\' : '/';
  const segments = base.split(/[\\/]/).filter((s, i) => s.length > 0 || i === 0);
  for (const part of relative.split(/[\\/]/)) {
    if (part.length === 0 || part === '.') continue;
    if (part === '..') {
      if (segments.length > 1) segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join(separator);
}

function dedupe(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (p.length === 0 || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
