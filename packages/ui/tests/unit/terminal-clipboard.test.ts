import { describe, it, expect } from 'vitest';
import { parseOsc52 } from '../../src/renderer/terminal/osc52.js';

// A TUI (Claude Code, tmux, vim, …) running inside the terminal copies to the system
// clipboard by emitting an OSC 52 sequence: ESC ] 52 ; Pc ; <base64> ST. xterm.js's
// OSC handler receives the payload AFTER "52;" — i.e. "Pc;Pd" (selection ; data).
// parseOsc52 decodes that into the clipboard text, or null when there is nothing to
// write (a read/query, or malformed input). Pure (no xterm/DOM) so it is unit-testable.

describe('parseOsc52 (OSC 52 clipboard-write decoding)', () => {
  it('decodes a base64 clipboard write for the "c" (clipboard) selection', () => {
    expect(parseOsc52('c;aGVsbG8gd29ybGQ=')).toBe('hello world');
  });

  it('decodes multi-byte UTF-8 payloads correctly', () => {
    expect(parseOsc52('c;Y2Fmw6kg4piV')).toBe('café ☕');
  });

  it('preserves newlines in the copied text', () => {
    expect(parseOsc52('c;bGluZTEKbGluZTI=')).toBe('line1\nline2');
  });

  it('accepts an empty selection field (Pc omitted)', () => {
    expect(parseOsc52(';aGVsbG8gd29ybGQ=')).toBe('hello world');
  });

  it('accepts combined selections (e.g. "cp")', () => {
    expect(parseOsc52('cp;aGVsbG8gd29ybGQ=')).toBe('hello world');
  });

  it('returns null for a clipboard READ/query ("?"), never leaking the clipboard', () => {
    expect(parseOsc52('c;?')).toBeNull();
  });

  it('returns null for an empty payload (nothing to copy — do not wipe the clipboard)', () => {
    expect(parseOsc52('c;')).toBeNull();
  });

  it('returns null when the selector/data separator is missing', () => {
    expect(parseOsc52('aGVsbG8=')).toBeNull();
  });

  it('returns null (never throws) for malformed base64', () => {
    expect(parseOsc52('c;not*valid*base64')).toBeNull();
  });

  /*
   * #354 — the fact the RDP hypothesis rests on, pinned so a change to it is deliberate.
   *
   * A TUI's OSC 52 payload is LF-only, and this decodes it verbatim: no normalisation to CRLF, on
   * either half of the path. `ElectronClipboard.writeText` does not normalise either — the clipboard
   * contract requires it not to, in as many words ("LINE ENDINGS SURVIVE VERBATIM. Not normalised,
   * not 'helpfully' converted", core/src/testing/clipboard-contract.ts), with cases for CRLF, LF and
   * mixed. So LF-only text emitted by a program inside the terminal reaches the Windows clipboard as
   * LF-only.
   *
   * That is the candidate mechanism for #354's first symptom: text copied out of a terminal panel
   * does not paste into an RDP session, while a round-trip through Notepad — which yields CRLF —
   * makes it available immediately. NOT CONFIRMED: reproducing it needs an RDP session, and nobody
   * has yet shown that the line endings are what rdpclip objects to.
   *
   * The point of this test is what it costs to change. If someone later normalises OSC 52 text to
   * CRLF to fix that symptom, this fails and sends them to the contract above, which says the
   * opposite for the editor's copy path. Whether an OSC 52 write is exempt from that rule is a
   * scoping decision, and this is the tripwire that forces it to be made rather than assumed.
   */
  it('decodes LF line endings verbatim, without normalising them to CRLF (#354)', () => {
    // base64('one\ntwo\n') — a two-line LF-only payload, as a TUI emits it.
    expect(parseOsc52('c;b25lCnR3bwo=')).toBe('one\ntwo\n');
  });
});
