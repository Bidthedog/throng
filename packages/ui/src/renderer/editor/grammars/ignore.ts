/**
 * Ignore-file grammar (055 FR-014) — `.gitignore` and the files that borrow its syntax, plus
 * `.gitattributes`, whose lines are a pattern followed by attributes.
 *
 * A line is a comment (`#`), or an optional `!` negation, a pattern, and — in `.gitattributes` —
 * attributes after it. `\#` and `\!` escape the marker, so the line is a pattern. Every style is a
 * tag `highlight-style.ts` already maps (FR-020).
 */
import type { StreamParser } from '@codemirror/language';

interface IgnoreState {
  /** Whether this line's pattern has been read — anything after it is an attribute. */
  patternRead: boolean;
}

export const ignore: StreamParser<IgnoreState> = {
  name: 'ignore',
  startState: () => ({ patternRead: false }),

  token(stream, state) {
    if (stream.sol()) {
      state.patternRead = false;
      if (stream.peek() === '#') {
        stream.skipToEnd();
        return 'comment';
      }
      if (stream.eat('!')) return 'operator';
    }
    if (stream.eatSpace()) return null;

    while (!stream.eol()) {
      const ch = stream.next();
      if (ch === '\\') stream.next();
      if (/\s/.test(stream.peek() ?? ' ')) break;
    }
    if (state.patternRead) return 'attributeName';
    state.patternRead = true;
    return 'string';
  },
};
