// 028 follow-up E2E fixture — a full-screen program that does NOT negotiate anything.
//
// This is the case that matters, and the one the kitty variant hides. throng advertises no kitty
// flags, so a program that QUERIES support may reasonably conclude the terminal has none and enable
// nothing. Then the only thing telling throng that the program owns the keyboard is the ALTERNATE
// SCREEN — and a rebuilt view cannot see that, because the replay carrying the switch sequence is
// deliberately suppressed. So the view believes it is on the normal buffer, reclaims Ctrl+End for
// scrollback, and the chord dies after the first tab switch.
//
// The combination is the point. kitty-echo.mjs stays on the normal screen, where a rebuilt view
// re-learns the negotiation from the replayed scrollback tail. A program on the ALTERNATE screen
// gets no replay (it would be a visible flash of stale content), so its negotiation is the thing
// that must survive a rebuild by some other means.
//
// ══ THIS FILE DID NOT DO WHAT THE EIGHT LINES ABOVE SAY, FOR AS LONG AS IT HAS EXISTED ══
//
// It carried a kitty negotiation — the same one kitty-alt-echo.mjs uses — eight lines below a header
// promising it negotiated nothing. `diff alt-echo.mjs kitty-alt-echo.mjs` reported `1,8c1,2`: the
// two fixtures were byte-identical apart from their comments. So the "negotiated nothing" case that
// this fixture exists to create was never once exercised, and the test standing on it passed by
// testing the kitty path twice (issue #214).
//
// The negotiation is gone. What remains is the alternate screen and nothing else, which is exactly
// the signal the rebuild is supposed to lose. `e2e-fixture-distinctness.test.ts` now fails the build
// if two fixtures converge like this again — a comment is not a behaviour, and the only thing that
// had ever distinguished these two was a comment.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'cap.bin');
writeFileSync(OUT, '');
process.stdout.write('\x1b[?1049h'); // own the alternate screen, as a full-screen program does
process.stdout.write('\x1b[H\x1b[2JALT_READY');
process.stdout.on('resize', () => {
  process.stdout.write('\x1b[H\x1b[2JALT_READY');
});
try {
  process.stdin.setRawMode(true);
} catch {
  /* not a TTY */
}
process.stdin.resume();
process.stdin.on('data', (b) => appendFileSync(OUT, b));
setInterval(() => {}, 1 << 30);
