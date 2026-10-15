/**
 * Batch grammar (055 FR-015) — Windows `.bat` and `.cmd`. Nothing shipped highlights batch, so it is
 * written here.
 *
 * Keywords match in any case, as cmd.exe does. Every style is a tag `highlight-style.ts` already maps
 * (FR-020); in particular a `^` escape is returned as `string`, because `escape` is not mapped and
 * would render flat.
 */
import type { StreamParser } from '@codemirror/language';

const KEYWORDS = new Set([
  'echo', 'set', 'if', 'else', 'for', 'in', 'do', 'exist', 'not', 'errorlevel', 'defined', 'setlocal',
  'endlocal', 'shift', 'pushd', 'popd', 'exit', 'goto', 'call', 'start', 'cd', 'chdir', 'title', 'pause',
  'cls', 'equ', 'neq', 'lss', 'leq', 'gtr', 'geq', 'enabledelayedexpansion', 'enableextensions',
]);

interface BatchState {
  /** At the start of a command — where `REM`, `::` and a `:label` can begin. */
  commandStart: boolean;
  /** The previous word was `goto` or `call`, so this one names a label. */
  labelNext: boolean;
}

export const batch: StreamParser<BatchState> = {
  name: 'batch',
  startState: () => ({ commandStart: true, labelNext: false }),

  token(stream, state) {
    if (stream.sol()) {
      state.commandStart = true;
      state.labelNext = false;
    }
    if (stream.eatSpace()) return null;

    if (state.commandStart) {
      if (stream.eat('@')) return 'operator';
      if (stream.match(/^rem(?=\s|$)/i) || stream.match('::')) {
        stream.skipToEnd();
        return 'comment';
      }
      if (stream.match(/^:[^\s:]\S*/)) {
        state.commandStart = false;
        return 'labelName';
      }
    }

    if (stream.peek() === '"') {
      stream.next();
      if (stream.skipTo('"')) stream.next();
      else stream.skipToEnd();
      return 'string';
    }
    if (stream.eat('^')) {
      stream.next();
      return 'string';
    }
    if (
      stream.match(/^%%~?[a-z]+/i) ||
      stream.match(/^%~[a-z]*[0-9*]/i) ||
      stream.match(/^%[0-9*]/) ||
      stream.match(/^%[^%\s]+%/) ||
      stream.match(/^![^!\s]+!/)
    ) {
      return 'variableName';
    }
    if (stream.match(/^[0-9]?>>?(?:&[0-9])?/) || stream.match(/^(?:\|\||&&|[|&<])/)) {
      // A pipe or `&&` starts a new command on the same line.
      if (/[|&]$/.test(stream.current())) state.commandStart = true;
      return 'operator';
    }

    if (stream.match(/^[^\s"%!^<>|&@]+/)) {
      const word = stream.current();
      state.commandStart = false;
      if (state.labelNext) {
        state.labelNext = false;
        return 'labelName';
      }
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) {
        state.labelNext = lower === 'goto' || lower === 'call';
        return 'keyword';
      }
      return null;
    }

    stream.next();
    return null;
  },
};
