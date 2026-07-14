/**
 * The drop / open decision (018 / US9, FR-057 … FR-066a).
 *
 * READ SCOPE EQUALS WRITE SCOPE. That sentence is the whole module.
 *
 * Until 018 the SAVE path resolved symlinks and applied the full confinement rule, while the LOAD path
 * did neither: it compared the *unresolved* path against the owner root, skipped the check entirely when
 * that root was unknown, and had no outside-all-projects branch at all. So a file could be OPENED into an
 * editor that would then REFUSE TO SAVE IT — the user's work went into a buffer with nowhere to go, and
 * the refusal arrived at the worst possible moment. Dropping files in from the operating system would
 * have made that trap trivially easy to fall into. So the same rule now guards every route in.
 *
 * The decision is PURE and takes the REAL path: the caller resolves symlinks and stats the entry before
 * asking. That is not a convenience — a confinement rule applied to a link rather than to its target is
 * not a confinement rule, it is a suggestion (SC-011).
 */
import type { EditorDocument } from './document.js';
import { resolveSaveConfinement } from './confinement.js';

export type DropRejection = 'out-of-tree' | 'folder' | 'too-large' | 'not-found';

export type DropDecision =
  | { ok: true; absPath: string }
  | { ok: false; reason: DropRejection; error: string };

export interface DropCandidate {
  /** The REAL path — the caller has already resolved every symlink in it. */
  realPath: string;
  isDirectory: boolean;
  /** Bytes on disk. */
  size: number;
}

/**
 * Decide whether `candidate` may be opened into a document with these roots.
 *
 * Order matters. Confinement is checked FIRST: a huge file from another project is not "too large", it
 * is *not yours*, and reporting the size would send the user off to raise a limit that was never the
 * obstacle.
 */
export function resolveDrop(
  candidate: DropCandidate,
  doc: Pick<EditorDocument, 'ownerKind'>,
  roots: { ownerRoot: string | null; allProjectRoots: readonly string[] },
  limits: { maxOpenFileBytes: number },
): DropDecision {
  // The SAME function the save path uses. Not a copy of it, not a load-flavoured variant of it — if the
  // two rules can drift apart, they eventually will, and the trap re-opens quietly.
  const confinement = resolveSaveConfinement(doc, roots);
  if (!confinement.allowed(candidate.realPath)) {
    return {
      ok: false,
      reason: 'out-of-tree',
      error:
        confinement.kind === 'in-owner-tree'
          ? 'That file is outside this project. Editors can only open files within their project.'
          : 'That file belongs to a project. Sub-workspace editors can only open files outside every project.',
    };
  }

  if (candidate.isDirectory) {
    return { ok: false, reason: 'folder', error: 'A folder cannot be opened in an editor.' };
  }

  if (candidate.size > limits.maxOpenFileBytes) {
    return {
      ok: false,
      reason: 'too-large',
      error: `File is too large to open (${candidate.size} bytes; limit ${limits.maxOpenFileBytes}).`,
    };
  }

  return { ok: true, absPath: candidate.realPath };
}
