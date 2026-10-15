/**
 * Dotenv grammar (055 FR-013) — `.env` and its `.env.*` variants.
 *
 * Hand-written because the shipped `properties` mode reads `export KEY` as one key and does not set
 * quoted values apart. Every style returned here is a tag `highlight-style.ts` already maps (FR-020):
 * comment, keyword, propertyName, operator, string, variableName. Values are highlighted, never
 * resolved and never masked.
 */
import type { StreamParser } from '@codemirror/language';

interface DotenvState {
  /** Where on the line we are: before the key, between key and `=`, or in the value. */
  phase: 'key' | 'eq' | 'value';
  /** The quote a value opened and has not yet closed — a quoted value may span lines. */
  quote: string | null;
}

/** Consume up to and including the closing `quote`, honouring a backslash escape inside `"…"`. */
function readQuoted(stream: { next(): string | void; eol(): boolean }, quote: string): boolean {
  let escaped = false;
  while (!stream.eol()) {
    const ch = stream.next();
    if (escaped) escaped = false;
    else if (ch === '\\' && quote === '"') escaped = true;
    else if (ch === quote) return true;
  }
  return false;
}

export const dotenv: StreamParser<DotenvState> = {
  name: 'dotenv',
  startState: () => ({ phase: 'key', quote: null }),

  token(stream, state) {
    if (state.quote !== null) {
      if (readQuoted(stream, state.quote)) state.quote = null;
      return 'string';
    }
    if (stream.sol()) state.phase = 'key';
    if (stream.eatSpace()) return null;

    if (state.phase === 'key') {
      if (stream.peek() === '#') {
        stream.skipToEnd();
        return 'comment';
      }
      if (stream.match(/^export(?=\s)/)) return 'keyword';
      if (stream.match(/^[A-Za-z_][\w.-]*/)) {
        state.phase = 'eq';
        return 'propertyName';
      }
      stream.skipToEnd();
      return null;
    }

    if (state.phase === 'eq') {
      if (stream.eat('=')) {
        state.phase = 'value';
        return 'operator';
      }
      stream.skipToEnd();
      return null;
    }

    // The value. A `#` is a comment only after whitespace — `PASS=a#b` keeps its hash.
    const ch = stream.peek();
    if (ch === '#' && /\s/.test(stream.string.charAt(stream.pos - 1))) {
      stream.skipToEnd();
      return 'comment';
    }
    if (ch === '"' || ch === "'") {
      stream.next();
      if (!readQuoted(stream, ch)) state.quote = ch;
      return 'string';
    }
    if (stream.match(/^\$\{[^}]*\}?/)) return 'variableName';
    while (!stream.eol()) {
      const next = stream.peek()!;
      if (/\s/.test(next)) break;
      if (next === '$' && stream.string.charAt(stream.pos + 1) === '{') break;
      stream.next();
    }
    return 'string';
  },
};
