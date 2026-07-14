/**
 * The clipboard mode is decided by the SELECTION, not the command (016, FR-016b).
 *
 * If the command decided, every command would have to remember to declare which shape it produced,
 * and the first one that forgot would silently paste the wrong thing. The selection already knows.
 */
import { describe, expect, it } from 'vitest';
import {
  clipboardModeFor,
  pasteModeFor,
  type ClipboardRecord,
} from '../../src/editor/clipboard-mode.js';

const caret = { empty: true };
const selected = { empty: false };

describe('clipboardModeFor (FR-016b)', () => {
  it('calls a rectangular selection rectangular, whatever its cursors look like', () => {
    expect(clipboardModeFor({ ranges: [caret, caret], rectangular: true })).toBe('rectangular');
    expect(clipboardModeFor({ ranges: [selected], rectangular: true })).toBe('rectangular');
  });

  it('calls a set of BARE CARETS full-line — nothing is selected, so the line is the unit', () => {
    expect(clipboardModeFor({ ranges: [caret], rectangular: false })).toBe('full-line');
    expect(clipboardModeFor({ ranges: [caret, caret, caret], rectangular: false })).toBe('full-line');
  });

  it('calls an ordinary selection verbatim', () => {
    expect(clipboardModeFor({ ranges: [selected], rectangular: false })).toBe('verbatim');
  });

  it('calls a MIXED set verbatim — a mixed set has no single sensible shape', () => {
    // Some cursors have a selection and some do not. Choosing full-line would swallow lines the
    // user never selected; choosing anything else would drop the carets. Verbatim is the honest
    // answer, and it is what the user gets.
    expect(clipboardModeFor({ ranges: [caret, selected], rectangular: false })).toBe('verbatim');
    expect(clipboardModeFor({ ranges: [selected, caret], rectangular: false })).toBe('verbatim');
  });

  it('calls an empty cursor set verbatim rather than throwing', () => {
    expect(clipboardModeFor({ ranges: [], rectangular: false })).toBe('verbatim');
  });
});

describe('pasteModeFor — the record is validated against the LIVE clipboard (FR-015c)', () => {
  const record: ClipboardRecord = { text: 'line\n', mode: 'full-line' };

  it('honours the record when the clipboard still holds what throng wrote', () => {
    expect(pasteModeFor(record, 'line\n')).toBe('full-line');
  });

  it('falls back to VERBATIM when another application has written to the clipboard since', () => {
    // This is the whole self-correcting mechanism: no polling, no clipboard observer, nothing to
    // miss. throng's record describes text that is no longer on the clipboard, so it does not
    // describe what is about to be pasted — and a full-line paste of someone else's text would
    // insert a line the user never copied.
    expect(pasteModeFor(record, 'something else entirely')).toBe('verbatim');
  });

  it('falls back to verbatim when there is no record at all', () => {
    expect(pasteModeFor(null, 'anything')).toBe('verbatim');
  });

  it('is not fooled by an empty clipboard', () => {
    expect(pasteModeFor(record, '')).toBe('verbatim');
    expect(pasteModeFor({ text: '', mode: 'rectangular' }, '')).toBe('rectangular');
  });
});
