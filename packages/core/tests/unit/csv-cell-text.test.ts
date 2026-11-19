/**
 * 073 FR-036a — the cell dialog's pure text rules: when a value is JSON, how it opens, how it is flattened on
 * save, and the threshold a reader of the setting applies.
 * Layer: unit — every rule is string arithmetic; the renderer's component test proves only the wiring.
 */
import { describe, expect, it } from 'vitest';
import {
  cellDialogOn,
  cellDialogText,
  flattenCellText,
  isJsonContainer,
  isLongCell,
  longCellThresholdOf,
  wrapCellsOn,
  lockFirstRowOn,
  lockFirstColumnOn,
} from '../../src/csv/cell-text.js';

describe('isJsonContainer', () => {
  it('is true for a whole value that parses as a JSON object or array', () => {
    expect(isJsonContainer('{"a":1}')).toBe(true);
    expect(isJsonContainer(' [1, 2, {"b": null}] ')).toBe(true);
    expect(isJsonContainer('{}')).toBe(true);
  });

  it('is false for scalars, malformed JSON and text that only contains JSON', () => {
    for (const v of ['', '42', '"s"', 'true', 'null', '{"a":', '{a:1}', 'see {"a":1}', '{"a":1} tail', 'plain text']) {
      expect(isJsonContainer(v), v).toBe(false);
    }
  });
});

describe('cellDialogText', () => {
  it('pretty-prints a JSON object or array with a two-space indent', () => {
    expect(cellDialogText('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  });

  it('leaves any other text exactly as it is', () => {
    expect(cellDialogText('line one\nline two')).toBe('line one\nline two');
    expect(cellDialogText('{"a":')).toBe('{"a":');
  });
});

describe('flattenCellText', () => {
  it('turns each line break and the whitespace after it into one space, for JSON', () => {
    expect(flattenCellText('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')).toBe('{ "a": 1, "b": [ 1, 2 ] }');
    expect(flattenCellText('[\r\n\t1,\r\n\t2\r\n]')).toBe('[ 1, 2 ]');
  });

  it('turns each line break of other text into one space and keeps everything else, indentation too', () => {
    expect(flattenCellText('one\ntwo')).toBe('one two');
    expect(flattenCellText('a\r\nb\rc\nd')).toBe('a b c d');
    expect(flattenCellText('  indented\n    more')).toBe('  indented     more');
    expect(flattenCellText('trailing\n')).toBe('trailing ');
  });

  it('is the identity for text with no line break', () => {
    expect(flattenCellText('  as is  ')).toBe('  as is  ');
  });

  it('round-trips a pretty-printed value to its one-line JSON form', () => {
    const flat = flattenCellText(cellDialogText('{"a":1,"b":{"c":2}}'));
    expect(JSON.parse(flat)).toEqual({ a: 1, b: { c: 2 } });
  });
});

describe('cellDialogOn (FR-036b)', () => {
  it('is the panel\'s own choice when it has one, whatever the setting says', () => {
    expect(cellDialogOn(true, false)).toBe(true);
    expect(cellDialogOn(false, true)).toBe(false);
  });

  it('follows the setting for a panel that has not chosen, and ships on when the setting is unreadable', () => {
    expect(cellDialogOn(undefined, true)).toBe(true);
    expect(cellDialogOn(undefined, false)).toBe(false);
    expect(cellDialogOn(undefined, undefined)).toBe(true);
    expect(cellDialogOn('yes', 'no')).toBe(true);
  });
});

describe('the long-cell threshold', () => {
  it('reads the setting as a whole number of at least 1, falling back on the shipped 50', () => {
    expect(longCellThresholdOf(120)).toBe(120);
    expect(longCellThresholdOf(7.6)).toBe(8);
    expect(longCellThresholdOf(0)).toBe(1);
    expect(longCellThresholdOf(-4)).toBe(1);
    expect(longCellThresholdOf('x')).toBe(50);
    expect(longCellThresholdOf(undefined)).toBe(50);
    expect(longCellThresholdOf(Number.NaN)).toBe(50);
  });

  it('calls a value long only when it has MORE characters than the threshold', () => {
    expect(isLongCell('x'.repeat(50), 50)).toBe(false);
    expect(isLongCell('x'.repeat(51), 50)).toBe(true);
  });

  it('calls any value holding a line break long, however short (FR-036c)', () => {
    expect(isLongCell('a\nb', 50)).toBe(true);
    expect(isLongCell('a\r\nb', 50)).toBe(true);
    expect(isLongCell('a\rb', 50)).toBe(true);
    expect(isLongCell('a b', 50)).toBe(false);
  });

  it('leaves a short multi-line value alone when multi-line routing is off (FR-060c)', () => {
    expect(isLongCell('a\nb', 50, false)).toBe(false);
    expect(isLongCell(`${'x'.repeat(50)}\nb`, 50, false)).toBe(true);
  });
});

describe('wrapCellsOn (FR-013)', () => {
  it('follows the setting when the panel has no choice, which ships off', () => {
    expect(wrapCellsOn(undefined, undefined)).toBe(false);
    expect(wrapCellsOn(undefined, true)).toBe(true);
    expect(wrapCellsOn(undefined, false)).toBe(false);
  });

  it('takes the panel choice over the setting, either way', () => {
    expect(wrapCellsOn(true, false)).toBe(true);
    expect(wrapCellsOn(false, true)).toBe(false);
  });

  it('ignores a value that is not a boolean', () => {
    expect(wrapCellsOn('yes', 'no')).toBe(false);
    expect(wrapCellsOn(1, true)).toBe(true);
  });
});

describe('lockFirstRowOn / lockFirstColumnOn (FR-039a)', () => {
  for (const [name, fn] of [
    ['lockFirstRowOn', lockFirstRowOn],
    ['lockFirstColumnOn', lockFirstColumnOn],
  ] as const) {
    it(`${name} follows the setting when the panel has no choice, which ships off`, () => {
      expect(fn(undefined, undefined)).toBe(false);
      expect(fn(undefined, true)).toBe(true);
      expect(fn(undefined, false)).toBe(false);
    });

    it(`${name} takes the panel choice over the setting, either way, and ignores a non-boolean`, () => {
      expect(fn(true, false)).toBe(true);
      expect(fn(false, true)).toBe(false);
      expect(fn('yes', 'no')).toBe(false);
      expect(fn(1, true)).toBe(true);
    });
  }
});
