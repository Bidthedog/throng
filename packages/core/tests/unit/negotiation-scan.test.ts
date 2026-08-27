import { describe, expect, it } from 'vitest';
import {
  createNegotiationScan,
  scanKeyboardNegotiation,
} from '../../src/terminal/negotiation-scan.js';
import {
  kittyKeyboardActive,
  win32InputActive,
  applicationReadingInput,
} from '../../src/terminal/kitty-keyboard.js';

/**
 * #290 — reading a program's keyboard negotiation out of the raw output stream.
 *
 * The daemon needs this because the renderer cannot always be listening: a panel in a background
 * tab is unmounted, and a program that un-negotiates while nobody is watching is simply not heard.
 * The daemon reads every byte regardless, so it holds the answer and hands it over on attach.
 *
 * The tests that matter most here are the two the defect was actually made of — order sensitivity,
 * and what happens when the same bytes are applied twice.
 */

const PUSH = '\x1b[>1u'; // CSI > 1 u — push the disambiguate flag
const POP = '\x1b[<u'; // CSI < u — pop it back off
const WIN32_ON = '\x1b[?9001h';
const WIN32_OFF = '\x1b[?9001l';
const PASTE_ON = '\x1b[?2004h';

/** Feed a series of chunks through the scan, as the daemon does. */
const feed = (...chunks: readonly string[]) =>
  chunks.reduce((scan, chunk) => scanKeyboardNegotiation(scan, chunk), createNegotiationScan());

describe('scanKeyboardNegotiation', () => {
  it('sees a program enable enhanced key reporting', () => {
    expect(kittyKeyboardActive(feed(PUSH).state)).toBe(true);
  });

  it('sees it turned back off again', () => {
    expect(kittyKeyboardActive(feed(PUSH, POP).state)).toBe(false);
  });

  it('applies pushes and pops in the order they were emitted, not by last-match-wins', () => {
    // Both chunks contain both sequences; only the ORDER differs, and it decides the answer.
    expect(kittyKeyboardActive(feed(`${PUSH}${POP}`).state)).toBe(false);
    expect(kittyKeyboardActive(feed(`${POP}${PUSH}`).state)).toBe(true);
  });

  it('sees a sequence SPLIT across two chunks — a PTY boundary must not swallow a pop', () => {
    /*
     * The failure this guards is silent and permanent. A missed `1049` self-corrects the next time
     * the program switches screens; a missed POP leaves the protocol enabled until the program
     * negotiates again, which for a program that has just exited is never.
     */
    const armed = feed(PUSH);
    expect(kittyKeyboardActive(armed.state)).toBe(true);

    const half = scanKeyboardNegotiation(armed, '\x1b[<');
    expect(half.pending, 'the incomplete sequence must be carried, not dropped').toBe('\x1b[<');
    expect(kittyKeyboardActive(half.state), 'a half-read sequence must not be acted on yet').toBe(
      true,
    );

    expect(kittyKeyboardActive(scanKeyboardNegotiation(half, 'u').state)).toBe(false);
  });

  it('splits at every offset of a push/pop pair and still ends up off', () => {
    const stream = `${PUSH}${POP}`;
    for (let cut = 0; cut <= stream.length; cut++) {
      const scan = feed(stream.slice(0, cut), stream.slice(cut));
      expect(kittyKeyboardActive(scan.state), `split after ${String(cut)} byte(s)`).toBe(false);
    }
  });

  it('carries nothing when a chunk ends on a complete sequence', () => {
    expect(feed(PUSH).pending).toBe('');
  });

  it('drops an unterminated run too long to be a CSI parameter list', () => {
    // Otherwise a stream containing a bare ESC would accumulate forever.
    expect(feed(`\x1b[${'9'.repeat(200)}`).pending).toBe('');
  });

  it('tracks win32-input-mode and bracketed paste, which travel with the same state', () => {
    expect(win32InputActive(feed(WIN32_ON).state)).toBe(true);
    expect(win32InputActive(feed(WIN32_ON, WIN32_OFF).state)).toBe(false);
    expect(applicationReadingInput(feed(PASTE_ON).state)).toBe(true);
  });

  it('ignores sequences that are not a keyboard negotiation', () => {
    // Alt-screen, a clear, a colour — none of these say anything about the keyboard, and stepping
    // over them wrongly is how a scan starts inventing state.
    const scan = feed(`\x1b[?1049h${PUSH}\x1b[2J\x1b[31m`);
    expect(kittyKeyboardActive(scan.state)).toBe(true);
    expect(win32InputActive(scan.state)).toBe(false);
  });

  it('requires the ESC — the same bytes as plain text negotiate nothing', () => {
    /*
     * The introducer is a control character, so it can only be written as an escape in source, and
     * an editing accident that drops it leaves a regex which still compiles and still matches — just
     * against ordinary output. A program printing the literal text `[>1u` would then silently switch
     * enhanced key reporting on for the whole session.
     */
    expect(kittyKeyboardActive(feed('[>1u').state)).toBe(false);
    expect(win32InputActive(feed('[?9001h').state)).toBe(false);
  });

  it('treats a `CSI ? u` support query as evidence of nothing', () => {
    // The program is ASKING. Only the view answers it, and the answer is not a negotiation.
    expect(kittyKeyboardActive(feed('\x1b[?u').state)).toBe(false);
    expect(kittyKeyboardActive(feed(PUSH, '\x1b[?u').state)).toBe(true);
  });

  it('THE DEFECT: applying one tail twice leaves the protocol stuck on (#290)', () => {
    /*
     * This is the whole reason the daemon is now the authority, expressed at the layer where it can
     * be seen. A rebuilt view used to start from the state its panel store had saved AND then parse
     * the replayed scrollback tail — which still contains the sequences that produced that state.
     *
     * The protocol is a stack, so the second push is not a no-op: it buries the first. The program's
     * single pop then only cancels the duplicate, and enhanced key reporting stays on after the
     * program has said it wants no such thing. Downstream that is `programOwnsKeyboard` stuck true,
     * the scrollback chords surrendered, and Ctrl+Home no longer scrolling.
     */
    // What the renderer's panel store held: the push was seen live, the pop never was, because by
    // then the panel had been unmounted and no view existed to parse it.
    const storeHeld = feed(PUSH);
    expect(kittyKeyboardActive(storeHeld.state), 'the store is mid-sequence, by construction').toBe(
      true,
    );

    // The daemon's tail, which spans the whole program: both the push AND the pop it never delivered.
    const tail = `${PUSH}${POP}`;

    // Read on its own, the tail says exactly the right thing — which is why this was so easy to miss.
    expect(kittyKeyboardActive(feed(tail).state), 'the tail alone is honest').toBe(false);

    // Applied ON TOP of the restored state, it is not. The replayed push buries the restored one, so
    // the program's single pop cancels only the duplicate and the protocol survives its own exit.
    const restoredThenReplayed = scanKeyboardNegotiation(storeHeld, tail);
    expect(
      kittyKeyboardActive(restoredThenReplayed.state),
      'restore + replay leaves enhanced key reporting on after the program turned it off (#290)',
    ).toBe(true);
  });
});
