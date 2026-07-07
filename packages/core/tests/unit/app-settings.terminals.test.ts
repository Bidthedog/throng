import { describe, it, expect } from 'vitest';
import { parseAppSettings, DEFAULT_APP_SETTINGS } from '@throng/core';

describe('parseAppSettings — terminals section (005 Phase B)', () => {
  it('defaults to empty flavours / disabledBuiltins / defaultParams when absent', () => {
    expect(parseAppSettings({}).terminals).toEqual({
      flavours: [],
      disabledBuiltins: [],
      defaultParams: {},
    });
    expect(DEFAULT_APP_SETTINGS.terminals).toEqual({
      flavours: [],
      disabledBuiltins: [],
      defaultParams: {},
    });
  });

  it('keeps a well-formed user flavour entry', () => {
    const parsed = parseAppSettings({
      terminals: {
        flavours: [
          { id: 'my-wsl', label: 'WSL: Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultParams: '' },
        ],
        disabledBuiltins: ['cmd'],
        defaultParams: { pwsh: '-NoLogo' },
      },
    });
    expect(parsed.terminals.flavours).toEqual([
      { id: 'my-wsl', label: 'WSL: Ubuntu', file: 'wsl.exe', args: ['-d', 'Ubuntu'], defaultParams: '' },
    ]);
    expect(parsed.terminals.disabledBuiltins).toEqual(['cmd']);
    expect(parsed.terminals.defaultParams).toEqual({ pwsh: '-NoLogo' });
  });

  it('drops malformed flavour entries (missing id or file) but keeps the rest', () => {
    const parsed = parseAppSettings({
      terminals: {
        flavours: [
          { id: 'good', label: 'Good', file: 'good.exe' },
          { label: 'No id', file: 'x.exe' },
          { id: 'no-file', label: 'No file' },
          'nonsense',
        ],
      },
    });
    expect(parsed.terminals.flavours.map((f) => f.id)).toEqual(['good']);
    // a missing label falls back to the id; missing args default to [].
    expect(parsed.terminals.flavours[0]).toMatchObject({ id: 'good', file: 'good.exe', args: [] });
  });

  it('drops non-string disabledBuiltins and non-string defaultParams values', () => {
    const parsed = parseAppSettings({
      terminals: {
        disabledBuiltins: ['cmd', 5, null],
        defaultParams: { pwsh: '-NoLogo', bad: 7 },
      },
    });
    expect(parsed.terminals.disabledBuiltins).toEqual(['cmd']);
    expect(parsed.terminals.defaultParams).toEqual({ pwsh: '-NoLogo' });
  });

  it('falls back to defaults when terminals is not an object', () => {
    expect(parseAppSettings({ terminals: 'nope' }).terminals).toEqual({
      flavours: [],
      disabledBuiltins: [],
      defaultParams: {},
    });
  });
});
