import { KNOWN_FILE_EXTENSIONS } from './known-extensions.js';
import { MAX_PATH_SPACE_WORDS } from './limits.js';
import type { LinkCandidate, LinkPosition, Span } from './types.js';

/**
 * 045 FR-003 – FR-005, FR-009, and the space rule FR-173 as amended by FR-174, FR-178, FR-178a and
 * FR-179. One line in, zero or more `LinkCandidate`s out. Pure, total, and blind to the disk: validity
 * is syntactic (FR-155), so nothing here asks whether a file exists.
 *
 * ══ WHAT THIS REFUSES IS THE HARD PART ══
 *
 * Recognising `src/foo.ts` is easy. Refusing `60/40`, `1.2.3`, `e.g.`, `00:12:03` and
 * `support.example.com` is what SC-003 measures, and a grammar that says "anything with a slash"
 * turns every log line into a field of underlines. So a bare token qualifies only when one of four
 * things is true, and each one is a deliberate statement rather than a regex that happened to work:
 *
 *   A  it announces itself as relative — `./x`, `../x`, `~/x`;
 *   B  it is absolute — a drive form, a UNC form, or a leading `/` followed by a path character
 *      (FR-174: any rooted path, `/help` included; `/?` is not one);
 *   C  its last segment carries a plausible EXTENSION, and the token either has a separator or
 *      exactly one dot;
 *   D  it is a `file:` URI written as text (FR-003f).
 *
 * Rule C's two extra conditions are what the prose fixture pays for. **The extension must start
 * with a letter and be at least two characters**: without the first, `51.5074` and `4.5s` are
 * paths; without the second, `e.g` and `I.T` are. **Exactly one dot, when there is no separator**:
 * without it, `support.example.com` and `1.2.3` are. Each of those five is a line in
 * `packages/ui/tests/fixtures/links/prose.txt`, and loosening any one of the conditions turns that
 * fixture red before it turns a user's terminal noisy.
 *
 * ══ SPACES (FR-173, FR-179) — the case table is `link-detect-spaces.test.ts` ══
 *
 *  1. DEFAULT. A path stops at the first space; bare tokens keep rules A – D.
 *  2. ENCLOSED. Backticks, a matched `"…"` or `'…'`, or a matched `()`, `<>`, `[]`, `{}` hold one
 *     candidate, spaces and all, when their trimmed contents look like a path by rules A – D (FR-179e);
 *     otherwise the enclosure is ignored and its contents obey the default. Brackets pair by depth and
 *     the innermost pair holding a path wins. A quote or backtick opens only at the start of the line,
 *     after whitespace or after an opening bracket, so an apostrophe (`it's`) never opens one.
 *  3. SCAN. A token that is anchored or contains a separator scans forward word by word across SINGLE
 *     spaces. The FIRST word — the token itself included — that ends in a separator, or whose last
 *     segment ends in a KNOWN extension (FR-178), ends the span. With no such word the default
 *     applies. The scan never takes a word that begins an anchored path, a URL, a quote or backtick,
 *     or a path-holding enclosure, and the whole span is at most `MAX_PATH_SPACE_WORDS` words
 *     (FR-179f). An unbalanced bracket is trimmed (FR-005) rather than ending it.
 *  4. Words a scan did not consume are judged on their own.
 *  5. The known extensions are an input (`DetectOptions.knownExtensions`), defaulting to the shipped
 *     `KNOWN_FILE_EXTENSIONS`; matching ignores case.
 *
 * There is ONE reading per span. Round three's longest-first extended readings (FR-150), which let
 * resolution pick among them by existence, are gone: the grammar picks.
 *
 * ══ ONE THING THE GRAMMAR IS ALLOWED TO BE TOLD (round five) ══
 *
 * A prompt whose folder has a space in it — `PS D:\git\throng_tests\test 1>` — stopped at the space,
 * because from the TEXT ALONE rule 3 is right to stop: `test 1` ends in no separator and no known
 * extension. Weakening the rule to catch it is what the 92-case table exists to prevent.
 *
 * So the caller may pass `namesKnownDirectory`: "this text names the directory I already know this
 * terminal is sitting in". A scan that crosses a space and lands on such a text may end there, and the
 * LONGEST such landing wins, so `…\test 1` is taken whole. It is a comparison against a value the app
 * is already holding — still no disk, still nothing asked (FR-155) — and the predicate is the caller's
 * because only the caller knows about drive letters and mount forms (Principle II; see
 * `renderer/links/path-by-name.ts` for why that knowledge stays out of core).
 *
 * With no predicate — every editor, and any terminal whose flavour cannot report its directory —
 * detection is exactly what the table says it is.
 *
 * ══ POSITION AMBIGUITY IS STILL EXPRESSED, NOT RESOLVED ══
 *
 * `C:\x\foo.ts:42:7` might name line 42 of `foo.ts`, or a file whose name ends `:42:7`. Detection
 * cannot know, because knowing means touching a disk. It emits BOTH readings of the one span,
 * positioned first, and resolution (R7) lets whichever exists decide.
 */
export interface DetectOptions {
  /** FR-173e / FR-178: the resolved set (`resolveKnownExtensions`). Lower-case, no dot. */
  readonly knownExtensions?: ReadonlySet<string>;
  /**
   * Round five — "does this text name the directory this surface already knows it is in?" See the
   * header. Called only with a reading a scan has already CROSSED a space to reach, trimmed by
   * FR-005, and only while the scan is within `MAX_PATH_SPACE_WORDS`. Absent means the space rule is
   * unchanged, which is what every caller without a live working directory passes.
   *
   * The predicate answers for the directory itself and for an ancestor of it at a separator boundary,
   * so a prompt printing a parent extends too; it must be pure and must not touch the disk (FR-155).
   */
  readonly namesKnownDirectory?: (text: string) => boolean;
}

export function detectPathCandidates(
  line: string,
  claimed: readonly Span[],
  options: DetectOptions = {},
): LinkCandidate[] {
  if (line.length === 0) return [];
  const known = options.knownExtensions ?? KNOWN_FILE_EXTENSIONS;

  const out: LinkCandidate[] = [];

  // Rule 2 first: every path-holding enclosure is one candidate, and its whole extent — delimiters
  // included — is taken out of what rule 3 sees.
  const taken = new Uint8Array(line.length);
  for (const pair of enclosurePairs(line)) {
    if (anyTaken(taken, pair.open, pair.close + 1)) continue;
    const readings = enclosedReadings(line, pair.open + 1, pair.close);
    if (readings.length === 0) continue;
    out.push(...readings);
    taken.fill(1, pair.open, pair.close + 1);
  }

  const blocked = (from: number, to: number): boolean =>
    anyTaken(taken, from, to) || overlapsAny({ start: from, end: to }, claimed);

  // Rules 1, 3 and 4: whitespace-separated tokens, left to right. A scan that crosses spaces consumes
  // the words it crossed, so they are not judged again.
  let resumeAt = 0;
  TOKEN.lastIndex = 0;
  let token: RegExpExecArray | null;
  while ((token = TOKEN.exec(line)) !== null) {
    const tokenEnd = token.index + token[0].length;
    if (token.index < resumeAt || blocked(token.index, tokenEnd)) continue;
    // D12: PowerShell's provider qualifier is not part of the path. It is dropped before the token
    // is judged, so the candidate — and its span — is the path alone; every other `Name::` token is
    // still judged whole, and still refused for its colon.
    const qualifier = PROVIDER_QUALIFIER.exec(token[0]);
    const skip = qualifier === null ? 0 : qualifier[0].length;
    const raw = token[0].slice(skip);
    if (raw.length === 0) continue;
    const at = token.index + skip;

    const crossedTo = scanAcrossSpaces(line, at, tokenEnd, known, blocked, options.namesKnownDirectory);
    if (crossedTo !== null) {
      emitReadings(out, line.slice(at, crossedTo), at, acceptsCrossed);
      resumeAt = crossedTo;
      continue;
    }
    emitReadings(out, raw, at, looksLikePath);
  }

  // D2: a span overlapping a range the web-link scanner already claimed yields nothing (FR-009).
  // Sorted by where they appear, and STABLY — the two readings of one span share a start, and the sort
  // must not undo the positioned-reading-first order `emitReadings` put them in (R7).
  const kept = out.filter((c) => !overlapsAny({ start: c.start, end: c.end }, claimed));
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * The text of each span drawn as a FILE link, in line order — the space rule's case table's view of
 * `detectPathCandidates` (data-model §16.10). One entry per span: FR-004's position is excluded (the
 * positioned reading is the one reported), and FR-005's trim applied. Web links are the web scanner's,
 * so a URL is never returned.
 */
export function detectPathSpans(line: string, options: DetectOptions = {}): string[] {
  const texts: string[] = [];
  let lastStart = -1;
  for (const c of detectPathCandidates(line, [], options)) {
    if (c.start === lastStart) continue;
    lastStart = c.start;
    texts.push(c.text);
  }
  return texts;
}

// ── the grammar ────────────────────────────────────────────────────────────────────────────────

/** A whitespace-separated run. Quotes and backticks end it, so an unpaired one is never kept. */
const TOKEN = /[^\s"'`]+/g;

/** One whitespace-separated word, read at a fixed offset (sticky) by the scan. */
const WORD = /\S+/y;

/** Quote characters that pair with themselves (FR-173a, FR-173b). */
const QUOTES = '"\'`';

/** Leading characters that enclose rather than name: `(`, `[`, `{`, `<` (FR-173c, FR-179a). */
const OPENERS = '([{<';
const CLOSERS = ')]}>';

/** FR-005's trailing sentence punctuation. */
const TRAILING_PUNCTUATION = ',.:;';

/** `:42`, `:42:7` or `(42,7)` at the very end of a token. */
const POSITION_SUFFIX = /(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))$/;

/** A scheme prefix — `https://`, `file://`, `mailto:`. Only `file:` is ours (FR-003f, FR-013). */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

/** A drive form: one letter, a colon, then a separator. */
const DRIVE_FORM = /^[A-Za-z]:[\\/]/;

/** A UNC form: two separators, a host, then a separator. */
const UNC_FORM = /^[\\/]{2}[^\\/]+[\\/]/;

/**
 * FR-174: a rooted path — a `/` followed by a path character (a letter, a digit, or one of
 * `. _ ~ -`). `/help` and `/s` qualify; `/?`, `/*` and a lone `/` do not.
 */
const ROOTED = /^\/[A-Za-z0-9._~-]/;

/** `./x`, `../x` or `~/x` — the token announces itself as relative or home-relative. */
const ANNOUNCED_RELATIVE = /^(?:\.{1,2}|~)[\\/]/;

/**
 * A plausible extension: at least two characters, ASCII alphanumeric, and **starting with a
 * letter**. See the header — every clause of this is load-bearing against `prose.txt`.
 */
const EXTENSION = /^[A-Za-z][A-Za-z0-9]{1,9}$/;

/**
 * D12 / FR-003g: `FileSystem::`, optionally after `Microsoft.PowerShell.Core\` — how PowerShell
 * prints a location in its prompt, `pwd` and `Resolve-Path`. Anchored at the token's start, so a
 * qualifier in the middle of a token is not one.
 */
const PROVIDER_QUALIFIER = /^(?:Microsoft\.PowerShell\.Core\\)?FileSystem::/i;

const SEPARATOR = /[\\/]/;

/** FR-174's path character: a letter, a digit, or one of `. _ ~ -`. */
const PATH_CHARACTER = /[A-Za-z0-9._~-]/;

interface Pair {
  readonly open: number;
  readonly close: number;
}

/**
 * Rule 2's candidate enclosures, innermost first (shortest first — brackets pair by depth, so a
 * shorter pair overlapping a longer one lies inside it). Quote and backtick pairs are found first and
 * are opaque to bracket pairing; a closer that does not match the innermost open bracket pairs with
 * nothing, so `(D:\a b\c]` is no enclosure at all.
 */
function enclosurePairs(line: string): Pair[] {
  const pairs: Pair[] = [];
  const quoted = new Uint8Array(line.length);

  for (let i = 0; i < line.length; i += 1) {
    const q = line[i];
    if (!QUOTES.includes(q)) continue;
    const prev = i === 0 ? ' ' : line[i - 1];
    if (!/\s/.test(prev) && !OPENERS.includes(prev)) continue;
    const close = line.indexOf(q, i + 1);
    if (close < 0) continue;
    if (close > i + 1) pairs.push({ open: i, close });
    quoted.fill(1, i, close + 1);
    i = close;
  }

  const stack: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (quoted[i] === 1) continue;
    const ch = line[i];
    if (OPENERS.includes(ch)) {
      stack.push(i);
      continue;
    }
    const closer = CLOSERS.indexOf(ch);
    if (closer < 0 || stack.length === 0) continue;
    const top = stack[stack.length - 1];
    if (line[top] !== OPENERS[closer]) continue;
    stack.pop();
    if (i > top + 1) pairs.push({ open: top, close: i });
  }

  // Stable, so two pairs of one length stay in line order.
  return pairs.sort((a, b) => a.close - a.open - (b.close - b.open));
}

/** The readings of an enclosure's contents `[from, to)`, trimmed of surrounding whitespace. */
function enclosedReadings(line: string, from: number, to: number): LinkCandidate[] {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(line[start])) start += 1;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;
  const found: LinkCandidate[] = [];
  if (end > start) emitReadings(found, line.slice(start, end), start, looksLikePath);
  return found;
}

/**
 * Rule 3. From a token `[at, tokenEnd)` that is anchored or carries a separator, the end of the span
 * when it CROSSES at least one space — or `null` when it does not: the token ends itself, the token
 * may not scan, or no word within the cap qualifies (the default).
 *
 * `namesDirectory` is the header's round-five input. A word that TERMINATES still wins immediately, so
 * the case table is untouched; a word that merely completes the known directory is remembered and the
 * scan carries on, because a directory two words long (`…\my test 1`) would otherwise be cut at its
 * first word — the same "missed off the end" the bug reported, one word later.
 */
function scanAcrossSpaces(
  line: string,
  at: number,
  tokenEnd: number,
  known: ReadonlySet<string>,
  blocked: (from: number, to: number) => boolean,
  namesDirectory?: (text: string) => boolean,
): number | null {
  const token = trim(line.slice(at, tokenEnd)).text;
  if (token.length === 0 || SCHEME.test(token) && !/^file:/i.test(token)) return null;
  if (!isAnchored(token) && !SEPARATOR.test(token)) return null;
  // A token of separators and symbols alone (`/*`, `//`, `*/`) names nothing to start from — FR-174's
  // "a `/` with no path character after it is not a link", applied to the scan's starting word, so a
  // C comment `/* … */` is never drawn as a path ending in `*/`.
  if (!PATH_CHARACTER.test(token)) return null;
  if (terminates(line.slice(at, tokenEnd), known)) return null;

  let words = 1;
  let pos = tokenEnd;
  /** The furthest word at which the span named the known directory, or `null` for none. */
  let directoryEnd: number | null = null;
  while (words < MAX_PATH_SPACE_WORDS && line[pos] === ' ') {
    WORD.lastIndex = pos + 1;
    const word = WORD.exec(line);
    if (word === null) break;
    const wordEnd = pos + 1 + word[0].length;
    if (QUOTES.includes(word[0][0]) || beginsAnotherLink(word[0]) || blocked(pos + 1, wordEnd)) {
      break;
    }
    words += 1;
    const reading = line.slice(at, wordEnd);
    if (terminates(reading, known)) return wordEnd;
    if (namesDirectory?.(trim(reading).text) === true) directoryEnd = wordEnd;
    pos = wordEnd;
  }
  return directoryEnd;
}

/** FR-179b: a reading ends in a separator, or its last segment in a known extension. */
function terminates(reading: string, known: ReadonlySet<string>): boolean {
  const text = trim(reading).text;
  const base = splitPosition(text)?.base ?? text;
  if (base.length === 0) return false;
  if (SEPARATOR.test(base[base.length - 1])) return true;
  const segments = base.split(SEPARATOR);
  const last = segments[segments.length - 1];
  const dot = last.lastIndexOf('.');
  return dot > 0 && known.has(last.slice(dot + 1).toLowerCase());
}

/** The anchored forms: drive, UNC, a rooted `/`, `./`, `../`, `~/`, or a `file:` URI. */
function isAnchored(text: string): boolean {
  return (
    DRIVE_FORM.test(text) ||
    UNC_FORM.test(text) ||
    ROOTED.test(text) ||
    ANNOUNCED_RELATIVE.test(text) ||
    /^file:/i.test(text)
  );
}

/** A word that begins an anchored form, a scheme, or D12's qualifier starts a link of its own. */
function beginsAnotherLink(word: string): boolean {
  let from = 0;
  while (from < word.length && OPENERS.includes(word[from])) from += 1;
  const bare = word.slice(from);
  return isAnchored(bare) || SCHEME.test(bare) || PROVIDER_QUALIFIER.test(bare);
}

/**
 * A span a scan ended by crossing spaces is vouched for by the word that ended it — a separator or a
 * known extension — so rule C's extension test does not apply (`build\out dir\` is a link). A web
 * scheme is still never a path, and a relative reading with a colon is still punctuation.
 */
function acceptsCrossed(text: string): boolean {
  const scheme = SCHEME.exec(text);
  if (scheme) return scheme[1].toLowerCase() === 'file' && text.length > scheme[0].length;
  if (isAnchored(text)) return true;
  return !text.includes(':');
}

function emitReadings(
  out: LinkCandidate[],
  raw: string,
  rawStart: number,
  accepts: (text: string) => boolean,
): void {
  const trimmed = trim(raw);
  if (trimmed.text.length === 0) return;
  const start = rawStart + trimmed.offset;

  const positioned = splitPosition(trimmed.text);
  if (positioned && accepts(positioned.base)) {
    // The reading WITH the position, first (R7). Its span covers the path alone — FR-004's "the
    // position is not part of the path", made visible in what gets underlined.
    out.push({
      text: positioned.base,
      start,
      end: start + positioned.base.length,
      position: positioned.position,
      positionText: positioned.positionText,
    });
    // …and the reading WITHOUT it, for the file that genuinely ends in `:42:7`.
    out.push({ text: trimmed.text, start, end: start + trimmed.text.length });
    return;
  }

  if (accepts(trimmed.text)) {
    out.push({ text: trimmed.text, start, end: start + trimmed.text.length });
  }
}

/**
 * FR-005. Strip enclosing brackets and trailing sentence punctuation, and report how far the kept
 * text starts into the raw token so offsets stay honest.
 *
 * A bracket is stripped when it ENCLOSES the token — at an edge — and kept when it sits inside one,
 * which is the whole of D5. `(src/foo.ts)` is a path someone wrote in parentheses and loses both;
 * `src/foo(1).ts` is a path with a balanced pair in the middle and loses neither, because neither of
 * its edges is a bracket at all. A lone closer with no opener (`src/foo.ts)`) goes the same way as
 * the enclosing pair: it was never part of the name.
 */
function trim(raw: string): { text: string; offset: number } {
  let from = 0;
  let to = raw.length;
  let changed = true;
  while (changed && from < to) {
    changed = false;

    const last = raw[to - 1];
    if (TRAILING_PUNCTUATION.includes(last)) {
      to -= 1;
      changed = true;
      continue;
    }

    const first = raw[from];
    const openerAt = OPENERS.indexOf(first);
    const closerAt = CLOSERS.indexOf(last);

    // An enclosing pair: both edges, and they match.
    if (openerAt >= 0 && openerAt === closerAt && to - from >= 2) {
      from += 1;
      to -= 1;
      changed = true;
      continue;
    }
    // A closer the token never opened.
    if (closerAt >= 0 && count(raw, from, to, OPENERS[closerAt]) < count(raw, from, to, last)) {
      to -= 1;
      changed = true;
      continue;
    }
    // An opener the token never closes.
    if (openerAt >= 0 && count(raw, from, to, CLOSERS[openerAt]) < count(raw, from, to, first)) {
      from += 1;
      changed = true;
    }
  }
  return { text: raw.slice(from, to), offset: from };
}

function count(s: string, from: number, to: number, ch: string): number {
  let n = 0;
  for (let i = from; i < to; i += 1) if (s[i] === ch) n += 1;
  return n;
}

function splitPosition(
  text: string,
): { base: string; position: LinkPosition; positionText: string } | null {
  const m = POSITION_SUFFIX.exec(text);
  if (!m) return null;
  const base = text.slice(0, m.index);
  if (base.length === 0) return null;
  const line = Number(m[1] ?? m[3]);
  const columnRaw = m[2] ?? m[4];
  if (!Number.isSafeInteger(line)) return null;
  const position: LinkPosition =
    columnRaw === undefined ? { line } : { line, column: Number(columnRaw) };
  return { base, position, positionText: m[0] };
}

/** Rules A–D of the header. The one place the grammar's strictness is stated. */
function looksLikePath(text: string): boolean {
  if (text.length < 2) return false;

  // D / FR-013: a `file:` URI is ours; every other scheme belongs to the web-link scanner or to
  // nothing at all, and must never become a path candidate.
  const scheme = SCHEME.exec(text);
  if (scheme) return scheme[1].toLowerCase() === 'file' && text.length > scheme[0].length;

  // B: absolute forms. A drive form is checked before the leading-separator forms so `C:/x` is not
  // mistaken for a relative token that happens to contain a colon.
  if (DRIVE_FORM.test(text)) return true;
  if (UNC_FORM.test(text)) return true;
  if (ROOTED.test(text)) return true;

  // A: the token announces itself.
  if (ANNOUNCED_RELATIVE.test(text)) return true;

  // A colon anywhere else means the token is punctuation or a time, not a path (`00:12:03`).
  if (text.includes(':')) return false;

  // C: a plausible extension, plus a separator or exactly one dot.
  const segments = text.split(SEPARATOR);
  const hasSeparator = segments.length > 1;
  if (!hasSeparator && countChar(text, '.') !== 1) return false;
  const last = segments[segments.length - 1];
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return false;
  return EXTENSION.test(last.slice(dot + 1));
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}

function anyTaken(taken: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) if (taken[i] === 1) return true;
  return false;
}

function overlapsAny(span: Span, ranges: readonly Span[]): boolean {
  return ranges.some((r) => span.start < r.end && r.start < span.end);
}
