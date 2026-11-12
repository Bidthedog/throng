import { describe, expect, it, vi } from 'vitest';
import { join, sep } from 'node:path';
import { startOsDrag } from '../../src/main/os-drag.js';

const ROOT = join(sep, 'work', 'beta');

describe('startOsDrag (067 FR-005)', () => {
  it('starts one drag carrying every file', () => {
    const start = vi.fn();
    expect(startOsDrag(['a.txt', 'dir/b'], ROOT, start)).toBe(true);
    expect(start).toHaveBeenCalledWith([join(ROOT, 'a.txt'), join(ROOT, 'dir/b')]);
  });
  it('starts nothing for a path escaping the root', () => {
    const start = vi.fn();
    expect(startOsDrag(['../secret'], ROOT, start)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
  it('starts nothing for the root row or with no project', () => {
    const start = vi.fn();
    expect(startOsDrag([''], ROOT, start)).toBe(false);
    expect(startOsDrag(['a.txt'], null, start)).toBe(false);
    expect(startOsDrag([], ROOT, start)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});
