// 028 follow-up E2E fixture — a kitty program that CHURNS the alternate screen, as Claude Code does
// every time it opens or closes a view.
//
// The distinction from kitty-alt-echo.mjs is the whole point. That one negotiates once and stays
// put, which is a state throng handles. This one leaves the alternate screen and comes back WITHOUT
// re-announcing its keyboard flags — exactly what a program that negotiated at startup does, because
// from its side nothing has changed. A terminal that treats each screen switch as "a new program"
// therefore throws away a negotiation that is still in force, and the program's keys silently revert
// to their legacy encodings until it happens to say something again.
//
// Measured in a user's session as the kitty flag flipping between consecutive keystrokes, so Escape
// was sometimes `CSI 27 u` and sometimes the ambiguous bare byte.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'cap.bin');
writeFileSync(OUT, '');

process.stdout.write('\x1b[?1049h'); // take the alternate screen
process.stdout.write('\x1b[>1u'); // negotiate the kitty keyboard protocol, ONCE
process.stdout.write('\x1b[H\x1b[2JKITTY_TOGGLE_READY');

try {
  process.stdin.setRawMode(true);
} catch {
  /* not a TTY */
}
process.stdin.resume();
process.stdin.on('data', (b) => {
  appendFileSync(OUT, b);
  // `T` churns the screen: out of the alternate buffer and straight back in, with no renegotiation.
  if (b.includes(0x54)) {
    process.stdout.write('\x1b[?1049l');
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[H\x1b[2JKITTY_TOGGLE_READY');
  }
});
setInterval(() => {}, 1 << 30);
