/**
 * Track whether a terminal's program owns the ALTERNATE screen, by watching its output (028
 * follow-up).
 *
 * This matters for one decision: whether the daemon's replay tail is worth anything. A full-screen
 * program's screen is NOT in that tail — the tail holds the bytes that painted it, absolute cursor
 * moves and all, and replaying them into a fresh view paints something that is at best stale and at
 * worst incoherent. It is then immediately overwritten by the program's own redraw.
 *
 * The user sees that as a FLASH. Several, in fact: the tail paints, then the repaint nudge makes the
 * program paint twice more. Removing the one paint that was never going to be correct is the
 * cheapest of those to give back.
 *
 * Only the switch sequences are tracked, and only the last one in a chunk decides — a chunk may
 * enter and leave the alt screen, and what matters is where it ended.
 */

/*
 * These match CONTROL sequences, so they necessarily contain a control character. `no-control-regex`
 * exists to catch one arriving by accident in a pattern about text; here it is the subject.
 */
/** `CSI ? 1049 h` and its two older equivalents — enter the alternate screen. */
// eslint-disable-next-line no-control-regex
const ENTER = /\u001b\[\?(?:1049|1047|47)h/g;
/** `CSI ? 1049 l` and its two older equivalents — leave it. */
// eslint-disable-next-line no-control-regex
const LEAVE = /\u001b\[\?(?:1049|1047|47)l/g;

/**
 * Fold one output chunk into the alt-screen flag.
 *
 * A chunk can contain both an enter and a leave; the LAST switch in the chunk is the one that holds,
 * so the position of each match is compared rather than merely their presence. Getting this wrong
 * would strand the flag on for a program that had already exited full-screen mode, and suppress a
 * replay the user genuinely wanted.
 */
export function trackAltScreen(current: boolean, chunk: string): boolean {
  ENTER.lastIndex = 0;
  LEAVE.lastIndex = 0;
  let lastEnter = -1;
  let lastLeave = -1;
  for (let m = ENTER.exec(chunk); m !== null; m = ENTER.exec(chunk)) lastEnter = m.index;
  for (let m = LEAVE.exec(chunk); m !== null; m = LEAVE.exec(chunk)) lastLeave = m.index;
  if (lastEnter === -1 && lastLeave === -1) return current;
  return lastEnter > lastLeave;
}
