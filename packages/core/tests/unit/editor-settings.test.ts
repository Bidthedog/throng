import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';

describe('editorSettings parser (006, contracts/config-additions.md)', () => {
  it('defaults the whole section when absent', () => {
    const s = parseAppSettings({});
    expect(s.editor).toEqual({
      openOnClick: 'single',
      autoSave: false,
      autoSaveDebounceMs: 300,
      saveAllScope: 'project',
      defaultLineEnding: 'lf',
      maxOpenFileBytes: 10485760,
      projectPathDisplay: 'full',
      subWorkspacePathDisplay: 'full',
      warnOnMissingFile: true,
    });
  });

  it('parses warnOnMissingFile (default true; honours an explicit false)', () => {
    expect(parseAppSettings({}).editor.warnOnMissingFile).toBe(true);
    expect(parseAppSettings({ editor: { warnOnMissingFile: false } }).editor.warnOnMissingFile).toBe(
      false,
    );
    expect(parseAppSettings({ editor: { warnOnMissingFile: 'no' } }).editor.warnOnMissingFile).toBe(
      true,
    );
  });

  it('parses the path-display settings and falls back on bad values', () => {
    expect(
      parseAppSettings({ editor: { projectPathDisplay: 'name', subWorkspacePathDisplay: 'name' } })
        .editor,
    ).toMatchObject({ projectPathDisplay: 'name', subWorkspacePathDisplay: 'name' });
    expect(
      parseAppSettings({ editor: { projectPathDisplay: 'bogus' } }).editor.projectPathDisplay,
    ).toBe('full');
  });

  it('accepts a fully-specified valid section', () => {
    const s = parseAppSettings({
      editor: {
        openOnClick: 'double',
        autoSave: true,
        autoSaveDebounceMs: 250,
        saveAllScope: 'all',
        defaultLineEnding: 'crlf',
        maxOpenFileBytes: 2048,
        projectPathDisplay: 'name',
        subWorkspacePathDisplay: 'name',
        warnOnMissingFile: false,
      },
    });
    expect(s.editor).toEqual({
      openOnClick: 'double',
      autoSave: true,
      autoSaveDebounceMs: 250,
      saveAllScope: 'all',
      defaultLineEnding: 'crlf',
      maxOpenFileBytes: 2048,
      projectPathDisplay: 'name',
      subWorkspacePathDisplay: 'name',
      warnOnMissingFile: false,
    });
  });

  it('falls back per-field on invalid values (tolerant, never throws)', () => {
    const s = parseAppSettings({
      editor: {
        openOnClick: 'triple', // invalid
        autoSave: 'yes', // invalid type
        autoSaveDebounceMs: -5, // invalid (negative)
        saveAllScope: 'galaxy', // invalid
        defaultLineEnding: 'lfcr', // invalid
        maxOpenFileBytes: 0, // invalid (must be > 0)
      },
    });
    expect(s.editor).toEqual(DEFAULT_APP_SETTINGS.editor);
  });

  it('drops a non-object editor section to defaults', () => {
    expect(parseAppSettings({ editor: 42 }).editor).toEqual(DEFAULT_APP_SETTINGS.editor);
  });

  it('allows autoSaveDebounceMs of 0 (immediate) but not negative', () => {
    expect(parseAppSettings({ editor: { autoSaveDebounceMs: 0 } }).editor.autoSaveDebounceMs).toBe(0);
    expect(parseAppSettings({ editor: { autoSaveDebounceMs: -1 } }).editor.autoSaveDebounceMs).toBe(
      300,
    );
  });

  it('a parsed settings object is deep-cloned (structuredCloneSettings covers editor)', () => {
    const a = parseAppSettings({ editor: { autoSave: true } });
    const b = parseAppSettings({ editor: { autoSave: true } });
    a.editor.autoSave = false;
    expect(b.editor.autoSave).toBe(true);
  });
});
