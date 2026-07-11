import { describe, it, expect } from 'vitest';
import { resolvePickerDefaultPath } from '../../src/main/pick-folder.js';

const HOME = 'C:/Users/dev';

describe('resolvePickerDefaultPath (011 US3, FR-043)', () => {
  it('uses a single requested path when it exists as a directory', () => {
    expect(resolvePickerDefaultPath('D:/work', HOME, () => true)).toBe('D:/work');
  });

  it('falls back to home when a single requested path does not resolve', () => {
    expect(resolvePickerDefaultPath('D:/gone', HOME, () => false)).toBe(HOME);
  });

  it('falls back to home for an empty / undefined requested path', () => {
    expect(resolvePickerDefaultPath('', HOME, () => true)).toBe(HOME);
    expect(resolvePickerDefaultPath(undefined, HOME, () => true)).toBe(HOME);
    expect(resolvePickerDefaultPath('   ', HOME, () => true)).toBe(HOME);
  });

  it('cascades a candidate list, using the FIRST that exists as a directory', () => {
    // override gone, last-viewed present -> last-viewed wins (silent cascade).
    expect(
      resolvePickerDefaultPath(['D:/override', 'D:/last', 'C:/Users/dev'], HOME, (p) => p !== 'D:/override'),
    ).toBe('D:/last');
    // override present -> it wins even though later candidates also exist.
    expect(
      resolvePickerDefaultPath(['D:/override', 'D:/last'], HOME, () => true),
    ).toBe('D:/override');
  });

  it('falls back to home when NO candidate in the list resolves', () => {
    expect(resolvePickerDefaultPath(['D:/override', 'D:/last'], HOME, () => false)).toBe(HOME);
  });

  it('skips blank entries in a list and falls back to home for an empty list', () => {
    expect(resolvePickerDefaultPath(['', '   ', 'D:/last'], HOME, () => true)).toBe('D:/last');
    expect(resolvePickerDefaultPath([], HOME, () => true)).toBe(HOME);
  });
});
