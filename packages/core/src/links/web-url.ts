/**
 * 045 FR-102, FR-104 — ONE web-link grammar, for terminals and editors alike (`data-model.md` §13.2,
 * `contracts/link-resolution.md` §6.1, D10).
 *
 * The pattern moved here byte for byte from `ui/src/renderer/terminal/terminal-url.ts`, which now
 * re-exports it as `TERMINAL_URL_REGEX`, so the two panel types cannot recognise web links
 * differently.
 *
 * The plain-text url detector's pattern, handed to WebLinksAddon (#198).
 *
 * The addon's own pattern refuses every parenthesis, so `https://en.wikipedia.org/wiki/Bash_(Unix_shell)`
 * opened as `…/Bash_`. This one is the addon's pattern with one addition: a BALANCED `(…)` group may
 * appear anywhere in the url, including at its end. An unmatched `)` still ends it, so a url written
 * inside parentheses — `(see https://example.com/a)` — does not take the closing one with it.
 */
const BODY = String.raw`[^\s"'!*(){}|\\^<>` + '`]';
const GROUP = String.raw`\([^\s"'(){}|\\^<>` + '`]*\\)';
const LAST = String.raw`[^\s"':,.!?{}|\\^~\[\]` + '`()<>]';

export const WEB_URL_REGEX = new RegExp(
  `(?:https?|HTTPS?):[/]{2}(?:${BODY}|${GROUP})*(?:${LAST}|${GROUP})`,
);

/** One web link in a line: its address, and the half-open range it occupies. */
export interface WebLinkSpan {
  readonly uri: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Every web link `WEB_URL_REGEX` finds in `line`, left to right. Pure and total: a fresh global copy
 * of the pattern per call, so no `lastIndex` is shared between callers.
 */
export function detectWebLinks(line: string): readonly WebLinkSpan[] {
  const scanner = new RegExp(WEB_URL_REGEX.source, `${WEB_URL_REGEX.flags}g`);
  const spans: WebLinkSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(line)) !== null) {
    // A zero-length match would spin here; the pattern cannot produce one, but the guard is cheap.
    if (match[0].length === 0) {
      scanner.lastIndex += 1;
      continue;
    }
    spans.push({ uri: match[0], start: match.index, end: match.index + match[0].length });
  }
  return spans;
}
