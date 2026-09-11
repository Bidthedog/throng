/**
 * 043 T206 — the commit RESULT carries a re-derived snippet per write, on BOTH paths (FR-083b).
 *
 * ══ WHY THIS IS A UNIT TEST AND WHAT IT IS A UNIT OF ══
 *
 * `postCommitSnippets` is settled over strings in `packages/core` — that is where the same-line
 * defect and the size bound are proved. What is left is the wiring: that `ReplaceCommitService`
 * derives from the new text on the DISK path (which it holds itself, after `applyReplacements`) and
 * on the BUFFER path (which the document authority hands back), that the two share one budget, and
 * that the snippets ride on `applied` — the array the panel reads its rows back from.
 *
 * Both collaborators are seams the service already declares: `IFileSystem` and `BulkEditTarget`. The
 * fake authority below performs a real replacement with the real model functions, so what it hands
 * back is the text a real one would — the thing being faked is where the document lives, never what
 * the commit does with it. The REAL `EditorCoordinator` half is
 * `replace-commit.integration.test.ts`, over a real authority.
 */
import { describe, it, expect } from 'vitest';
import { Text } from '@codemirror/state';
import {
  DEFAULT_APP_SETTINGS,
  NO_MODES,
  applyReplacements,
  decode,
  encode,
  verifyEdits,
  type AppSettings,
  type IFileSystem,
  type Match,
} from '@throng/core';
import {
  ReplaceCommitService,
  type BulkEditTarget,
  type CommitOutcome,
  type CommitResult,
} from '../../src/main/replace-commit-service.js';

const ROOT = 'D:/proj';
const TERM = 'needle';

/** Every offset of `term` in `text`, exactly as a scan would have recorded them. */
function matchesOf(text: string, term: string): Match[] {
  const out: Match[] = [];
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
    out.push({ from: i, to: i + term.length });
  }
  return out;
}

/**
 * The four filesystem calls a commit makes, over a Map.
 *
 * Cast rather than implemented in full: `IFileSystem` is the whole explorer's surface, and stubbing
 * twenty methods that this operation never reaches would say nothing and hide which four it does.
 */
function fakeFs(files: Record<string, string>): { fs: IFileSystem; text: (rel: string) => string } {
  const bytes = new Map<string, Uint8Array>(
    Object.entries(files).map(([rel, body]) => [
      `${ROOT}/${rel}`,
      encode(body, { encoding: 'utf8', hasBom: false, lineEnding: 'lf' }),
    ]),
  );
  const fs = {
    exists: async (p: string) => bytes.has(p),
    realpath: async (p: string) => p,
    readBytes: async (p: string) => {
      const held = bytes.get(p);
      if (!held) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return held;
    },
    writeBytes: async (p: string, out: Uint8Array) => {
      bytes.set(p, out);
    },
  } as unknown as IFileSystem;
  return { fs, text: (rel) => decode(bytes.get(`${ROOT}/${rel}`) ?? new Uint8Array()).text };
}

/**
 * A document authority for the files named, answering exactly as the real one does: the writes that
 * landed, where they landed, and the text AFTER the dispatch.
 */
function fakeEditors(open: Record<string, string>): BulkEditTarget {
  const docs = new Map(Object.entries(open).map(([rel, body]) => [`${ROOT}/${rel}`, body]));
  return {
    isOpen: (abs) => docs.has(abs),
    bulkReplace: (req) => {
      const held = docs.get(req.absPath);
      if (held === undefined) return null;
      const checked = verifyEdits(held, req.term, req.modes, req.edits, req.replacement);
      const next = applyReplacements(held, checked.applicable, req.replacement);
      docs.set(req.absPath, next);
      return {
        applied: checked.applied,
        applicable: checked.applicable,
        refused: checked.gone.length,
        after: Text.of(next.split('\n')),
        documentId: `panel:${req.absPath}`,
        /*
         * 043 FR-086 — this double's documents are never dirty, so a commit into one always owes a
         * save. `save` below is what makes that harmless here: the fake's text is already the
         * post-commit text, so "saving" it is a no-op and the snippet assertions are unaffected.
         */
        wasClean: true,
      };
    },
    save: () => Promise.resolve({ ok: true as const }),
  };
}

const settings = (): AppSettings => structuredClone(DEFAULT_APP_SETTINGS);

function outcomeOf(result: CommitResult): CommitOutcome {
  if (!result.committed) throw new Error(`expected a committed result, got ${result.reason}`);
  return result.outcome;
}

/** The snippet each write came back with, as one readable string per row. */
function snippetTexts(outcome: CommitOutcome, relPath: string): (string | undefined)[] {
  const file = outcome.applied.find((a) => a.relPath === relPath);
  return (file?.edits ?? []).map((e) =>
    e.snippet === undefined ? undefined : `${e.snippet.before}${e.snippet.matched}${e.snippet.after}`,
  );
}

const SAME_LINE = 'const needle = needle;\n';

describe('the DISK path answers with the new file’s own text (FR-083b)', () => {
  it('gives BOTH matches on one line the line as it now reads', async () => {
    const { fs, text } = fakeFs({ 'a.txt': SAME_LINE });
    const service = new ReplaceCommitService(fs, fakeEditors({}), settings);

    const outcome = outcomeOf(
      await service.commit({
        panelId: 'p1',
        projectRoot: ROOT,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [{ relPath: 'a.txt', edits: matchesOf(SAME_LINE, TERM) }],
        confirmedIrreversible: true,
      }),
    );

    expect(text('a.txt')).toBe('const thread = thread;\n');
    // Neither row is left carrying the other's pre-commit text — which is the whole defect.
    expect(snippetTexts(outcome, 'a.txt')).toEqual([
      'const thread = thread;',
      'const thread = thread;',
    ]);
  });

  it('reports the snippet against the offsets the CALLER asked with', async () => {
    const { fs } = fakeFs({ 'a.txt': SAME_LINE });
    const service = new ReplaceCommitService(fs, fakeEditors({}), settings);

    const outcome = outcomeOf(
      await service.commit({
        panelId: 'p1',
        projectRoot: ROOT,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [{ relPath: 'a.txt', edits: matchesOf(SAME_LINE, TERM) }],
        confirmedIrreversible: true,
      }),
    );

    // The scan's offsets, unchanged — the panel's rows are in those coordinates and the snippet is
    // attached to the edit, so the two cannot come apart.
    expect(outcome.applied[0]?.edits.map((e) => e.from)).toEqual([6, 15]);
  });
});

describe('the BUFFER path answers from the authority’s text (FR-083b)', () => {
  it('gives both matches on one line the document as it now reads', async () => {
    const { fs } = fakeFs({ 'b.txt': SAME_LINE });
    const service = new ReplaceCommitService(fs, fakeEditors({ 'b.txt': SAME_LINE }), settings);

    const outcome = outcomeOf(
      await service.commit({
        panelId: 'p1',
        projectRoot: ROOT,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: [{ relPath: 'b.txt', edits: matchesOf(SAME_LINE, TERM) }],
        confirmedIrreversible: true,
      }),
    );

    expect(outcome.changedInBuffer).toEqual(['b.txt']);
    expect(snippetTexts(outcome, 'b.txt')).toEqual([
      'const thread = thread;',
      'const thread = thread;',
    ]);
  });
});

describe('the size bound is one budget for the whole commit (FR-083b)', () => {
  it('stops answering with snippets once it is spent, and still writes every file', async () => {
    // One long line per file, so a handful of matches is enough to run a small budget out.
    const wide = `${'x'.repeat(60)} needle ${'y'.repeat(60)}\n`;
    const { fs, text } = fakeFs({ 'a.txt': wide, 'b.txt': wide, 'c.txt': wide });
    // No staleness witness: this panel has no scan behind it, which is the ordinary unit-level case.
    const service = new ReplaceCommitService(fs, fakeEditors({}), settings, undefined, 100);

    const outcome = outcomeOf(
      await service.commit({
        panelId: 'p1',
        projectRoot: ROOT,
        term: TERM,
        modes: NO_MODES,
        replacement: 'thread',
        targets: ['a.txt', 'b.txt', 'c.txt'].map((relPath) => ({
          relPath,
          edits: matchesOf(wide, TERM),
        })),
        confirmedIrreversible: true,
      }),
    );

    // Every file was written — the bound is on the ANSWER, never on the commit.
    for (const rel of ['a.txt', 'b.txt', 'c.txt']) expect(text(rel)).toContain('thread');
    expect(outcome.changedOnDisk).toEqual(['a.txt', 'b.txt', 'c.txt']);
    // The first file's snippet fits; a later one does not, and comes back absent rather than wrong.
    expect(snippetTexts(outcome, 'a.txt')[0]).toBeDefined();
    expect(snippetTexts(outcome, 'c.txt')[0]).toBeUndefined();
  });
});
