/**
 * 041 FR-007/FR-007aa/FR-007e — WHAT MAKES TWO REPORTS THE SAME CASUALTY.
 *
 * 030 keyed a notice's list on `panelId`, which was complete right up until 041 FR-013 stopped
 * creating a panel for a refused open. A casualty with no panel has no key, so "at most one row per
 * casualty" (FR-007) stops being merely unimplemented and becomes UNSTATEABLE — which is why #328
 * cannot be fixed without first fixing #327's model, and why this file exists before either.
 *
 * ══ THE PANEL SUPERSEDES THE PAIR — IT DOES NOT JOIN IT (FR-007aa) ══
 *
 * "The subject it failed on and the reason, PLUS the panel where there is one" reads as a triple and
 * is not one. A notice consolidates ONE cause or ONE operation (030 FR-035/FR-036), and within one of
 * those a given panel fails once — so `reason` can never separate two rows that share a panel, and
 * folding it into the key would undo 030 FR-037a ("a panel appears once, however many times its
 * failure is reported").
 *
 * The case that looks like a counter-example — the same panel defeated by a DIFFERENT cause — is
 * settled one level up: that is a different NOTICE (FR-006, US2 scenario 4), decided by `groupKey`,
 * never a second row in this one. Row identity is only ever asked INSIDE a notice, where the cause is
 * already fixed. Both halves are asserted below, because a key that quietly folded `reason` in would
 * pass every other test in this suite.
 *
 * ══ WHY THE SEPARATOR IS A NUL ══
 *
 * A subject is a path and a reason is a word, so any PRINTABLE separator is a character one of them
 * may legitimately contain — and then `('a b', 'c')` and `('a', 'b c')` produce the same key and two
 * unrelated failures silently become one row. A NUL cannot appear in either, so it cannot collide.
 * It is built with `String.fromCharCode(0)` rather than written as a literal byte: a raw NUL in a
 * source file makes git classify that file as BINARY, which removes every subsequent change to it
 * from diffs and from ripgrep while the code goes on working.
 */
import { describe, expect, it } from 'vitest';
import { casualtyKey } from '../../../src/notice/index.js';

const NUL = String.fromCharCode(0);

describe('casualtyKey', () => {
  it('uses the panel where there is one', () => {
    expect(casualtyKey({ panelId: 'p1', panelName: 'Alpha', tabId: 't1', tabName: 'Tab', tabOrder: 0, panelOrder: 0 })).toBe('p1');
  });

  it('ignores the reason when there is a panel, so one panel is one row (FR-007aa)', () => {
    // The whole point of the fallback rather than a composite. A panel that reported `too-large` and
    // then `binary` inside ONE notice is still one casualty — a different cause is a different
    // NOTICE, and this key is only ever asked within one.
    const base = { panelId: 'p1', panelName: 'Alpha', tabId: 't1', tabName: 'Tab', tabOrder: 0, panelOrder: 0 };
    expect(casualtyKey({ ...base, subject: 'a.txt', reason: 'too-large' })).toBe(
      casualtyKey({ ...base, subject: 'b.txt', reason: 'binary' }),
    );
  });

  it('falls back to the subject and the reason when there is no panel', () => {
    expect(casualtyKey({ subject: 'big.bin', reason: 'too-large' })).toBe(`big.bin${NUL}too-large`);
  });

  it('separates two panel-less casualties that differ only in reason', () => {
    // The file grew past the limit between two attempts, say. Different reason, different casualty.
    expect(casualtyKey({ subject: 'big.bin', reason: 'too-large' })).not.toBe(
      casualtyKey({ subject: 'big.bin', reason: 'binary' }),
    );
  });

  it('separates two panel-less casualties that differ only in subject', () => {
    expect(casualtyKey({ subject: 'a.bin', reason: 'too-large' })).not.toBe(
      casualtyKey({ subject: 'b.bin', reason: 'too-large' }),
    );
  });

  it('cannot be collided by a subject that contains the separator a printable one would use', () => {
    // With a space (or a colon, or a dash) as the separator these two are the same string. They are
    // two unrelated failures, and merging them would drop one from the notice entirely.
    expect(casualtyKey({ subject: 'my file', reason: 'binary' })).not.toBe(
      casualtyKey({ subject: 'my', reason: 'file binary' }),
    );
  });

  it('treats a panelled row and a panel-less row as different casualties', () => {
    // Same file, one open in a panel and one refused before a panel existed. Two casualties: the
    // panelled one is about a panel that is on screen, the other is about an open that never happened.
    const panelled = casualtyKey({ panelId: 'p1', panelName: 'a.txt', tabId: 't1', tabName: 'Tab', tabOrder: 0, panelOrder: 0, subject: 'a.txt', reason: 'io' });
    expect(panelled).not.toBe(casualtyKey({ subject: 'a.txt', reason: 'io' }));
  });
});
