// #90 E2E fixture — plays the part of a program that supports the kitty keyboard protocol.
// On startup it enables the protocol (CSI > 1 u), then records its RAW stdin bytes to `cap.bin`
// in its working directory (the project root the terminal launched in — unique per test), so the
// spec can read, exactly, what throng transmitted for each keystroke. Recording to a file (rather
// than echoing) sidesteps both xterm's DOM-text quirks and any re-parsing of control bytes.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'cap.bin');
writeFileSync(OUT, ''); // truncate any prior run
process.stdout.write('\x1b[>1u'); // enable kitty keyboard protocol (this is "what Claude does")
process.stdout.write('KITTY_ECHO_READY\r\n');
try {
  process.stdin.setRawMode(true); // raw: bytes arrive immediately, unbuffered by the line discipline
} catch {
  /* not a TTY */
}
process.stdin.resume();
process.stdin.on('data', (b) => appendFileSync(OUT, b));
setInterval(() => {}, 1 << 30); // stay alive
