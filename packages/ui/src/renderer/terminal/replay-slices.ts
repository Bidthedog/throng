/**
 * A replay cut into pieces of at most `size` characters (061 R6).
 *
 * xterm yields to the window only between writes: one write is parsed to its end however long it is, so a replay
 * written whole would block the window for all of it (Principle XII). Its parser keeps its state across writes, so a
 * cut may fall anywhere, including inside an escape sequence or a surrogate pair.
 */
export function sliceReplay(replay: string, size: number): string[] {
  const slices: string[] = [];
  for (let at = 0; at < replay.length; at += size) slices.push(replay.slice(at, at + size));
  return slices;
}
