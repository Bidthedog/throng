/**
 * Drive a hand-written StreamParser (055 FR-016) over source lines, the way StreamLanguage does,
 * and return what it produced: one `[text, style]` pair per token, whitespace-only tokens dropped.
 *
 * Not a test file — the shared harness for `grammars/*.test.ts`.
 */
import { StringStream, type StreamParser } from '@codemirror/language';

export type Token = readonly [text: string, style: string | null];

export function tokenize<S>(parser: StreamParser<S>, source: string): Token[][] {
  const state = parser.startState ? parser.startState(2) : ({} as S);
  return source.split('\n').map((line) => {
    const out: Token[] = [];
    if (line.length === 0) {
      parser.blankLine?.(state, 2);
      return out;
    }
    const stream = new StringStream(line, 4, 2);
    while (!stream.eol()) {
      const style = parser.token(stream, state);
      const text = stream.current();
      if (stream.pos === stream.start) throw new Error(`parser made no progress at ${stream.pos} in ${JSON.stringify(line)}`);
      if (text.trim().length > 0) out.push([text, style ?? null]);
      stream.start = stream.pos;
    }
    return out;
  });
}

/** The style the parser gave the first token whose text is `text`, on any line. */
export function styleOf(lines: Token[][], text: string): string | null | undefined {
  for (const line of lines) {
    const hit = line.find(([t]) => t === text);
    if (hit) return hit[1];
  }
  return undefined;
}
