import { describe, expect, it } from 'vitest';
import { appendScrollback } from '@throng/core';

const ESC = '';
const BEL = '';

/**
 * 028 (#162) — the daemon keeps a bounded tail of session output and replays it into a view that
 * (re)attaches. A tab switch unmounts every panel, so this replay is what a returning tab is BUILT
 * from: it runs on every switch, not just after a crash.
 *
 * The shipped implementation was `(tail + chunk).slice(-MAX)` — a cut at an arbitrary byte offset.
 * That can land inside a CSI/OSC sequence, and xterm parses the remainder as content: a CSI cut
 * midway prints its tail as literal text, and an OSC cut before its terminator swallows everything
 * after it as a string payload. Both present exactly as the reported garbling.
 */
describe('appendScrollback', () => {
  it('appends without trimming while under the cap', () => {
    expect(appendScrollback('abc', 'def', 64)).toBe('abcdef');
  });

  it('keeps the newest bytes when the cap is exceeded', () => {
    const out = appendScrollback('', 'line1\nline2\nline3\n', 12);
    expect(out.endsWith('line3\n')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(12);
  });

  it('never begins mid-CSI: a cut inside an escape sequence advances past the next newline', () => {
    // 'aaaa\n' + CSI 12;5H + 'painted\n' + 'last\n' = 25 bytes. A 16-byte window starts inside the
    // CSI, so a naive slice would retain ';5Hpainted…' and xterm would render that as text.
    const chunk = `aaaa\n${ESC}[12;5Hpainted\nlast\n`;
    const out = appendScrollback('', chunk, 16);
    expect(out).toBe('last\n');
    expect(out.includes('5H')).toBe(false);
    expect(out.includes(ESC)).toBe(false);
  });

  it('never begins mid-OSC: an unterminated OSC is not retained at the head', () => {
    // An OSC cut before its terminator is worse than a CSI — xterm swallows everything after it as
    // the string payload, so the rest of the replay renders as nothing at all.
    const chunk = `pad\n${ESC}]0;a long title${BEL}\nkeep\ntail\n`;
    const out = appendScrollback('', chunk, 20);
    expect(out).toBe('keep\ntail\n');
    expect(out.includes(ESC)).toBe(false);
  });

  it('yields empty rather than an arbitrary offset when the retained window holds no newline', () => {
    // One enormous unbroken line: there is no safe place to begin. An incoherent replay is worse
    // than none, because it paints garbage the user then has to clear by hand.
    expect(appendScrollback('', 'x'.repeat(500), 32)).toBe('');
  });

  it('keeps a window that already starts at a line boundary', () => {
    // The byte before the cut is a newline, so the window is safe as it stands. Advancing anyway
    // would discard a whole good line on every append and quietly shrink the replay to nothing.
    expect(appendScrollback('', 'ab\ncd\nef\n', 6)).toBe('cd\nef\n');
  });

  it('is stable when called repeatedly with small chunks', () => {
    let tail = '';
    for (let i = 0; i < 200; i += 1) tail = appendScrollback(tail, `row ${i}\n`, 64);
    expect(tail.length).toBeLessThanOrEqual(64);
    expect(tail.endsWith('row 199\n')).toBe(true);
    expect(tail.startsWith('row ')).toBe(true); // never a fragment of a previous row
  });
});
