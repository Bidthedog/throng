import { describe, expect, it } from 'vitest';
import { trackAltScreen } from '@throng/core';

const ESC = String.fromCharCode(27);
const enter = `${ESC}[?1049h`;
const leave = `${ESC}[?1049l`;

/**
 * 028 follow-up — the daemon withholds the replay tail while a full-screen program owns the screen,
 * because that program's screen is not IN the tail: the tail holds the bytes that painted it, and
 * replaying them paints something stale that the program's own redraw immediately overwrites. The
 * user counts that wasted paint as a flash on every tab switch.
 *
 * Getting this flag wrong is not neutral in either direction. Stuck on, and a shell's real
 * scrollback silently stops coming back. Stuck off, and the flash returns.
 */
describe('trackAltScreen', () => {
  it('starts from the current value when a chunk says nothing about the screen', () => {
    expect(trackAltScreen(false, 'ordinary output\n')).toBe(false);
    expect(trackAltScreen(true, 'ordinary output\n')).toBe(true);
  });

  it('turns on when a program enters the alternate screen', () => {
    expect(trackAltScreen(false, `hello${enter}painting`)).toBe(true);
  });

  it('turns off when it leaves', () => {
    expect(trackAltScreen(true, `${leave}back at the prompt`)).toBe(false);
  });

  it('honours the LAST switch in a chunk, not merely the presence of one', () => {
    // A chunk that enters and then leaves ends on the normal buffer — and vice versa. Checking only
    // for presence would strand the flag on for a program that had already exited full-screen mode,
    // and suppress a replay the user genuinely wanted.
    expect(trackAltScreen(false, `${enter}drawing${leave}done`)).toBe(false);
    expect(trackAltScreen(true, `${leave}done${enter}drawing again`)).toBe(true);
  });

  it('recognises the older 47 and 1047 sequences too', () => {
    expect(trackAltScreen(false, `${ESC}[?47h`)).toBe(true);
    expect(trackAltScreen(true, `${ESC}[?47l`)).toBe(false);
    expect(trackAltScreen(false, `${ESC}[?1047h`)).toBe(true);
    expect(trackAltScreen(true, `${ESC}[?1047l`)).toBe(false);
  });

  it('is not fooled by the digits appearing in ordinary text', () => {
    expect(trackAltScreen(false, 'exit code 1049h was returned')).toBe(false);
  });

  it('is stable across repeated chunks', () => {
    let alt = false;
    for (const chunk of ['a', enter, 'b', 'c', leave, 'd']) alt = trackAltScreen(alt, chunk);
    expect(alt).toBe(false);
  });
});

/**
 * 028 follow-up — a keyboard negotiation belongs to the program that made it.
 *
 * cmd and PSReadLine enable win32-input-mode to read their prompt. If that belief survives into the
 * full-screen program the user then launches, throng re-encodes keys into records that program never
 * asked for and cannot act on — reported as Shift+Enter and Ctrl+Backspace doing nothing in Claude
 * while the keys throng passes through untouched kept working.
 *
 * The renderer resets the negotiation when a program takes the alternate screen. These pin the rule
 * the reset depends on: which sequences mean "a new program is taking the screen".
 */
describe('alternate-screen entry as a program boundary', () => {
  const ESC2 = String.fromCharCode(27);

  it('recognises every form of taking the screen', () => {
    for (const seq of [`${ESC2}[?1049h`, `${ESC2}[?1047h`, `${ESC2}[?47h`]) {
      expect(trackAltScreen(false, seq)).toBe(true);
    }
  });

  it('does not treat LEAVING the screen as a new program taking it', () => {
    // Handing the screen back to the shell restores a program that already negotiated for itself;
    // resetting there would discard a live negotiation rather than a stale one.
    for (const seq of [`${ESC2}[?1049l`, `${ESC2}[?1047l`, `${ESC2}[?47l`]) {
      expect(trackAltScreen(true, seq)).toBe(false);
    }
  });
});
