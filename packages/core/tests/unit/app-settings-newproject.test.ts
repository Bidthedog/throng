import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';

describe('AppSettings newProject section (011 US3)', () => {
  it('defaults to lastViewed with empty override + last-viewed folders', () => {
    expect(DEFAULT_APP_SETTINGS.newProject).toEqual({
      startingFolder: 'lastViewed',
      overridePath: '',
      lastProjectFolder: '',
    });
  });

  it('parses a well-formed newProject section', () => {
    const parsed = parseAppSettings({
      newProject: {
        startingFolder: 'override',
        overridePath: 'D:/work',
        lastProjectFolder: 'D:/last',
      },
    });
    expect(parsed.newProject).toEqual({
      startingFolder: 'override',
      overridePath: 'D:/work',
      lastProjectFolder: 'D:/last',
    });
  });

  it('falls back to defaults for an unknown startingFolder value', () => {
    const parsed = parseAppSettings({ newProject: { startingFolder: 'nonsense' } });
    expect(parsed.newProject.startingFolder).toBe('lastViewed');
  });

  it('coerces non-string override / last-viewed paths to empty strings', () => {
    const parsed = parseAppSettings({
      newProject: { overridePath: 123, lastProjectFolder: { bad: true } },
    });
    expect(parsed.newProject.overridePath).toBe('');
    expect(parsed.newProject.lastProjectFolder).toBe('');
  });

  it('uses defaults when newProject is missing or not an object', () => {
    expect(parseAppSettings({}).newProject).toEqual(DEFAULT_APP_SETTINGS.newProject);
    expect(parseAppSettings({ newProject: 'x' }).newProject).toEqual(DEFAULT_APP_SETTINGS.newProject);
  });
});
