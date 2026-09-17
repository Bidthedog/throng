/**
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

export const TERMINAL_URL_REGEX = new RegExp(
  `(?:https?|HTTPS?):[/]{2}(?:${BODY}|${GROUP})*(?:${LAST}|${GROUP})`,
);
