/**
 * The dev instance's DevTools toggle (028 follow-up): F12, or the platform's primary modifier + Shift + I — Cmd on
 * macOS (070 research R21), Ctrl elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { isDevToolsToggle } from '../../src/main/devtools-toggle.js';

const input = (key: string, mods: { control?: boolean; meta?: boolean; shift?: boolean } = {}) => ({
  type: 'keyDown',
  key,
  control: false,
  meta: false,
  shift: false,
  ...mods,
});

describe('isDevToolsToggle', () => {
  it('is F12 or Ctrl+Shift+I on Windows and Linux, never Cmd', () => {
    for (const os of ['windows', 'linux'] as const) {
      expect(isDevToolsToggle(input('F12'), os)).toBe(true);
      expect(isDevToolsToggle(input('I', { control: true, shift: true }), os)).toBe(true);
      expect(isDevToolsToggle(input('i', { control: true, shift: true }), os)).toBe(true);
      expect(isDevToolsToggle(input('I', { meta: true, shift: true }), os)).toBe(false);
    }
  });

  it('is F12 or Cmd+Shift+I on macOS, and Ctrl+Shift+I is left alone', () => {
    expect(isDevToolsToggle(input('F12'), 'macos')).toBe(true);
    expect(isDevToolsToggle(input('I', { meta: true, shift: true }), 'macos')).toBe(true);
    expect(isDevToolsToggle(input('I', { control: true, shift: true }), 'macos')).toBe(false);
  });

  it('fires on the key going down only', () => {
    expect(isDevToolsToggle({ ...input('F12'), type: 'keyUp' }, 'windows')).toBe(false);
  });
});
