import { describe, expect, it } from 'vitest';
import { isLinuxHost, isWindowsHost, skipUnlessLinux, skipUnlessWindows } from '../../src/testing/platform-guards.js';

describe('platform guards (062 FR-042)', () => {
  it('refuse a skip with no stated reason', () => {
    expect(() => skipUnlessWindows('  ')).toThrow(/reason/);
    expect(() => skipUnlessLinux('')).toThrow(/reason/);
  });

  it('skip off their own platform, and only there', () => {
    expect(skipUnlessWindows('r')).toBe(!isWindowsHost());
    expect(skipUnlessLinux('r')).toBe(!isLinuxHost());
  });
});
