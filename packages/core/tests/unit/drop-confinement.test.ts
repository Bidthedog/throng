import { describe, expect, it } from 'vitest';
import { resolveDrop, type DropCandidate } from '../../src/editor/drop.js';

/**
 * 018 / US9 — the drop decision (FR-057 … FR-066a, SC-011/SC-012).
 *
 * THE POINT OF THIS MODULE IS THAT READ SCOPE EQUALS WRITE SCOPE. Until now the save path resolved
 * symlinks and applied the full confinement rule, while the load path did neither — so a file could be
 * OPENED into an editor that would then refuse to SAVE it. The user's work went into a buffer that had
 * nowhere to go. Dropping files in from the operating system would have made that trap trivially easy to
 * fall into, so US9 closes it: the same rule, on the same resolved path, on every route in.
 *
 * The decision is PURE and takes the REAL path — the caller resolves symlinks before asking. That is not
 * a convenience: a rule applied to the link rather than its target is not a confinement rule at all, it
 * is a suggestion (SC-011).
 */

const PROJECT = 'C:\\code\\demo';
const OTHER_PROJECT = 'C:\\code\\other';
const LIMITS = { maxOpenFileBytes: 1_000_000 };

const file = (realPath: string, size = 10): DropCandidate => ({
  realPath,
  isDirectory: false,
  size,
});

describe('resolveDrop — a project-owned editor', () => {
  const doc = { ownerKind: 'project' as const };
  const roots = { ownerRoot: PROJECT, allProjectRoots: [PROJECT, OTHER_PROJECT] };

  it('accepts a file inside its own project', () => {
    const d = resolveDrop(file('C:\\code\\demo\\src\\index.ts'), doc, roots, LIMITS);
    expect(d).toEqual({ ok: true, absPath: 'C:\\code\\demo\\src\\index.ts' });
  });

  it('refuses a file outside its project', () => {
    const d = resolveDrop(file('C:\\elsewhere\\notes.txt'), doc, roots, LIMITS);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('out-of-tree');
  });

  it("refuses another project's file", () => {
    const d = resolveDrop(file('C:\\code\\other\\main.ts'), doc, roots, LIMITS);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('out-of-tree');
  });

  it('applies the rule to the RESOLVED path, not the link that pointed at it', () => {
    // The link LIVES in the project; its target does not. Judging the link would admit the file and
    // then refuse to save it — the exact trap this story closes (SC-011).
    const escape = { realPath: 'C:\\secrets\\key.pem', isDirectory: false, size: 10 };
    const d = resolveDrop(escape, doc, roots, LIMITS);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('out-of-tree');
  });

  it('refuses even when the owner root is unknown — an unknown root is not a licence', () => {
    // The load path used to SKIP the check entirely when `ownerRoot` was null, which turned a missing
    // fact into permission. A project-owned document with no known root can confine nothing, so it
    // falls to the outside-all-projects rule rather than to no rule at all.
    const d = resolveDrop(file('C:\\code\\demo\\src\\index.ts'), doc, {
      ownerRoot: null,
      allProjectRoots: [PROJECT],
    }, LIMITS);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('out-of-tree');
  });
});

describe('resolveDrop — a sub-workspace-owned editor', () => {
  const doc = { ownerKind: 'subworkspace' as const };
  const roots = { ownerRoot: null, allProjectRoots: [PROJECT, OTHER_PROJECT] };

  it('accepts a file outside every project', () => {
    const d = resolveDrop(file('C:\\elsewhere\\notes.txt'), doc, roots, LIMITS);
    expect(d).toEqual({ ok: true, absPath: 'C:\\elsewhere\\notes.txt' });
  });

  it('refuses a file that lives inside a project', () => {
    // THIS FILE WOULD HAVE OPENED BEFORE THIS FEATURE, AND THEN REFUSED TO SAVE (SC-012).
    const d = resolveDrop(file('C:\\code\\demo\\src\\index.ts'), doc, roots, LIMITS);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe('out-of-tree');
      // The refusal must say WHY, and "it belongs to a project" is the fact the user needs.
      expect(d.error).toMatch(/project/i);
    }
  });
});

describe('resolveDrop — what is not a text file', () => {
  const doc = { ownerKind: 'project' as const };
  const roots = { ownerRoot: PROJECT, allProjectRoots: [PROJECT] };

  it('refuses a folder', () => {
    const d = resolveDrop(
      { realPath: 'C:\\code\\demo\\src', isDirectory: true, size: 0 },
      doc,
      roots,
      LIMITS,
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('folder');
  });

  it('refuses a file over the openable size limit', () => {
    const d = resolveDrop(file('C:\\code\\demo\\huge.log', 2_000_000), doc, roots, LIMITS);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('too-large');
  });

  it('checks confinement BEFORE size — an out-of-tree file is refused for the reason that matters', () => {
    // A 2 GB file from another project is not "too large", it is not yours. Reporting the size would
    // send the user off to change a limit that was never the obstacle.
    const d = resolveDrop(file('C:\\elsewhere\\huge.log', 2_000_000), doc, roots, LIMITS);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('out-of-tree');
  });
});
