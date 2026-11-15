import { describe, expect, it } from 'vitest';
import {
  isLinuxHost,
  isMacosHost,
  isWindowsHost,
  skipUnlessLinux,
  skipOnMacos,
  skipOnWindows,
  skipUnlessMacos,
  skipUnlessWindows,
} from '../../src/testing/platform-guards.js';

describe('platform guards (062 FR-042, 070 FR-038)', () => {
  it('refuse a skip with no stated reason', () => {
    expect(() => skipUnlessWindows('  ')).toThrow(/reason/);
    expect(() => skipUnlessLinux('')).toThrow(/reason/);
    expect(() => skipUnlessMacos(' ')).toThrow(/reason/);
    expect(() => skipOnMacos('')).toThrow(/reason/);
    expect(() => skipOnWindows('')).toThrow(/reason/);
  });

  it('skip off their own platform, and only there', () => {
    expect(skipUnlessWindows('r')).toBe(!isWindowsHost());
    expect(skipUnlessLinux('r')).toBe(!isLinuxHost());
    expect(skipUnlessMacos('r')).toBe(!isMacosHost());
    expect(skipOnMacos('r')).toBe(isMacosHost());
    expect(skipOnWindows('r')).toBe(isWindowsHost());
  });

  it('name exactly one host as this one', () => {
    expect([isWindowsHost(), isLinuxHost(), isMacosHost()].filter(Boolean)).toHaveLength(1);
    expect(isMacosHost()).toBe(process.platform === 'darwin');
  });
});
