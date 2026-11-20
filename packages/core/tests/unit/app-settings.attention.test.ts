import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '@throng/core';

// 057 T003 — the attention settings (data-model.md § Settings); how marks are announced is notifications.attention (FR-111).
describe('AppSettings attention settings (057)', () => {
  it('ships the documented defaults', () => {
    const a = DEFAULT_APP_SETTINGS.attention;
    expect(a).toEqual({ clearDelayMs: 1000, taskbarBadge: true });

    const t = DEFAULT_APP_SETTINGS.terminals.attention;
    expect(t.enabled).toBe(true);
    expect(t.signals).toEqual({
      processExited: true,
      commandFinished: true,
      bell: true,
      notification: true,
      progressEnded: true,
      unseenOutput: false,
      outputQuiet: false,
    });
    expect(t.quietMs).toBe(10_000);
  });

  it('drops the unreleased delivery, toast and OS keys it no longer models (FR-111)', () => {
    const s = parseAppSettings({
      attention: { clearDelayMs: 2000, delivery: { attention: 'os' }, osNotifications: false, toasts: {} },
    });
    expect(s.attention).toEqual({ clearDelayMs: 2000, taskbarBadge: true });
  });

  it('fills the defaults when the sections are absent', () => {
    const s = parseAppSettings({ version: 1 });
    expect(s.attention).toEqual(DEFAULT_APP_SETTINGS.attention);
    expect(s.terminals.attention).toEqual(DEFAULT_APP_SETTINGS.terminals.attention);
  });

  it('reads valid values', () => {
    const s = parseAppSettings({
      attention: {
        clearDelayMs: 2500,
        taskbarBadge: false,
      },
      terminals: {
        attention: {
          enabled: false,
          signals: {
            processExited: false,
            commandFinished: false,
            bell: false,
            notification: false,
            progressEnded: false,
            unseenOutput: true,
            outputQuiet: true,
          },
          quietMs: 60_000,
        },
      },
    });
    expect(s.attention).toEqual({ clearDelayMs: 2500, taskbarBadge: false });
    expect(s.terminals.attention.enabled).toBe(false);
    expect(s.terminals.attention.signals.unseenOutput).toBe(true);
    expect(s.terminals.attention.signals.bell).toBe(false);
    expect(s.terminals.attention.quietMs).toBe(60_000);
  });

  it('coerces booleans by typeof, so the string "false" is not read as off', () => {
    const s = parseAppSettings({
      attention: { taskbarBadge: 0 },
      terminals: { attention: { enabled: 'no', signals: { bell: 'false', unseenOutput: 'true' } } },
    });
    expect(s.attention.taskbarBadge).toBe(true);
    expect(s.terminals.attention.enabled).toBe(true);
    expect(s.terminals.attention.signals.bell).toBe(true);
    expect(s.terminals.attention.signals.unseenOutput).toBe(false);
  });

  it('keeps whole numbers, rounding a fraction, and falls back on a non-number', () => {
    expect(parseAppSettings({ attention: { clearDelayMs: 1500.4 } }).attention.clearDelayMs).toBe(1500);
    expect(parseAppSettings({ attention: { clearDelayMs: '900' } }).attention.clearDelayMs).toBe(1000);
    expect(parseAppSettings({ attention: { clearDelayMs: NaN } }).attention.clearDelayMs).toBe(1000);
    const q = (v: unknown) =>
      parseAppSettings({ terminals: { attention: { quietMs: v } } }).terminals.attention.quietMs;
    expect(q(30_000)).toBe(30_000);
    expect(q(30_000.4)).toBe(30_000);
    expect(q('30000')).toBe(10_000);
  });

  it('falls back per field: one key set does not reset the others', () => {
    const s = parseAppSettings({ terminals: { attention: { signals: { bell: false } } } });
    expect(s.terminals.attention.signals.bell).toBe(false);
    expect(s.terminals.attention.signals.processExited).toBe(true);
    expect(s.terminals.attention.enabled).toBe(true);
    expect(s.terminals.attention.quietMs).toBe(10_000);
  });

  it('survives a defaults clone, and the clone shares nothing with the defaults', () => {
    const s = parseAppSettings(undefined);
    expect(s.attention).toEqual(DEFAULT_APP_SETTINGS.attention);
    expect(s.terminals.attention).toEqual(DEFAULT_APP_SETTINGS.terminals.attention);
    expect(s.attention).not.toBe(DEFAULT_APP_SETTINGS.attention);
    expect(s.terminals.attention.signals).not.toBe(DEFAULT_APP_SETTINGS.terminals.attention.signals);
  });

  it('survives the clone taken when the terminals section is malformed', () => {
    const s = parseAppSettings({ terminals: 'nope' });
    expect(s.terminals.attention).toEqual(DEFAULT_APP_SETTINGS.terminals.attention);
    expect(s.terminals.attention.signals).not.toBe(DEFAULT_APP_SETTINGS.terminals.attention.signals);
  });
});

// 076 FR-025 — Terminal notifications by default: the value a terminal panel holding none resolves to.
describe('terminals.defaultNotifications (076)', () => {
  it('ships on: no terminal is silenced until the user asks', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.defaultNotifications).toBe(true);
  });

  it('reads a boolean, and keeps the fallback for anything else', () => {
    const read = (v: unknown) => parseAppSettings({ terminals: { defaultNotifications: v } }).terminals.defaultNotifications;
    expect(read(true)).toBe(true);
    expect(read(false)).toBe(false);
    expect(read('false')).toBe(true);
    expect(read(0)).toBe(true);
  });
});
