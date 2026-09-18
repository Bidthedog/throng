import type { LinkCandidate, LinkPosition, Span } from './types.js';

/**
 * 045 FR-003 – FR-005, FR-009. One line in, zero or more `LinkCandidate`s out. Pure, total, and
 * blind to the disk — a candidate is NOT a link until it resolves (FR-006).
 *
 * ══ WHAT THIS REFUSES IS THE HARD PART ══
 *
 * Recognising `src/foo.ts` is easy. Refusing `60/40`, `1.2.3`, `e.g.`, `00:12:03` and
 * `support.example.com` is what SC-003 measures, and a grammar that says "anything with a slash"
 * turns every log line into a field of underlines. So a token qualifies only when one of four
 * things is true, and each one is a deliberate statement rather than a regex that happened to work:
 *
 *   A  it announces itself as relative — `./x`, `../x`, `~/x`;
 *   B  it is absolute — a drive form, a UNC form, or a leading `/`;
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
 * ══ AMBIGUITY IS EXPRESSED, NOT RESOLVED ══
 *
 * `C:\x\foo.ts:42:7` might name line 42 of `foo.ts`, or a file whose name ends `:42:7`. Detection
 * cannot know, because knowing means touching a disk. It emits BOTH readings, positioned first, and
 * `resolve.ts` R7 lets whichever exists decide.
 */
export function detectPathCandidates(line: string, claimed: readonly Span[]): LinkCandidate[] {
  if (line.length === 0) return [];

  const out: LinkCandidate[] = [];
  const consumed: Span[] = [];

  // Quoted runs first (D6): a path in matching quotes is ONE candidate, spaces and all. A run whose
  // contents do not look like a path is left alone, so an apostrophe in ordinary prose cannot
  // swallow a real path a few words later.
  QUOTED.lastIndex = 0;
  let quoted: RegExpExecArray | null;
  while ((quoted = QUOTED.exec(line)) !== null) {
    const inner = quoted[2];
    const at = quoted.index + 1;
    const before = out.length;
    emitReadings(out, inner, at);
    if (out.length > before) consumed.push({ start: quoted.index, end: quoted.index + quoted[0].length });
  }

  // Then whitespace-separated tokens, skipping anything a quoted run already accounted for.
  TOKEN.lastIndex = 0;
  let token: RegExpExecArray | null;
  while ((token = TOKEN.exec(line)) !== null) {
    const at = token.index;
    if (overlapsAny({ start: at, end: at + token[0].length }, consumed)) continue;
    emitReadings(out, token[0], at);
  }

  // D2: a span overlapping a range the web-link scanner already claimed yields nothing (FR-009).
  // Sorted by where they appear, and STABLY — two readings of one span share a start, and the sort
  // must not undo the positioned-reading-first order `emitReadings` put them in (R7).
  const kept = out.filter((c) => !overlapsAny({ start: c.start, end: c.end }, claimed));
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

// ── the grammar ────────────────────────────────────────────────────────────────────────────────

/** `"…"` or `'…'` with no nested quote of the same kind. Group 2 is the contents. */
const QUOTED = /(["'])([^"'\r\n]+)\1/g;

/** A whitespace-separated run. Quotes are excluded so a quoted run is never half-tokenised. */
const TOKEN = /[^\s"']+/g;

/** Leading characters that enclose rather than name: `(`, `[`, `{`, `<`. */
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

/** `./x`, `../x` or `~/x` — the token announces itself as relative or home-relative. */
const ANNOUNCED_RELATIVE = /^(?:\.{1,2}|~)[\\/]/;

/**
 * A plausible extension: at least two characters, ASCII alphanumeric, and **starting with a
 * letter**. See the header — every clause of this is load-bearing against `prose.txt`.
 */
const EXTENSION = /^[A-Za-z][A-Za-z0-9]{1,9}$/;

function emitReadings(out: LinkCandidate[], raw: string, rawStart: number): void {
  const trimmed = trim(raw);
  if (trimmed.text.length === 0) return;
  const start = rawStart + trimmed.offset;

  const positioned = splitPosition(trimmed.text);
  if (positioned && looksLikePath(positioned.base)) {
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

  if (looksLikePath(trimmed.text)) {
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
  if (text.startsWith('/')) return true;

  // A: the token announces itself.
  if (ANNOUNCED_RELATIVE.test(text)) return true;

  // A colon anywhere else means the token is punctuation or a time, not a path (`00:12:03`).
  if (text.includes(':')) return false;

  // C: a plausible extension, plus a separator or exactly one dot.
  const segments = text.split(/[\\/]/);
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

function overlapsAny(span: Span, ranges: readonly Span[]): boolean {
  return ranges.some((r) => span.start < r.end && r.start < span.end);
}
