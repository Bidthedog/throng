import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  buildShippedDefaults,
  parseAppSettings,
} from '@throng/core';

/**
 * 030 US1 (#224) — contracts/notification-settings.md, the MERGE half.
 *
 * `parseNotificationSettings` is already proven total by its unit tests. What those cannot prove is
 * that the section is actually WIRED: a settings file is read through `parseAppSettings`, and a
 * section nobody merged would resolve to `undefined` at runtime while every parser test stayed
 * green.
 *
 * The load-bearing case is the UPGRADE. Every existing install has a `settings.json` written before
 * this feature existed, so the first file the new code ever reads has no `notifications` section at
 * all — and it must come back with the shipped four-row table AND with every other setting in that
 * file untouched. A merge that dropped the user's theme, panes or exclude globs to pay for a new
 * section would be a far worse bug than the one #224 reports.
 */
describe('notifications merge contract', () => {
  /** A settings.json of the shape shipped BEFORE 030: real sections, no `notifications`. */
  const preFeatureFile = {
    version: 1,
    appearance: { theme: 'Light' },
    confirmations: { destroyPanel: 'single' },
    panes: { projects: { maxWidth: 333 } },
    behaviour: { submenuHoverMs: 42 },
    explorer: { deleteMode: 'permanent', excludeGlobs: ['**/node_modules'] },
    terminals: { commandPollMs: 1500 },
    editor: { autoSave: true, indent: { style: 'tabs', indentWidth: 4, tabWidth: 4 } },
    newProject: { startingFolder: 'profile', lastProjectFolder: 'D:\\work' },
    search: { asYouTypeDebounceMs: 250 },
    diagnostics: { logLevel: 'debug', keepDays: 7 },
  };

  it('resolves an older file with no notifications section to the shipped defaults', () => {
    const resolved = parseAppSettings(preFeatureFile);
    expect(resolved.notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    // …and the shipped record agrees, because a reset must have somewhere to return to (015 FR-008).
    expect(buildShippedDefaults().settings.notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('leaves every other setting in that older file exactly as it was written', () => {
    const resolved = parseAppSettings(preFeatureFile);
    expect(resolved.appearance.theme).toBe('Light');
    expect(resolved.confirmations.destroyPanel).toBe('single');
    expect(resolved.panes.projects.maxWidth).toBe(333);
    expect(resolved.behaviour.submenuHoverMs).toBe(42);
    expect(resolved.explorer.deleteMode).toBe('permanent');
    expect(resolved.explorer.excludeGlobs).toEqual(['**/node_modules']);
    expect(resolved.terminals.commandPollMs).toBe(1500);
    expect(resolved.editor.autoSave).toBe(true);
    expect(resolved.editor.indent).toEqual({ style: 'tabs', indentWidth: 4, tabWidth: 4 });
    expect(resolved.newProject.startingFolder).toBe('profile');
    expect(resolved.newProject.lastProjectFolder).toBe('D:\\work');
    expect(resolved.search.asYouTypeDebounceMs).toBe(250);
    expect(resolved.diagnostics.logLevel).toBe('debug');
    expect(resolved.diagnostics.keepDays).toBe(7);
  });

  it('honours a written notifications section, per type', () => {
    const resolved = parseAppSettings({
      ...preFeatureFile,
      notifications: {
        error: { toast: true, panel: false },
        success: { toast: false, panel: false },
      },
    });
    expect(resolved.notifications.error).toEqual({ toast: true, panel: false, os: false });
    expect(resolved.notifications.success).toEqual({ toast: false, panel: false, os: false });
    expect(resolved.notifications.warning).toEqual(DEFAULT_NOTIFICATION_SETTINGS.warning);
    expect(resolved.notifications.info).toEqual(DEFAULT_NOTIFICATION_SETTINGS.info);
  });

  // 068 FR-021c: one global duration; a typed value off the slider grid is still the user's value.
  it('loads a typed duration that no slider stop can produce', () => {
    const resolved = parseAppSettings({ ...preFeatureFile, notifications: { toastDurationMs: 3567 } });
    expect(resolved.notifications.toastDurationMs).toBe(3567);
  });

  it('reads the confirm switch and the panel limit, resolving malformed values to the defaults', () => {
    const resolved = parseAppSettings({
      ...preFeatureFile,
      notifications: { confirmDismissAll: false, panelLimit: 250 },
    });
    expect(resolved.notifications.confirmDismissAll).toBe(false);
    expect(resolved.notifications.panelLimit).toBe(250);
    const bad = parseAppSettings({ notifications: { confirmDismissAll: 'x', panelLimit: 5, toastDurationMs: 1 } });
    expect(bad.notifications.confirmDismissAll).toBe(true);
    expect(bad.notifications.panelLimit).toBe(100);
    expect(bad.notifications.toastDurationMs).toBe(3000);
  });

  it('resolves a malformed value per-value, discarding neither the section nor the file (FR-015)', () => {
    const resolved = parseAppSettings({
      ...preFeatureFile,
      notifications: {
        error: { toast: 'sometimes' },
        warning: { panel: false, timeoutMs: 900 },
        info: 5,
        fatal: { toast: false },
      },
    });
    expect(resolved.notifications.error).toEqual({ toast: true, panel: true, os: false });
    expect(resolved.notifications.warning).toEqual({ toast: true, panel: false, os: false });
    expect(resolved.notifications.info).toEqual(DEFAULT_NOTIFICATION_SETTINGS.info);
    expect(Object.keys(resolved.notifications).sort()).toEqual([
      'attention',
      'confirmDismissAll',
      'error',
      'info',
      'os',
      'panelLimit',
      'success',
      'toastDurationMs',
      'toastWidthPx',
      'warning',
    ]);
    expect(resolved.appearance.theme).toBe('Light');
    expect(resolved.diagnostics.logLevel).toBe('debug');
  });

  // 057 FR-109 – FR-111: one OS switch over everything, an OS switch per type, and Attention as a type.
  it('ships the OS switches and the Attention type so nothing changes on upgrade', () => {
    const d = DEFAULT_NOTIFICATION_SETTINGS;
    expect(d.os).toBe(true);
    for (const severity of ['error', 'warning', 'info', 'success'] as const) expect(d[severity].os).toBe(false);
    expect(d.attention).toEqual({ toast: true, panel: true, os: true }); // 068 FR-062, FR-092
  });

  it('reads the OS switches and the Attention type per value, falling back on anything malformed', () => {
    const resolved = parseAppSettings({
      ...preFeatureFile,
      notifications: { os: 'no', error: { os: true }, attention: { toast: false, panel: false, os: 0 } },
    });
    expect(resolved.notifications.os).toBe(true);
    expect(resolved.notifications.error).toEqual({ toast: true, panel: true, os: true });
    expect(resolved.notifications.attention).toEqual({ toast: false, panel: false, os: true });
    expect(parseAppSettings({ notifications: { os: false } }).notifications.os).toBe(false);
  });

  it('a section that is not an object at all still yields the shipped rows', () => {
    expect(parseAppSettings({ notifications: 'off' }).notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(parseAppSettings(undefined).notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('hands every caller its OWN object, so nothing can corrupt the shipped defaults', () => {
    const a = parseAppSettings({});
    const b = parseAppSettings({});
    a.notifications.error.toast = false;
    expect(b.notifications.error.toast).toBe(DEFAULT_NOTIFICATION_SETTINGS.error.toast);
    expect(DEFAULT_APP_SETTINGS.notifications.error.toast).toBe(DEFAULT_NOTIFICATION_SETTINGS.error.toast);
    const cloned = parseAppSettings(null);
    cloned.notifications.info.panel = false;
    expect(DEFAULT_APP_SETTINGS.notifications.info.panel).toBe(true);
    cloned.notifications.attention.os = false;
    expect(DEFAULT_APP_SETTINGS.notifications.attention.os).toBe(true);
  });
});
