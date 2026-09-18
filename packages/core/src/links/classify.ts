/**
 * What kind of thing is a hyperlink target? (045 FR-009, FR-011, FR-013; research R5.)
 *
 * ══ WHY THIS IS ONE FUNCTION AND NOT A REGEX AT EACH CALL SITE ══
 *
 * The same `^https?://` test was written out three times before 045 — in `openTerminalLink`, in
 * `setHovered`, and in `terminalLinkTarget` — because each caller needed the same two-answer
 * question and a two-answer question is cheaper to re-type than to import. This feature turns it
 * into a THREE-answer question at every one of those sites, and three copies of a three-answer
 * question is how one of them ends up disagreeing with the other two about `file:` — which is
 * exactly the shape of #198, where one site knew about a link and another did not.
 *
 * `inert` is the answer that carries the safety. 024 FR-019 requires every non-`http(s)` scheme to
 * be unopenable, and the failure mode it guards against is a scheme falling THROUGH a check into
 * the OS URL opener. So this closes by default: anything that is not recognised is inert, including
 * text carrying no scheme at all.
 *
 * `terminal-url.ts`'s `TERMINAL_URL_REGEX` is NOT this. That one scans plain terminal text for
 * things that look like URLs; this one judges a target that is already in hand. They answer
 * different questions and neither replaces the other.
 */
export type TerminalLinkKind = 'web' | 'file' | 'inert';

/** A scheme at the very start of the string: letters, then `+`/`.`/`-`, then a colon. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

export function classifyTerminalLinkTarget(uri: string): TerminalLinkKind {
  const m = SCHEME.exec(uri);
  if (!m) return 'inert';
  switch (m[1].toLowerCase()) {
    case 'http':
    case 'https':
      return 'web';
    case 'file':
      return 'file';
    default:
      return 'inert';
  }
}
