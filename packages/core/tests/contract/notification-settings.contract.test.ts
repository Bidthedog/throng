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
    terminals: { linkHoverDelayMs: 250 },
    editor: { autoSave: true, indent: { style: 'tabs', indentWidth: 4, tabWidth: 4 } },
    newProject: { startingFolder: 'profile', lastProjectFolder: 'D:\\work' },
    search: { asYouTypeDebounceMs: 250 },
    diagnostics: { logLevel: 'debug', keepFiles: 7 },
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
    expect(resolved.terminals.linkHoverDelayMs).toBe(250);
    expect(resolved.editor.autoSave).toBe(true);
    expect(resolved.editor.indent).toEqual({ style: 'tabs', indentWidth: 4, tabWidth: 4 });
    expect(resolved.newProject.startingFolder).toBe('profile');
    expect(resolved.newProject.lastProjectFolder).toBe('D:\\work');
    expect(resolved.search.asYouTypeDebounceMs).toBe(250);
    expect(resolved.diagnostics.logLevel).toBe('debug');
    expect(resolved.diagnostics.keepFiles).toBe(7);
  });

  it('honours a written notifications section, per severity', () => {
    const resolved = parseAppSettings({
      ...preFeatureFile,
      notifications: {
        error: { mode: 'timed', timeoutMs: 20000 },
        success: { mode: 'never', timeoutMs: 4000 },
      },
    });
    expect(resolved.notifications.error).toEqual({ mode: 'timed', timeoutMs: 20000 });
    expect(resolved.notifications.success).toEqual({ mode: 'never', timeoutMs: 4000 });
    // Unwritten severities are still the shipped values, not undefined.
    expect(resolved.notifications.warning).toEqual(DEFAULT_NOTIFICATION_SETTINGS.warning);
    expect(resolved.notifications.info).toEqual(DEFAULT_NOTIFICATION_SETTINGS.info);
  });

  /*
   * A DURATION SAVED BETWEEN TWO SLIDER STOPS IS STILL THE USER'S DURATION (FR-010).
   *
   * The contract admits any integer in [3000, 30000]. The 500 ms step is the slider's grid and
   * belongs to the control, so a file carrying 3567 — typed rather than dragged — must load as 3567.
   * Asserted here as well as in the parser's own tests because this is the path the APPLICATION
   * takes on startup, and a snap introduced in the merge would be invisible to a parse test.
   */
  it('loads a typed duration that no slider stop can produce', () => {
    const resolved = parseAppSettings({
      ...preFeatureFile,
      notifications: { info: { mode: 'timed', timeoutMs: 3567 } },
    });
    expect(resolved.notifications.info).toEqual({ mode: 'timed', timeoutMs: 3567 });
  });

  it('resolves a malformed value per-value, discarding neither the section nor the file (FR-015)', () => {
    // Every value here is wrong in a different way — the mode is not a mode, the timeout is below
    // the floor, a whole severity is a number, and there is a severity that does not exist. A
    // hand-edited settings.json produces exactly this, and it must cost the user nothing else.
    const resolved = parseAppSettings({
      ...preFeatureFile,
      notifications: {
        error: { mode: 'sometimes', timeoutMs: 30000 },
        warning: { mode: 'timed', timeoutMs: 900 },
        info: 5,
        fatal: { mode: 'never' },
      },
    });
    expect(resolved.notifications.error).toEqual({ mode: 'dismiss', timeoutMs: 30000 });
    expect(resolved.notifications.warning).toEqual({
      mode: 'timed',
      timeoutMs: DEFAULT_NOTIFICATION_SETTINGS.warning.timeoutMs,
    });
    expect(resolved.notifications.info).toEqual(DEFAULT_NOTIFICATION_SETTINGS.info);
    expect(Object.keys(resolved.notifications).sort()).toEqual([
      'error',
      'info',
      'success',
      'warning',
    ]);
    // The rest of the file is untouched by a broken neighbour.
    expect(resolved.appearance.theme).toBe('Light');
    expect(resolved.diagnostics.logLevel).toBe('debug');
  });

  it('a section that is not an object at all still yields the four shipped rows', () => {
    expect(parseAppSettings({ notifications: 'off' }).notifications).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
    expect(parseAppSettings(undefined).notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('hands every caller its OWN object, so nothing can corrupt the shipped defaults', () => {
    const a = parseAppSettings({});
    const b = parseAppSettings({});
    a.notifications.error.timeoutMs = 12345;
    expect(b.notifications.error.timeoutMs).toBe(DEFAULT_NOTIFICATION_SETTINGS.error.timeoutMs);
    expect(DEFAULT_APP_SETTINGS.notifications.error.timeoutMs).toBe(
      DEFAULT_NOTIFICATION_SETTINGS.error.timeoutMs,
    );
    // The defaults-clone path (a non-object document) is the one that used to share sub-objects.
    const cloned = parseAppSettings(null);
    cloned.notifications.info.mode = 'never';
    expect(DEFAULT_APP_SETTINGS.notifications.info.mode).toBe('timed');
  });
});
