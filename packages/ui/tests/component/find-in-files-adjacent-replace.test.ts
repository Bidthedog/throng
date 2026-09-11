/**
 * #378 — replacing ADJACENT matches one at a time, where the replacement contains the term.
 *
 * ══ WHY THIS TIER, AND NOT THE TWO EITHER SIDE OF IT ══
 *
 * The defect is not in the write and not in the arithmetic: it is in WHICH OFFSETS the panel names
 * on the second commit. `verifyEdits` is handed `(2,4)` in a file that now reads `zzabzzab`, where
 * `(2,4)` genuinely holds a match — the one the FIRST replacement inserted — so it writes there, and
 * no amount of inference at the point of the write can tell that reading apart from an untouched
 * `abab` (issue #378's own analysis, and `replace-model.test.ts` pins both readings).
 *
 * So the cheapest honest reproduction is the tier that chooses the offsets: the real panel, the real
 * menu, two real Replace Match invocations. Nothing below it can see the second commit at all, and
 * `replace-commit.integration.test.ts` — which calls the service DIRECTLY — can only assert what
 * main does with offsets a test hands it, never which offsets the panel would have sent.
 *
 * ══ THE COMMIT STUB IS A MINIATURE OF MAIN, NOT A RECORDING OF CALLS ══
 *
 * It runs the SAME `verifyEdits` and `applyReplacements` the service runs, over an in-memory file.
 * That is what lets this file assert the user's bytes rather than a payload shape — the partition,
 * the confinement and the encoding are main's and are irrelevant to this defect, but the text is the
 * whole of it.
 *
 * Its `applied` is derived as "what I was given, minus what I refused" rather than taken from the
 * verification, deliberately: it must state the answer independently of the field the fix adds, or
 * the Red would be a missing property rather than a corrupted file. That `ReplaceCommitService`
 * really does report the same set is `replace-commit.integration.test.ts`'s to prove.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  applyReplacements,
  verifyEdits,
  type Match,
  type ResultRow,
} from '@throng/core';
import { __resetFindInFilesState } from '../../src/renderer/find-in-files/find-in-files-store.js';
import {
  PANEL_ID,
  installFileSearchStub,
  removeFileSearchStub,
  renderFindInFilesPanel,
  type FileSearchStub,
} from './helpers/find-in-files.js';

const FILE = 'notes.txt';
const TERM = 'ab';
/** The issue's replacement: it CONTAINS the term, which is what makes the two readings identical. */
const REPLACEMENT = 'zzabzz';

let stub: FileSearchStub;
/** The one file the panel is replacing in, as it stands after each commit. */
let text: string;

interface CommitPayload {
  term: string;
  modes: { caseSensitive: boolean; wholeWord: boolean };
  replacement: string;
  targets: { relPath: string; edits: Match[] }[];
}

/** `abab` — two matches of `ab`, adjacent, with nothing between them. */
function row(from: number): ResultRow {
  return {
    relPath: FILE,
    line: 1,
    column: from + 1,
    from,
    to: from + TERM.length,
    snippet: {
      before: text.slice(0, from),
      matched: TERM,
      after: '',
      truncatedStart: false,
      truncatedEnd: false,
    },
  };
}

/** Main's write, in miniature — the same two core functions, over `text`. */
function commitAgainstTheFile(payload: CommitPayload): unknown {
  const changedOnDisk: string[] = [];
  const refused: { relPath: string; reason: 'matchGone' }[] = [];
  const applied: { relPath: string; edits: Match[] }[] = [];

  for (const target of payload.targets) {
    const checked = verifyEdits(text, payload.term, payload.modes, target.edits, payload.replacement);
    if (checked.gone.length > 0) refused.push({ relPath: target.relPath, reason: 'matchGone' });
    if (checked.applicable.length === 0) continue;
    text = applyReplacements(text, checked.applicable, payload.replacement);
    changedOnDisk.push(target.relPath);
    const gone = new Set(checked.gone.map((g) => `${g.from}:${g.to}`));
    applied.push({
      relPath: target.relPath,
      edits: target.edits.filter((e) => !gone.has(`${e.from}:${e.to}`)),
    });
  }

  return { committed: true, outcome: { changedInBuffer: [], changedOnDisk, refused, failed: [], applied } };
}

beforeEach(() => {
  __resetFindInFilesState();
  text = 'abab';
  stub = installFileSearchStub();
  stub.commit.mockImplementation(async (payload: unknown) =>
    commitAgainstTheFile(payload as CommitPayload),
  );
});

afterEach(() => {
  removeFileSearchStub();
  __resetFindInFilesState();
});

/** Render, search, deliver the two adjacent rows, disclose replace and type the replacement. */
async function ready(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderFindInFilesPanel();
  await user.type(screen.getByTestId(`fif-term-${PANEL_ID}`), `${TERM}{Enter}`);
  stub.emit({
    panelId: PANEL_ID,
    generation: 1,
    status: 'complete',
    rows: [row(0), row(2)],
    totalMatches: 2,
  });
  await user.click(screen.getByTestId(`fif-toggle-replace-${PANEL_ID}`));
  await user.type(screen.getByTestId(`fif-replacement-${PANEL_ID}`), REPLACEMENT);
  return user;
}

async function replaceMatch(
  user: ReturnType<typeof userEvent.setup>,
  from: number,
): Promise<void> {
  await user.pointer({ target: screen.getByTestId(`fif-row-${FILE}-${from}`), keys: '[MouseRight]' });
  await user.click(screen.getByTestId('menu-item-Replace Match'));
  await waitFor(() =>
    expect(screen.getByTestId(`fif-row-${FILE}-${from}`)).toHaveAttribute('data-committed', 'true'),
  );
}

describe('#378 — two adjacent matches, replaced one at a time (FR-050, FR-054)', () => {
  it('replaces the SECOND match, not the text the first replacement inserted', async () => {
    const user = await ready();
    await replaceMatch(user, 0);
    // The first commit is the uncontroversial one, and it is stated so a failure below cannot be
    // blamed on it.
    expect(text).toBe('zzabzzab');

    await replaceMatch(user, 2);
    // Each of the user's two matches became the replacement, and nothing wrote inside the other.
    expect(text).toBe(`${REPLACEMENT}${REPLACEMENT}`);
  });

  it('names the match’s CURRENT position on the second commit, not the scanned one', async () => {
    const user = await ready();
    await replaceMatch(user, 0);
    await replaceMatch(user, 2);

    const second = stub.commit.mock.calls[1]?.[0] as CommitPayload;
    // `abab` → `zzabzzab` moved the second match four characters along. The panel committed the
    // first one, so the panel is the only thing that can know that.
    expect(second.targets).toEqual([{ relPath: FILE, edits: [{ from: 6, to: 8 }] }]);
  });

  it('reports no refusal, and marks both rows committed', async () => {
    const user = await ready();
    await replaceMatch(user, 0);
    await replaceMatch(user, 2);

    const notices = await screen.findAllByTestId('fif-commit-outcome');
    for (const notice of notices) {
      expect(notice.textContent ?? '').not.toContain('the match had gone');
    }
    expect(screen.getByTestId(`fif-row-${FILE}-0`)).toHaveAttribute('data-committed', 'true');
    expect(screen.getByTestId(`fif-row-${FILE}-2`)).toHaveAttribute('data-committed', 'true');
  });

  it('a Replace All issued after one match still writes each remaining match once', async () => {
    // The same rebase, through a different granularity: FR-049's three actions must agree about
    // where the surviving rows now are.
    const user = await ready();
    await replaceMatch(user, 0);

    await user.pointer({ target: screen.getByTestId(`fif-row-${FILE}-2`), keys: '[MouseRight]' });
    await user.click(screen.getByTestId('menu-item-Replace All'));
    await waitFor(() => expect(text).toBe(`${REPLACEMENT}${REPLACEMENT}`));
  });
});

describe('#378 — the ordinary cases the rebase must not break', () => {
  it('an untouched file whose replacement contains the term still replaces every match', async () => {
    // Nothing has been committed, so nothing has moved: Replace All over `abab` is the common shape
    // the issue says a fix must not trade away.
    const user = await ready();
    await user.pointer({ target: screen.getByTestId(`fif-row-${FILE}-0`), keys: '[MouseRight]' });
    await user.click(screen.getByTestId('menu-item-Replace All'));
    await waitFor(() => expect(text).toBe(`${REPLACEMENT}${REPLACEMENT}`));

    expect((stub.commit.mock.calls[0]?.[0] as CommitPayload).targets).toEqual([
      { relPath: FILE, edits: [{ from: 0, to: 2 }, { from: 2, to: 4 }] },
    ]);
  });

  it('a re-run starts the offsets over — a new scan owes nothing to the old commits', async () => {
    const user = await ready();
    await replaceMatch(user, 0);

    // The user searches again: `zzabzzab` has matches at 2 and 6, and the panel must send THOSE,
    // unshifted by a commit that belongs to the list it just replaced (FR-051).
    text = 'zzabzzab';
    stub.emit({
      panelId: PANEL_ID,
      generation: 2,
      status: 'complete',
      rows: [row(2), row(6)],
      totalMatches: 2,
    });
    await user.pointer({ target: screen.getByTestId(`fif-row-${FILE}-2`), keys: '[MouseRight]' });
    await user.click(screen.getByTestId('menu-item-Replace All'));

    await waitFor(() =>
      expect((stub.commit.mock.calls[1]?.[0] as CommitPayload).targets).toEqual([
        { relPath: FILE, edits: [{ from: 2, to: 4 }, { from: 6, to: 8 }] },
      ]),
    );
  });
});
