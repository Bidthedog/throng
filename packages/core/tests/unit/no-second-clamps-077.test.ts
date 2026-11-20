/**
 * 077 FR-016 (SC-004) — a value within a setting's bounds reaches the code that uses it unchanged: the bounds guard,
 * driven by the descriptor, is the one clamp. A parser that narrowed or replaced a value as well disagreed with the
 * descriptor (the #227 class): the explorer popover delay clamped twice, and the notification parse threw an
 * out-of-range value away for the default where the guard would have kept the nearer bound.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  parseNotificationSettings,
  parseSettingsGuarded,
  SETTINGS_METADATA,
} from '../../src/index.js';

const declared = (key: string) => SETTINGS_METADATA.find((d) => d.key === key)!;

describe('no second clamp (077 FR-016)', () => {
  it('the explorer popover delay: the parser keeps it, the guard bounds it', () => {
    expect(parseAppSettings({ explorer: { popoverDelayMs: 4000 } }).explorer.popoverDelayMs).toBe(4000);
    const d = declared('explorer.popoverDelayMs');
    expect(parseSettingsGuarded({ explorer: { popoverDelayMs: 4000 } }).value.explorer.popoverDelayMs).toBe(d.hardMax ?? d.max);
    expect(parseSettingsGuarded({ explorer: { popoverDelayMs: -5 } }).value.explorer.popoverDelayMs).toBe(0);
  });

  it('the notification numbers: the parser keeps an out-of-range value, the guard moves it to the nearer bound', () => {
    const parsed = parseNotificationSettings({ toastDurationMs: 99_999, toastWidthPx: 1, hoverDelayMs: 99_999, panelLimit: 1 });
    expect(parsed.toastDurationMs).toBe(99_999);
    expect(parsed.toastWidthPx).toBe(1);
    expect(parsed.panelLimit).toBe(1);

    const guarded = parseSettingsGuarded({ notifications: { toastDurationMs: 99_999, toastWidthPx: 1, panelLimit: 1 } }).value.notifications;
    expect(guarded.toastDurationMs).toBe(declared('notifications.toastDurationMs').max);
    expect(guarded.toastWidthPx).toBe(declared('notifications.toastWidthPx').min);
    expect(guarded.panelLimit).toBe(declared('notifications.panelLimit').min);
  });

  // 077 FR-014 (constitution 7.3.0, Principle X) — a description quotes no copy of another setting's value or step.
  it('no description copies the capture bands or a slider step', () => {
    for (const d of SETTINGS_METADATA) {
      expect(d.description ?? '', d.key).not.toMatch(/up to 5 minutes allows|\d+ MB steps/);
    }
  });

  it('the notification numbers still fall back for what is no number at all', () => {
    const parsed = parseNotificationSettings({ toastDurationMs: 'long', panelLimit: Number.NaN });
    expect(parsed.toastDurationMs).toBe(DEFAULT_APP_SETTINGS.notifications.toastDurationMs);
    expect(parsed.panelLimit).toBe(DEFAULT_APP_SETTINGS.notifications.panelLimit);
  });
});
