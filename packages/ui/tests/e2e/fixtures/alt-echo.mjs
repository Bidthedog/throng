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
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'cap.bin');
writeFileSync(OUT, '');
process.stdout.write('\x1b[?1049h'); // own the alternate screen, as a full-screen program does
process.stdout.write('\x1b[>1u'); // enable the kitty keyboard protocol — "what Claude does"
process.stdout.write('\x1b[H\x1b[2JKITTY_ALT_READY');
process.stdout.on('resize', () => {
  process.stdout.write('\x1b[H\x1b[2JKITTY_ALT_READY');
});
try {
  process.stdin.setRawMode(true);
} catch {
  /* not a TTY */
}
process.stdin.resume();
process.stdin.on('data', (b) => appendFileSync(OUT, b));
setInterval(() => {}, 1 << 30);
