import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '@throng/core';

describe('AppSettings parse/merge/validate (FR-031/032)', () => {
  it('returns defaults for undefined / non-object input', () => {
    expect(parseAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings('nope')).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings(42)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('deep-merges a partial document over defaults', () => {
    const parsed = parseAppSettings({ appearance: { theme: 'Midnight' } });
    expect(parsed.appearance.theme).toBe('Midnight');
    // untouched sections keep their defaults
    expect(parsed.confirmations).toEqual(DEFAULT_APP_SETTINGS.confirmations);
    expect(parsed.panes).toEqual(DEFAULT_APP_SETTINGS.panes);
  });

  it('falls back to the default for an invalid confirmation enum', () => {
    const parsed = parseAppSettings({ confirmations: { destroyProject: 'maybe', destroyTab: 'none' } });
    expect(parsed.confirmations.destroyProject).toBe('double'); // invalid → default
    expect(parsed.confirmations.destroyTab).toBe('none'); // valid → kept
    expect(parsed.confirmations.destroyPanel).toBe('double'); // missing → default
  });

  it('keeps a valid configured pane maxWidth and falls back when invalid', () => {
    const parsed = parseAppSettings({
      panes: {
        projects: { maxWidth: 300 },
        fileExplorer: { maxWidth: -1 },
      },
    });
    expect(parsed.panes.projects).toEqual({ maxWidth: 300 });
    expect(parsed.panes.fileExplorer.maxWidth).toBe(DEFAULT_APP_SETTINGS.panes.fileExplorer.maxWidth);
  });

  it('ignores legacy/unknown pane fields (width / visible)', () => {
    const parsed = parseAppSettings({
      panes: { projects: { visible: false, width: 999, maxWidth: 350 } },
    });
    expect(parsed.panes.projects).toEqual({ maxWidth: 350 });
  });

  it('round-trips a fully valid document', () => {
    const full = parseAppSettings(DEFAULT_APP_SETTINGS);
    expect(full).toEqual(DEFAULT_APP_SETTINGS);
  });
});
