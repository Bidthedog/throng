/**
 * 043 — the pure replace model: which of a scan's matches still hold, and what the text becomes
 * once they are replaced (FR-054, FR-054a, FR-055, FR-046a).
 *
 * ══ WHY THIS IS A SEPARATE MODULE FROM THE COMMIT ══
 *
 * `ReplaceCommitService` (UI main) is about WHERE the text goes: an open document's authority, or a
 * file on disk, decided under a race and re-checked immediately before each write. Everything it
 * does with the text itself is these two functions, and neither of them needs a filesystem, a
 * process, or an open document to be true. So they are settled by a unit test over strings rather
 * than by a temp tree per case.
 *
 * ══ FR-055, AND THE IMPLEMENTATION THAT VIOLATES IT WITHOUT LOOKING WRONG ══
 *
 * "Replacement text MUST NOT be re-matched by the same operation." The obvious loop — find the
 * term, replace it, find the term again from the current text — is a NON-TERMINATING program the
 * moment the replacement contains the term (`foo` → `foofoo`), and the near miss is worse: a loop
 * that recomputes offsets against the growing text lands each later replacement further and further
 * from where the user read it in the preview.
 *
 * The answer here is structural rather than defensive. Every edit is an offset pair into the text
 * AS SCANNED, the whole set is applied in ONE pass from the end backwards, and the text is never
 * re-searched. Nothing that was written can be found, because nothing looks again.
 */
import { editorMatches, type Match, type MatchModes } from './match-model.js';
import { MAX_COMMIT_SNIPPET_CHARS, snippetFor, type SnippetView } from './file-search.js';
import { Text } from '@codemirror/state';

/**
 * The outcome of re-checking a set of scanned matches against text as it is NOW (FR-054).
 *
 * Two arrays rather than a boolean, because FR-054a is per MATCH: a commit whose first row has been
 * edited away still writes its other rows, and the refusal is reported for that row alone.
 */
export interface EditVerification {
  /**
   * Where each surviving edit will actually be written — document order, deduplicated.
   *
   * These are positions in the text that was PASSED IN, which is not always where the scan put
   * them: an edit this same operation has already shifted is re-resolved (see below), so an
   * `applicable` entry can differ from the `Match` the caller supplied. `applyReplacements` takes
   * these and the same text, so the pair is self-consistent by construction.
   */
  readonly applicable: readonly Match[];
  /**
   * The same writes, named at the offsets the CALLER gave — one entry per `applicable`.
   *
   * `applicable` answers "where does this go in the text you passed me"; this answers "which of the
   * things you asked for did I do". They differ whenever an edit was re-resolved, and the caller
   * cannot recover the second from the first: the shift is not invertible once two edits could have
   * reached one position.
   *
   * It exists because a caller that keeps naming offsets from ONE scan has to know, exactly, which
   * of its rows have been written — see the header's third section. Deriving it as "everything I
   * sent, minus `gone`" is wrong in the one case that matters: two rows landing on a single match
   * produce one write, and counting it twice would move every later row twice as far (#378).
   */
  readonly applied: readonly Match[];
  /**
   * Refused, and reported (FR-054a) — at the offsets the CALLER gave, because that is what the row
   * on screen says and what the user is being told about.
   */
  readonly gone: readonly Match[];
}

/**
 * Does each scanned match still describe the current text? (FR-054.)
 *
 * ══ WHY IT RE-RUNS THE MATCHER RATHER THAN COMPARING SUBSTRINGS ══
 *
 * `text.slice(from, to) === term` is nearly right and is wrong in both modes the feature has.
 * Case-insensitively it would refuse a legitimate match; with whole word on it would ACCEPT
 * `cat` inside `cats`, and write the replacement into the middle of a word the user never saw
 * highlighted. The scan found these positions with {@link editorMatches}; the only honest
 * re-check is the same question asked again of the same engine (FR-039).
 *
 * ══ AND WHY A MATCH THAT MERELY MOVED IS RE-RESOLVED RATHER THAN REFUSED ══
 *
 * FR-054 allows either — "MUST be re-resolved or refused" — and refusing everything was the first
 * implementation. It is wrong for the ORDINARY case, and wrong in the way that costs the user work:
 * nothing rebases a panel's rows after a commit, so `foo bar foo` with `foo` → `bazqux` refuses row
 * 2 the moment row 1 has been written, and tells the user "the match had gone" about a match they
 * are looking at. FR-050 — replace one, then the next — fails on the second click, and so does any
 * Replace in File or Replace All issued after a single commit.
 *
 * ══ THE LADDER, WHICH IS WHY THIS CANNOT WRITE WHERE THE USER DID NOT MEAN ══
 *
 * The only thing that can move a match while a commit is in progress is the commit: each
 * replacement written BEFORE a match moves it by exactly `|replacement| - |term|`. So the complete
 * set of offsets this operation could have moved an edit to is
 *
 *     from + k·(|replacement| - |term|)   for a whole number of prior replacements k ≥ 0
 *
 * and nothing else is a candidate. "The nearest match", "the same line", "search forwards" are all
 * guesses; a rung is an arithmetic consequence. A match the replacement itself INSERTED sits off
 * the ladder unless it happens to land on a rung — and when two rungs both hold a match there is no
 * way to tell how many replacements happened, so the edit is refused rather than resolved by
 * preference. Refusal costs a re-run; the wrong rung costs the user their text.
 *
 * An edit whose OWN offsets still hold a match is written there, untouched by any of this: that is
 * FR-054's "the position holds", and it is also what keeps an ordinary Replace All working over a
 * file where the replacement contains the term.
 *
 * ══ WHY THE LADDER IS A FALLBACK AND NOT THE ANSWER (#378) ══
 *
 * There is a case the ladder cannot reach, and it is not a gap in the arithmetic — it is a gap in the
 * evidence. With `ab` → `zzabzz` over `abab`, committing row 1 leaves `zzabzzab`, and row 2's scanned
 * `(2,4)` STILL HOLDS A MATCH: the one the replacement inserted. "The position holds" fires first and
 * writes there, over the middle of the text just written. Preferring the ladder instead would break
 * the far commoner shape one line above — an untouched `abab` whose replacement merely contains the
 * term — because the two produce identical bytes at identical offsets. Nothing in the text separates
 * them.
 *
 * So the information has to come from the caller, and it does: a caller stepping through one scan's
 * rows knows which of them it has already written, and hands over offsets ALREADY REBASED past its
 * own commits (`commit-replace.ts`). Those offsets take the "the position holds" path — the rebase
 * is exact, so there is nothing left to infer.
 *
 * The ladder is not narrowed to suit that, because it answers for the callers that have no such
 * ledger: a commit issued from a second panel over the same file, a re-verification against a
 * document some other view has since edited, and anything calling this directly. For a rebased
 * caller it is unreachable; for the rest it is the difference between a second commit working and
 * "the match had gone" (FR-050). Both are still true at once, which is why {@link EditVerification}
 * reports `applied` — the ledger the rebasing caller keeps is only as good as its knowledge of what
 * actually landed.
 */
export function verifyEdits(
  text: string,
  term: string,
  modes: MatchModes,
  edits: readonly Match[],
  /**
   * What this commit will write. Needed to re-resolve, because the shift a prior replacement caused
   * is a function of its length; `''` is a valid deletion and shifts by `-|term|`.
   */
  replacement = '',
): EditVerification {
  // Paired rather than accumulated separately, because the two arrays must agree entry for entry
  // and the sort below would otherwise reorder one of them.
  const writes: { at: Match; requested: Match }[] = [];
  const gone: Match[] = [];
  if (edits.length === 0) return { applicable: [], applied: [], gone };

  // An empty term matches nothing (`editorMatches`' own rule), so every edit is refused rather
  // than every edit being written over an empty needle.
  const live = new Set<string>();
  const liveFroms: number[] = [];
  if (term.length > 0) {
    for (const m of editorMatches(Text.of(text.split('\n')), term, modes)) {
      live.add(`${m.from}:${m.to}`);
      liveFroms.push(m.from);
    }
  }

  const seen = new Set<string>();
  const written = new Set<string>();
  for (const edit of [...edits].sort(byPosition)) {
    const key = `${edit.from}:${edit.to}`;
    // Two rows naming one match write ONE replacement. A duplicate is not a refusal — the match is
    // there — it is simply already accounted for.
    if (seen.has(key)) continue;
    seen.add(key);

    const at = live.has(key)
      ? { from: edit.from, to: edit.to }
      : reResolve(liveFroms, edit, term.length, replacement.length);
    if (at === null) {
      gone.push({ from: edit.from, to: edit.to });
      continue;
    }
    // Two DIFFERENT rows can re-resolve onto one live match; the second is already accounted for,
    // exactly as a duplicate row is, and must not produce a second replacement.
    const resolved = `${at.from}:${at.to}`;
    if (written.has(resolved)) continue;
    written.add(resolved);
    writes.push({ at, requested: { from: edit.from, to: edit.to } });
  }
  writes.sort((a, b) => byPosition(a.at, b.at));
  return {
    applicable: writes.map((w) => w.at),
    applied: writes.map((w) => w.requested),
    gone,
  };
}

/**
 * The one live match this commit's own arithmetic can have moved `edit` to, or `null`.
 *
 * `null` for none — the match has genuinely gone — and `null` for more than one, which is the
 * uniqueness rule the header describes: an ambiguity is refused, never preferred away.
 */
function reResolve(
  liveFroms: readonly number[],
  edit: Match,
  termLength: number,
  replacementLength: number,
): Match | null {
  const shift = replacementLength - termLength;
  // A length-preserving replacement moves nothing, so the scanned offset is the only rung there is
  // — and it has already been asked.
  if (shift === 0 || termLength === 0) return null;

  /*
   * Walked over the LIVE MATCHES rather than up the rungs, which is the same question asked the
   * cheap way round: a ladder with a shift of one over a megabyte would be a million steps per
   * edit, and the matches are the only rungs that could ever answer.
   */
  let found: Match | null = null;
  for (const from of liveFroms) {
    const k = (from - edit.from) / shift;
    if (!Number.isInteger(k) || k <= 0) continue;
    if (found !== null) return null; // two rungs hold a match — no way to tell which was meant
    found = { from, to: from + termLength };
  }
  return found;
}

/**
 * The text with every edit replaced — one pass, from the end backwards (FR-055, FR-046a).
 *
 * Backwards because an edit's offsets index the text as it was scanned: replacing from the end
 * means every offset still to be used sits in the part of the string nothing has touched yet. That
 * is what makes a replacement of a different length harmless, and it is why the caller may pass its
 * edits in any order.
 *
 * An EMPTY replacement is not a special case and deliberately has no branch: it deletes each match,
 * which is exactly what FR-046a asks for.
 */
export function applyReplacements(
  text: string,
  edits: readonly Match[],
  replacement: string,
): string {
  if (edits.length === 0) return text;

  const ordered = [...edits].sort(byPosition);
  const out: string[] = [];
  let cursor = text.length;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const { from, to } = ordered[i] as Match;
    // Defensive, and cheap: `verifyEdits` never yields an out-of-range or overlapping pair, but this
    // function is also the one a preview would call, and a bad pair here would corrupt the text
    // rather than fail.
    if (from < 0 || to > text.length || from > to || to > cursor) continue;
    out.push(text.slice(to, cursor));
    out.push(replacement);
    cursor = from;
  }
  out.push(text.slice(0, cursor));
  return out.reverse().join('');
}

function byPosition(a: Match, b: Match): number {
  return a.from - b.from || a.to - b.to;
}

/**
 * What each write's line SAYS once the commit has landed (FR-083b).
 *
 * ══ THE DEFECT THIS EXISTS TO REMOVE ══
 *
 * Two matches on ONE line each carry the other's old text in their surrounding context. A committed
 * row that swapped only its own `matched` would therefore be correct about itself and stale about
 * its neighbour: one row reading `thread = needle` above another reading `needle = thread`, when the
 * line now says `thread = thread`. Deriving each row's snippet INDEPENDENTLY of the row beside it is
 * what produces that; deriving them all from one new text is what removes it.
 *
 * ══ WHY IT TAKES THE OLD POSITIONS AND THE NEW TEXT ══
 *
 * `applicable` is {@link EditVerification}'s own array — where each write landed in the text as it
 * was BEFORE the commit, in document order — and `after` is that text with every one of them
 * replaced. The arithmetic between the two belongs here rather than in each caller: both commit
 * paths hold exactly this pair (the disk path after `applyReplacements`, the buffer path after its
 * dispatch), and each computing the shift for itself is two places for one off-by-one to live.
 *
 * The result is index-for-index with `applicable`, and therefore with `EditVerification.applied` —
 * which is what lets a caller answer in the coordinates it was ASKED in while describing the text as
 * it now is.
 *
 * ══ THE SAME `snippetFor` THE SCAN USED, AND THAT IS NOT AN IMPLEMENTATION DETAIL ══
 *
 * `snippetFor` decides how far context reaches, when it snaps to a word boundary and when it clips.
 * A second derivation answering any of those differently would shift a committed row's text
 * sideways for a reason that has nothing to do with the replacement — a rendering change the user
 * would read as a defect in the commit.
 *
 * Past `budgetChars` the remaining entries are `undefined`: the write happened, and what is bounded
 * is the answer. {@link MAX_COMMIT_SNIPPET_CHARS} carries the reasoning and the consequence.
 */
export function postCommitSnippets(
  after: Text,
  applicable: readonly Match[],
  replacementLength: number,
  budgetChars: number = MAX_COMMIT_SNIPPET_CHARS,
): (SnippetView | undefined)[] {
  const out: (SnippetView | undefined)[] = [];
  let shift = 0;
  let spent = 0;
  // `applicable` is already in document order, which is what makes one running shift exact: every
  // write before this one has moved it, and no write after it has.
  for (const at of applicable) {
    const from = at.from + shift;
    const to = from + replacementLength;
    shift += replacementLength - (at.to - at.from);
    if (spent >= budgetChars || from < 0 || to > after.length) {
      out.push(undefined);
      continue;
    }
    const line = after.lineAt(from);
    const snippet = snippetFor(line.text, from - line.from, to - line.from);
    spent += snippet.before.length + snippet.matched.length + snippet.after.length;
    out.push(snippet);
  }
  return out;
}
