import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DISPLAY_MODES,
  DISPLAY_MODE_LABELS,
  NOTICE_SEVERITIES,
  PANEL_LIMIT_MAX,
  PANEL_LIMIT_MIN,
  TOAST_DURATION_MAX_MS,
  TOAST_DURATION_MIN_MS,
  TOAST_WIDTH_DEFAULT_PX,
  TOAST_WIDTH_MAX_PX,
  TOAST_WIDTH_MIN_PX,
  parseNotificationSettings,
  displayOf,
  upgradeNotificationDocument,
} from '@throng/core';

/**
 * 030 FR-014 / FR-015 as reshaped by 068 US3 (FR-021a to FR-021d, FR-026c, FR-031d): three modes
 * (never / toast / panel), one global toast duration, one confirm-dismiss-all switch and one panel
 * limit, and a TOTAL parse. The upgrade of a pre-068 document (`dismiss`/`timed`, per-type
 * `timeoutMs`) is a pure function proven here too.
 */

const SEVERITIES = ['error', 'warning', 'info', 'success'] as const;
const TYPES = [...SEVERITIES, 'attention'] as const;
const SECTION_KEYS = [...TYPES, 'os', 'toastDurationMs', 'toastWidthPx', 'confirmDismissAll', 'panelLimit'].sort();

describe('the modes and their names (FR-021a)', () => {
  it('has three modes, in order', () => {
    expect([...DISPLAY_MODES]).toEqual(['never', 'toast', 'panel']);
  });

  it('labels them Never display / Toast only / Toast and keep in panel', () => {
    expect(DISPLAY_MODE_LABELS).toEqual({
      never: 'Never display',
      toast: 'Toast only',
      panel: 'Toast and keep in panel',
    });
  });
});

describe('the shipped defaults (FR-021b to FR-021d, FR-026c, FR-031d)', () => {
  it('ships every type with Toast and Panel on (FR-062, FR-092, over FR-021c)', () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS).toEqual({
      os: true,
      error: { toast: true, panel: true, os: false },
      warning: { toast: true, panel: true, os: false },
      info: { toast: true, panel: true, os: false },
      success: { toast: true, panel: true, os: false },
      attention: { toast: true, panel: true, os: true },
      toastDurationMs: 3000,
      toastWidthPx: 520,
      confirmDismissAll: true,
      panelLimit: 100,
    });
  });

  it('bounds the toast duration at 1000–30000 (FR-091) and the panel limit at 20–500', () => {
    expect(TOAST_DURATION_MIN_MS).toBe(1000);
    expect(TOAST_DURATION_MAX_MS).toBe(30000);
    expect(PANEL_LIMIT_MIN).toBe(20);
    expect(PANEL_LIMIT_MAX).toBe(500);
  });

  it('bounds the toast width at 300–800 px and ships it at 520 (FR-090, over FR-081)', () => {
    expect(TOAST_WIDTH_MIN_PX).toBe(300);
    expect(TOAST_WIDTH_MAX_PX).toBe(800);
    expect(TOAST_WIDTH_DEFAULT_PX).toBe(520);
  });

  it.each([
    ['below the minimum', 299],
    ['above the maximum', 801],
    ['not a number', 'wide'],
    ['not finite', Number.POSITIVE_INFINITY],
    ['absent', undefined],
  ])('resolves a toastWidthPx that is %s to the 520 default, as the other numeric preferences do (030 FR-010)', (_l, toastWidthPx) => {
    expect(parseNotificationSettings({ toastWidthPx }).toastWidthPx).toBe(520);
  });

  it('keeps a toastWidthPx inside 300–800, rounded to a whole pixel', () => {
    expect(parseNotificationSettings({ toastWidthPx: 300 }).toastWidthPx).toBe(300);
    expect(parseNotificationSettings({ toastWidthPx: 800 }).toastWidthPx).toBe(800);
    expect(parseNotificationSettings({ toastWidthPx: 333.4 }).toastWidthPx).toBe(333);
  });

  it('names the four severities once, so callers iterate rather than re-list them', () => {
    expect([...NOTICE_SEVERITIES]).toEqual([...SEVERITIES]);
  });
});

describe('parseNotificationSettings — the contract truth table', () => {
  it.each([[undefined], [null], ['a string'], [42], [true], [[1, 2, 3]]])(
    'resolves everything to defaults for %p',
    (raw) => {
      expect(parseNotificationSettings(raw)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    },
  );

  it('resolves an absent type to its own default', () => {
    const parsed = parseNotificationSettings({ error: { toast: false, panel: false } });
    expect(parsed.error).toEqual({ toast: false, panel: false, os: false });
    expect(parsed.warning).toEqual(DEFAULT_NOTIFICATION_SETTINGS.warning);
  });

  it('resolves a switch that is not a boolean to that type default, keeping the other (FR-092)', () => {
    const parsed = parseNotificationSettings({ info: { toast: 'no', panel: false }, error: { toast: false, panel: 1 } });
    expect(parsed.info).toEqual({ toast: true, panel: false, os: false });
    expect(parsed.error).toEqual({ toast: false, panel: true, os: false });
  });

  it('keeps stored switches over the shipped default (FR-062, FR-092)', () => {
    const parsed = parseNotificationSettings({ info: { toast: true, panel: false }, attention: { toast: false, panel: false } });
    expect(parsed.info).toMatchObject({ toast: true, panel: false });
    expect(parsed.attention).toMatchObject({ toast: false, panel: false });
    expect(parsed.success).toMatchObject({ toast: true, panel: true });
  });

  it('accepts every combination of Toast and Panel, Panel alone included (FR-092)', () => {
    for (const toast of [true, false]) {
      for (const panel of [true, false]) {
        expect(parseNotificationSettings({ success: { toast, panel } }).success).toMatchObject({ toast, panel });
      }
    }
  });

  it('ignores a leftover per-type timeoutMs and a mode the upgrade did not see (the upgrade, not the parse, reads modes)', () => {
    const parsed = parseNotificationSettings({ info: { mode: 'never', timeoutMs: 8000 } });
    expect(parsed.info).toEqual({ toast: true, panel: true, os: false });
  });

  it.each([
    ['below the minimum', 999],
    ['above the maximum', 30001],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['a string', '5000'],
    ['null', null],
  ])('resolves an out-of-range toastDurationMs (%s) to 3000', (_l, toastDurationMs) => {
    expect(parseNotificationSettings({ toastDurationMs }).toastDurationMs).toBe(3000);
  });

  it('accepts the toast duration bounds and any integer between them, rounding a fraction', () => {
    expect(parseNotificationSettings({ toastDurationMs: 1000 }).toastDurationMs).toBe(1000);
    expect(parseNotificationSettings({ toastDurationMs: 30000 }).toastDurationMs).toBe(30000);
    expect(parseNotificationSettings({ toastDurationMs: 3567 }).toastDurationMs).toBe(3567);
    expect(parseNotificationSettings({ toastDurationMs: 4000.6 }).toastDurationMs).toBe(4001);
  });

  it.each([[19], [501], [0], [Number.NaN], ['100'], [null]])(
    'resolves an out-of-range panelLimit (%p) to 100',
    (panelLimit) => {
      expect(parseNotificationSettings({ panelLimit }).panelLimit).toBe(100);
    },
  );

  it('accepts the panel limit bounds', () => {
    expect(parseNotificationSettings({ panelLimit: 20 }).panelLimit).toBe(20);
    expect(parseNotificationSettings({ panelLimit: 500 }).panelLimit).toBe(500);
  });

  it('reads confirmDismissAll as a boolean, falling back to true', () => {
    expect(parseNotificationSettings({ confirmDismissAll: false }).confirmDismissAll).toBe(false);
    expect(parseNotificationSettings({ confirmDismissAll: 'no' }).confirmDismissAll).toBe(true);
  });

  it('ignores an unknown key and honours the rest of the section', () => {
    const parsed = parseNotificationSettings({ fatal: { toast: false }, warning: { panel: false } });
    expect(Object.keys(parsed).sort()).toEqual(SECTION_KEYS);
    expect(parsed.warning).toMatchObject({ toast: true, panel: false });
  });

  it('returns a valid shape for any JSON value whatsoever and never throws', () => {
    const values: unknown[] = [
      undefined,
      0,
      '',
      [],
      {},
      { error: { toast: {}, os: 'x' } },
      { warning: [] },
      { info: { panel: 'TOAST' } },
      { toastDurationMs: Number.MAX_VALUE * 2 },
      Symbol('nope'),
      () => undefined,
      new Map(),
    ];
    for (const raw of values) {
      const parsed = parseNotificationSettings(raw);
      expect(Object.keys(parsed).sort()).toEqual(SECTION_KEYS);
      for (const type of TYPES) {
        expect(typeof parsed[type].toast).toBe('boolean');
        expect(typeof parsed[type].panel).toBe('boolean');
        expect(typeof parsed[type].os).toBe('boolean');
      }
      expect(Number.isInteger(parsed.toastDurationMs)).toBe(true);
      expect(Number.isInteger(parsed.panelLimit)).toBe(true);
    }
  });

  it('returns a fresh object, so a caller mutating the result cannot corrupt the defaults', () => {
    const parsed = parseNotificationSettings(undefined);
    parsed.error.toast = false;
    expect(DEFAULT_NOTIFICATION_SETTINGS.error.toast).toBe(true);
  });
});

describe('displayOf (FR-092)', () => {
  it('reads Never display as neither, Toast only as Toast, and Toast and keep in panel as both', () => {
    expect(displayOf('never')).toEqual({ toast: false, panel: false });
    expect(displayOf('toast')).toEqual({ toast: true, panel: false });
    expect(displayOf('panel')).toEqual({ toast: true, panel: true });
  });
});

describe('upgradeNotificationDocument (FR-021d, research D4, FR-092)', () => {
  it('maps a type row\'s mode to its Toast and Panel switches, through dismiss and timed, and drops every timeoutMs', () => {
    const doc = {
      notifications: {
        os: false,
        error: { mode: 'dismiss', timeoutMs: 5000, os: true },
        warning: { mode: 'never', timeoutMs: 5000 },
        info: { mode: 'timed', timeoutMs: 8000 },
        success: { mode: 'timed', timeoutMs: 5000 },
        attention: { mode: 'dismiss', timeoutMs: 10000, os: false },
      },
    };
    expect(upgradeNotificationDocument(doc)).toEqual({
      notifications: {
        os: false,
        error: { toast: true, panel: true, os: true },
        warning: { toast: false, panel: false },
        info: { toast: true, panel: false },
        success: { toast: true, panel: false },
        attention: { toast: true, panel: true, os: false },
      },
    });
  });

  it('maps the current modes, and lets a switch the user set since win over the mode it replaced', () => {
    const out = upgradeNotificationDocument({
      notifications: {
        error: { mode: 'never' },
        warning: { mode: 'toast' },
        info: { mode: 'panel' },
        success: { mode: 'never', toast: true },
        attention: { mode: 'sometimes', os: true },
      },
    }) as { notifications: Record<string, unknown> };
    expect(out.notifications).toEqual({
      error: { toast: false, panel: false },
      warning: { toast: true, panel: false },
      info: { toast: true, panel: true },
      success: { toast: true, panel: false },
      attention: { os: true },
    });
  });

  it('maps the Find in Files summary notice the same way and drops its timeout', () => {
    const out = upgradeNotificationDocument({
      search: { asYouTypeDebounceMs: 250, inFiles: { summaryNoticeMode: 'dismiss', summaryNoticeTimeoutMs: 4000 } },
    }) as { search: { asYouTypeDebounceMs: number; inFiles: Record<string, unknown> } };
    expect(out.search.asYouTypeDebounceMs).toBe(250);
    expect(out.search.inFiles).toEqual({ summaryNoticeMode: 'panel' });
    const timed = upgradeNotificationDocument({ search: { inFiles: { summaryNoticeMode: 'timed' } } }) as {
      search: { inFiles: Record<string, unknown> };
    };
    expect(timed.search.inFiles.summaryNoticeMode).toBe('toast');
  });

  it('is idempotent: an upgraded document comes back unchanged', () => {
    const upgraded = upgradeNotificationDocument({
      notifications: { info: { mode: 'timed', timeoutMs: 8000 }, toastDurationMs: 4000 },
      search: { inFiles: { summaryNoticeMode: 'dismiss', summaryNoticeTimeoutMs: 1030 } },
    });
    expect(upgradeNotificationDocument(upgraded)).toEqual(upgraded);
  });

  it('leaves a document with nothing to upgrade deeply equal, and a non-object as it is', () => {
    const clean = { notifications: { error: { toast: true, panel: false } }, appearance: { theme: 'Light' } };
    expect(upgradeNotificationDocument(clean)).toEqual(clean);
    for (const raw of [undefined, null, 'x', 3, [1]]) {
      expect(upgradeNotificationDocument(raw)).toBe(raw);
    }
  });

  it('does not mutate its input', () => {
    const raw = { notifications: { info: { mode: 'timed', timeoutMs: 8000 } } };
    const copy = structuredClone(raw);
    upgradeNotificationDocument(raw);
    expect(raw).toEqual(copy);
  });
});
