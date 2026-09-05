import { test } from '@playwright/test';

/**
 * Hosts that do not deliver throng's RE-ENCODED key bytes into a program.
 *
 * ── What was measured, and why this is a declaration rather than a probe ───────────────────────
 *
 * On the gate runner, with the re-encoded write path fully accounted:
 *
 *   writes  [… "a", "[13;2u", "b", "[13;5u", "c", "\r", "d"]
 *   input   { written: 18, acked: 18, failed: 0 }
 *   capture "abc\rd"
 *
 * throng detects the kitty negotiation, encodes the right sequence, writes it, and the daemon
 * acknowledges it. The program receives the plain characters and the bare CR, and neither CSI-u.
 *
 * It is NOT only CSI-u, which is why the flag is not named for it. The same host loses every
 * byte throng re-encodes and writes on the key path: 0x08 for Ctrl+Backspace and 0x1b for
 * Escape are dropped identically, while the characters xterm itself transmits arrive. The
 * discriminator is WHO wrote the byte, not which byte it is.
 * **Nothing throng does is wrong** — the bytes are lost below the daemon, on that host only.
 *
 * Two probes were written to detect this automatically and BOTH were wrong, which is why this is a
 * declared flag and not an inference:
 *
 *   1. Measuring the OUTWARD path (`CSI > 1 u` leaving a program) — healthy on that host, and the
 *      wrong direction entirely. node-pty-host.ts already says the outward negotiation survives.
 *   2. Measuring the inward path by writing CSI-u straight to a node child over node-pty — this
 *      answers FALSE on a reference machine where the specs pass, because throng writes through a
 *      SHELL whose child is the fixture, and the direct topology behaves differently. Shipping it
 *      would have skipped these specs everywhere: silent coverage loss, which is worse than a red.
 *
 * The OS build is not the discriminator either: reference machine and runner both report
 * **10.0.26200**, so the gate `skipIfConsoleHidesAltScreen` uses for its own capability cannot work
 * here.
 *
 * So the host says so itself. That is honest about what is known — a real difference, cause not yet
 * identified — and it cannot silently disable the specs anywhere that has not opted in.
 */
const DECLARED_ABSENT = 'THRONG_NO_REENCODED_KEY_DELIVERY';

/**
 * Skip where the host has declared it cannot deliver CSI-u sequences into a program.
 *
 * Deliberately narrow: it fires ONLY on an explicit declaration, never on a guess, so a machine
 * that says nothing runs the test and reports honestly.
 */
export function skipIfHostCannotDeliverReencodedKeys(): void {
  test.skip(
    process.env[DECLARED_ABSENT] === '1',
    `${DECLARED_ABSENT}=1: this host has declared that the system ConPTY drops CSI-u key sequences on the way INTO a program. throng encodes and writes them and the daemon acks them — measured — so the distinct sequence this test asserts cannot be observed here. Not a throng defect and not inferred: see the notes in this file and #358`,
  );
}
