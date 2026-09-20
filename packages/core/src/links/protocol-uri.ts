/**
 * 045 FR-159, FR-159a, FR-159b — allowlisted protocol links (`mailto:`, `tel:`, `slack:` …) in a line.
 *
 * Its own module, so the web grammar (`web-url.ts`) and 024's web cases stay untouched (plan round
 * four, fourth-pass correction). Pure and total, like the other scanners.
 *
 * ══ THE GRAMMAR (FR-159a) ══
 *
 * `<scheme>:` followed by a run of non-whitespace characters. `//` after the colon is optional
 * (`slack:open` and `slack://open` both qualify); FR-005's trailing punctuation and an unbalanced closing
 * bracket or quote are trimmed from the run's end (`mailto:a@b.c.` → `mailto:a@b.c`); a space ends it
 * (`tel:+44 20` → `tel:+44`); an empty run (`mailto:`, `slack://`) is not a link. A scheme starts a span
 * only at a word boundary, so `xmailto:` is not `mailto:`.
 *
 * A span is a link only when its scheme is in the allowlist AND not in the refused set — refused is
 * applied after the allowlist (FR-159), so allowlisting `javascript` does nothing. `http`, `https` and
 * `file` are never protocol spans: the first two are the web grammar's, `file:` is the path grammar's
 * (FR-003f) and an on-device link (FR-157).
 *
 * ══ A BARE EMAIL ADDRESS IS A `mailto:` SPAN (round five, reported 2026-09-20) ══
 *
 * `someone@example.com` written without a scheme is one of these, with the scheme SUPPLIED: the span
 * covers the address as written and its `uri` is `mailto:` plus that address. It is the only span
 * whose `uri` is not `line.slice(start, end)`, which is deliberate and is the same shape as an OSC 8
 * hyperlink — the text a reader sees and the target it goes to are two different strings.
 *
 * Without this a bare address reached the PATH grammar, which read `name.ext` and offered to open
 * `<the terminal's directory>\someone@example.com`. Nothing here knew what an address was: the web
 * grammar wants a scheme, this one wanted a literal `mailto:`, and the Markdown preview escaped it
 * only because markdown-it autolinks an address before throng ever sees the text. So one surface
 * mailed and two offered a file that could not exist (FR-104, FR-166).
 *
 * It obeys the allowlist like any other protocol span: take `mailto` off it and a bare address is not
 * a link at all — not a mail link, and still not a path.
 *
 * The local part deliberately excludes `/` and `\`, so a PATH carrying an `@` is never read as an
 * address, and a match must begin at a word boundary, so `D:\p\a.b@c.com\x.ts` and a scoped package
 * are left to the path grammar. The domain needs a dot and a letters-only last label, so `@scope` and
 * a bare `user@host` are not addresses either.
 */

import type { Span } from './types.js';

/** One allowlisted protocol link in a line: its text, its scheme (lower-case) and its range. */
export interface ProtocolLinkSpan {
  readonly uri: string;
  readonly scheme: string;
  readonly start: number;
  readonly end: number;
}

/** FR-159's shipped allowlist — the default of `editor.links.protocolAllowlist`. */
export const DEFAULT_PROTOCOL_ALLOWLIST: readonly string[] = ['mailto', 'tel', 'slack'];

/** Schemes other grammars own, whatever the allowlist says. */
const NEVER_PROTOCOL = new Set(['http', 'https', 'file']);

/**
 * At least two characters: a letter and a colon alone is FR-003b's drive form (`C:\x.txt`), which is
 * the path grammar's, whatever the allowlist says.
 */
const SCHEME_AT = /[A-Za-z][A-Za-z0-9+.-]+:/g;

/** A character that, before a scheme, makes it the middle of a word rather than the start of one. */
const WORD_CHARACTER = /[A-Za-z0-9+.\-_@:/\\]/;

/**
 * A bare email address. The local part takes the common unquoted characters MINUS `/` and `\`, which
 * is what keeps a path out; the domain needs at least one dot and a last label of letters only.
 */
const BARE_EMAIL_AT = /[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}/g;

/** The scheme a bare address is given. Subject to the allowlist exactly like a written one. */
const EMAIL_SCHEME = 'mailto';

const TRAILING = ',.:;\'"`';
const OPENERS = '([{<';
const CLOSERS = ')]}>';

/**
 * FR-159b: an allowlist entry is trimmed, lower-cased and loses one trailing `://` or `:`, so `slack:`,
 * ` Slack ` and `zoommtg://` all work as typed. Returns `''` for an entry that is empty after that.
 */
export function normaliseProtocolScheme(entry: string): string {
  const e = entry.trim().toLowerCase();
  if (e.endsWith('://')) return e.slice(0, -3).trim();
  if (e.endsWith(':')) return e.slice(0, -1).trim();
  return e;
}

/** FR-159b over a whole list: normalised, empties dropped, as a set. */
export function protocolAllowlistSet(entries: readonly string[]): ReadonlySet<string> {
  return new Set(entries.map(normaliseProtocolScheme).filter((e) => e.length > 0));
}

/**
 * Every allowlisted, unrefused protocol span in `line`, left to right. `allowlist` and `refused` hold
 * lower-case scheme names (`protocolAllowlistSet` normalises a setting's entries).
 */
export function detectProtocolSpans(
  line: string,
  allowlist: ReadonlySet<string>,
  refused: ReadonlySet<string>,
): ProtocolLinkSpan[] {
  const spans: ProtocolLinkSpan[] = [];
  if (allowlist.size === 0) return spans;
  const scanner = new RegExp(SCHEME_AT.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(line)) !== null) {
    const start = match.index;
    if (start > 0 && WORD_CHARACTER.test(line[start - 1])) continue;
    const scheme = match[0].slice(0, -1).toLowerCase();
    if (NEVER_PROTOCOL.has(scheme) || !allowlist.has(scheme) || refused.has(scheme)) continue;

    let end = start + match[0].length;
    while (end < line.length && !/\s/.test(line[end])) end += 1;
    const bodyStart = start + match[0].length;
    end = trimRunEnd(line, bodyStart, end);
    scanner.lastIndex = Math.max(end, scanner.lastIndex);

    const body = line.slice(bodyStart, end).replace(/^\/\//, '');
    if (body.length === 0) continue;
    spans.push({ uri: line.slice(start, end), scheme, start, end });
  }
  return spans;
}

/**
 * The bare addresses in `line`, as `mailto:` spans, skipping any a span in `claimed` already covers —
 * `mailto:someone@example.com` is ONE link, not a link with another inside it, and an address inside
 * a web address (`https://user@host.example/x`) belongs to the web span that found it.
 *
 * NOT gated on the allowlist, deliberately, and this is the whole reason it is a separate function.
 * The allowlist decides whether an address is a LINK; it has no opinion on whether it is a FILE. With
 * `mailto` removed, a gated detector would hand the address straight back to the path grammar, which
 * would offer to open `<the terminal's directory>\someone@example.com` — the reported defect, reached
 * by a second route. `scanLinkLine` therefore CLAIMS every address and publishes only the allowed
 * ones, which is the same thing it already does for a refused scheme.
 */
export function detectBareEmailSpans(line: string, claimed: readonly Span[]): ProtocolLinkSpan[] {
  const spans: ProtocolLinkSpan[] = [];
  const scanner = new RegExp(BARE_EMAIL_AT.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > 0 && WORD_CHARACTER.test(line[start - 1])) continue;
    if (claimed.some((s) => start < s.end && s.start < end)) continue;
    spans.push({ uri: `${EMAIL_SCHEME}:${match[0]}`, scheme: EMAIL_SCHEME, start, end });
  }
  return spans;
}

/** Whether a bare address is a link at all — `mailto` allowlisted, and not refused (FR-159). */
export function bareEmailsAreLinks(
  allowlist: ReadonlySet<string>,
  refused: ReadonlySet<string>,
): boolean {
  return allowlist.has(EMAIL_SCHEME) && !refused.has(EMAIL_SCHEME);
}

/** FR-005 on a run's end: sentence punctuation, a stray quote, and a closer the run never opened. */
function trimRunEnd(line: string, from: number, to: number): number {
  let end = to;
  for (;;) {
    if (end <= from) return end;
    const last = line[end - 1];
    if (TRAILING.includes(last)) {
      end -= 1;
      continue;
    }
    const closer = CLOSERS.indexOf(last);
    if (closer >= 0) {
      const run = line.slice(from, end);
      if (count(run, OPENERS[closer]) < count(run, last)) {
        end -= 1;
        continue;
      }
    }
    return end;
  }
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}
