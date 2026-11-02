/**
 * MOVED DOWN from `component/content-menu-encoding.test.ts` (pass 2): the three menu builders render
 * nothing — they return `MenuAction[]` (059 FR-055, FR-057, FR-061).
 */
import { describe, expect, it } from 'vitest';
import { ENCODING_CHOICES } from '@throng/core';
import {
  encodingMenuItems,
  insertLineBreakItems,
  lineEndingMenuItems,
} from '../../src/renderer/editor/content-menu.js';

const ENCODING_ROWS = [
  // FR-070: the Unicode rows, the Windows Code Pages submenu, Reopen.
  ...ENCODING_CHOICES.filter((c) => c.group === 'unicode').map((c) => `menu-item-encoding-${c.encoding}${c.hasBom ? '-bom' : ''}`),
  'menu-item-encoding-codepages',
  'menu-item-Reopen with Encoding…',
];
const LINE_ENDING_ROWS = [
  'menu-item-line-ending-lf',
  'menu-item-line-ending-cr',
  'menu-item-line-ending-crlf',
  'menu-item-line-ending-mixed',
  'menu-item-insert-line-break-lf',
  'menu-item-insert-line-break-cr',
  'menu-item-insert-line-break-crlf',
];

describe('the builders (059 FR-055, FR-057, FR-061)', () => {
  it('every row declares the viewState section', () => {
    const items = [
      ...encodingMenuItems({
        current: { encoding: 'utf8', hasBom: false },
        canReopen: true,
        change: () => {},
        openReopenPicker: () => {},
      }),
      ...lineEndingMenuItems({ lineEnding: 'lf', mixed: false, convert: () => {} }),
      ...insertLineBreakItems({ insert: () => {} }),
    ];
    expect(items.map((i) => i.testId)).toEqual([...ENCODING_ROWS, ...LINE_ENDING_ROWS]);
    for (const item of items) expect(item.section).toBe('viewState');
  });
});
