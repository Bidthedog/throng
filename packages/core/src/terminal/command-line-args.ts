/**
 * A Windows command line split into its arguments by the CommandLineToArgvW rules (068 FR-043).
 *
 * The OS reports a process's command line as one string; the program's own argv is what the C
 * runtime makes of it. Whitespace separates arguments outside quotes; a quote toggles quoting and
 * is dropped; 2n backslashes before a quote give n backslashes and the quote toggles; 2n+1 give n
 * backslashes and a literal quote; backslashes anywhere else are literal. A quoted empty argument
 * (`""`) is kept as an empty string.
 */
export function splitWindowsCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i] as string;
    if (ch === '\\') {
      let run = 0;
      while (line[i] === '\\') {
        run += 1;
        i += 1;
      }
      started = true;
      if (line[i] === '"') {
        current += '\\'.repeat(Math.floor(run / 2));
        if (run % 2 === 1) {
          current += '"';
          i += 1;
        }
      } else {
        current += '\\'.repeat(run);
      }
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      started = true;
      i += 1;
      continue;
    }
    if (!quoted && (ch === ' ' || ch === '\t')) {
      if (started) args.push(current);
      current = '';
      started = false;
      i += 1;
      continue;
    }
    current += ch;
    started = true;
    i += 1;
  }
  if (started) args.push(current);
  return args;
}
