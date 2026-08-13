import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTICE_SEVERITIES,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  parseNotificationSettings,
  type DisplayMode,
} from '@throng/core';

/**
 * 030 FR-010 / FR-013 / FR-014 / FR-015 — the display-mode settings, and their TOTAL parse.
 *
 * The whole point of this function is that it cannot fail. A settings file is user-editable, so a
 * typo in `notifications` must resolve per value and leave the rest of the file — and the
 * Preferences window — working. `contracts/notification-settings.md` states that as a truth table,
 * and every row of it is a case below.
 */

const SEVERITIES = ['error', 'warning', 'info', 'success'] as const;

describe('the shipped defaults (FR-013)', () => {
  it('ships error and warning as dismiss-only, info and success timed', () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS).toEqual({
      error: { mode: 'dismiss', timeoutMs: 5000 },
      warning: { mode: 'dismiss', timeoutMs: 5000 },
      info: { mode: 'timed', timeoutMs: 10000 },
      success: { mode: 'timed', timeoutMs: 5000 },
    });
  });

  /*
   * Every severity carries a timeout whatever its mode: switching a severity to "Display for" in
   * Preferences must not present an empty control, and the silenced-notice shadow (FR-005b) expires
   * its entries after the severity's timeoutMs even when nothing is ever displayed.
   */
  it('carries a timeout for every severity, including the ones that do not use it', () => {
    for (const severity of SEVERITIES) {
      const value = DEFAULT_NOTIFICATION_SETTINGS[severity].timeoutMs;
      expect(value).toBeGreaterThanOrEqual(TIMEOUT_MIN_MS);
      expect(value).toBeLessThanOrEqual(TIMEOUT_MAX_MS);
    }
  });

  it('bounds the timeout at 3000–30000', () => {
    expect(TIMEOUT_MIN_MS).toBe(3000);
    expect(TIMEOUT_MAX_MS).toBe(30000);
  });

  it('names the four severities once, so callers iterate rather than re-list them', () => {
    expect([...NOTICE_SEVERITIES]).toEqual([...SEVERITIES]);
  });
});

describe('parseNotificationSettings — the contract truth table', () => {
  it('resolves everything to defaults when the section is absent (FR-014)', () => {
    expect(parseNotificationSettings(undefined)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('resolves everything to defaults for null', () => {
    expect(parseNotificationSettings(null)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it.each([['a string'], [42], [true], [[1, 2, 3]]])(
    'resolves everything to defaults for a non-object (%p)',
    (raw) => {
      expect(parseNotificationSettings(raw)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    },
  );

  it('resolves an absent severity to its own default', () => {
    const parsed = parseNotificationSettings({ error: { mode: 'never', timeoutMs: 4000 } });
    expect(parsed.error).toEqual({ mode: 'never', timeoutMs: 4000 });
    expect(parsed.warning).toEqual(DEFAULT_NOTIFICATION_SETTINGS.warning);
    expect(parsed.info).toEqual(DEFAULT_NOTIFICATION_SETTINGS.info);
    expect(parsed.success).toEqual(DEFAULT_NOTIFICATION_SETTINGS.success);
  });

  it('keeps a mode with no timeout, defaulting only the timeout', () => {
    const parsed = parseNotificationSettings({ error: { mode: 'never' } });
    expect(parsed.error).toEqual({ mode: 'never', timeoutMs: DEFAULT_NOTIFICATION_SETTINGS.error.timeoutMs });
  });

  it('resolves an unrecognised mode to that severity default, honouring a valid timeout', () => {
    const parsed = parseNotificationSettings({ info: { mode: 'sometimes', timeoutMs: 20000 } });
    expect(parsed.info).toEqual({ mode: 'timed', timeoutMs: 20000 });
  });

  it.each([
    ['below the minimum', 2999],
    ['above the maximum', 30001],
    ['negative', -1],
    ['zero', 0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('resolves an out-of-range timeout (%s) to that severity default', (_label, timeoutMs) => {
    const parsed = parseNotificationSettings({ info: { mode: 'timed', timeoutMs } });
    expect(parsed.info.timeoutMs).toBe(DEFAULT_NOTIFICATION_SETTINGS.info.timeoutMs);
    expect(parsed.info.mode).toBe('timed');
  });

  it.each([['a string'], [null], [{}], [[]]])(
    'resolves a non-numeric timeout (%p) to that severity default',
    (timeoutMs) => {
      const parsed = parseNotificationSettings({ success: { mode: 'timed', timeoutMs } });
      expect(parsed.success.timeoutMs).toBe(DEFAULT_NOTIFICATION_SETTINGS.success.timeoutMs);
    },
  );

  it('accepts the bounds themselves', () => {
    expect(parseNotificationSettings({ error: { timeoutMs: TIMEOUT_MIN_MS } }).error.timeoutMs).toBe(3000);
    expect(parseNotificationSettings({ error: { timeoutMs: TIMEOUT_MAX_MS } }).error.timeoutMs).toBe(30000);
  });

  it('rounds a fractional timeout rather than rejecting it', () => {
    expect(parseNotificationSettings({ info: { timeoutMs: 4000.6 } }).info.timeoutMs).toBe(4001);
  });

  /*
   * OFF THE SLIDER'S GRID IS STILL A VALID SETTING (FR-010).
   *
   * The step is the SLIDER's, not the setting's: a user who types 3567 into the field beside it has
   * asked for 3567, and the parse that reads the file back must not round it to the nearest stop.
   * The two constraints are deliberately different — the bounds are the contract, the step is an
   * affordance — and conflating them would silently rewrite a value the user saved.
   */
  it('keeps a typed value that is between two slider stops', () => {
    for (const timeoutMs of [3001, 3567, 12345, 29999]) {
      expect(
        parseNotificationSettings({ info: { mode: 'timed', timeoutMs } }).info.timeoutMs,
        `${timeoutMs} is inside the bounds and must survive`,
      ).toBe(timeoutMs);
    }
  });

  it('ignores an unknown severity key and honours the rest of the section', () => {
    const parsed = parseNotificationSettings({
      fatal: { mode: 'never', timeoutMs: 3000 },
      warning: { mode: 'timed', timeoutMs: 3000 },
    });
    expect(Object.keys(parsed).sort()).toEqual([...SEVERITIES].sort());
    expect(parsed.warning).toEqual({ mode: 'timed', timeoutMs: 3000 });
    expect(parsed.error).toEqual(DEFAULT_NOTIFICATION_SETTINGS.error);
  });

  it('resolves a severity whose value is not an object to its default', () => {
    const parsed = parseNotificationSettings({ error: 5, warning: null, info: 'timed' });
    expect(parsed.error).toEqual(DEFAULT_NOTIFICATION_SETTINGS.error);
    expect(parsed.warning).toEqual(DEFAULT_NOTIFICATION_SETTINGS.warning);
    expect(parsed.info).toEqual(DEFAULT_NOTIFICATION_SETTINGS.info);
  });

  it('accepts every display mode', () => {
    for (const mode of ['never', 'timed', 'dismiss'] satisfies DisplayMode[]) {
      expect(parseNotificationSettings({ success: { mode } }).success.mode).toBe(mode);
    }
  });

  /*
   * The property the contract states outright: for ANY JSON value, four severities, each with a
   * valid mode and an in-bounds timeout. A row-by-row table can only cover what someone thought of;
   * this covers the shape.
   */
  it('returns four valid severities for any JSON value whatsoever', () => {
    const values: unknown[] = [
      undefined,
      null,
      0,
      '',
      'notifications',
      [],
      [{ mode: 'timed' }],
      {},
      { error: undefined },
      { error: { mode: {}, timeoutMs: {} } },
      { error: { mode: 'never', timeoutMs: '5000' } },
      { warning: [] },
      { info: { mode: 'TIMED' } },
      // What a settings file spelling an absurd number actually parses to.
      { success: { mode: 'timed', timeoutMs: Number.MAX_VALUE * 2 } },
      { __proto__: { mode: 'never' } },
    ];
    for (const raw of values) {
      const parsed = parseNotificationSettings(raw);
      expect(Object.keys(parsed).sort()).toEqual([...SEVERITIES].sort());
      for (const severity of SEVERITIES) {
        expect(['never', 'timed', 'dismiss']).toContain(parsed[severity].mode);
        expect(parsed[severity].timeoutMs).toBeGreaterThanOrEqual(TIMEOUT_MIN_MS);
        expect(parsed[severity].timeoutMs).toBeLessThanOrEqual(TIMEOUT_MAX_MS);
        expect(Number.isInteger(parsed[severity].timeoutMs)).toBe(true);
      }
    }
  });

  it('never throws, whatever it is handed', () => {
    const hostile: unknown[] = [Symbol('nope'), () => undefined, new Map(), new Date(), /re/];
    for (const raw of hostile) {
      expect(() => parseNotificationSettings(raw)).not.toThrow();
    }
  });

  it('returns a fresh object, so a caller mutating the result cannot corrupt the defaults', () => {
    const parsed = parseNotificationSettings(undefined);
    parsed.error.mode = 'never';
    expect(DEFAULT_NOTIFICATION_SETTINGS.error.mode).toBe('dismiss');
    expect(parseNotificationSettings(undefined).error.mode).toBe('dismiss');
  });
});
