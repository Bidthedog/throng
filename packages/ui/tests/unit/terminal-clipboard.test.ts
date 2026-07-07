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
});
