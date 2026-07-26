import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SHIPPED_INDENT_BY_LANGUAGE } from '../../src/editor/languages.js';

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
      indent: { style: 'spaces', indentWidth: 2, tabWidth: 4 },
      indentByLanguage: SHIPPED_INDENT_BY_LANGUAGE,
      languageByExtension: {},
      persistUndoHistory: true,
      openTarget: 'lastActive',
      saveDocumentScroll: false,
      defaultWordWrap: true,
      showStatusBar: true,
    });
  });

  it('parses defaultWordWrap and showStatusBar (024 US1; default true, honour false, reject non-boolean)', () => {
    expect(parseAppSettings({}).editor.defaultWordWrap).toBe(true);
    expect(parseAppSettings({}).editor.showStatusBar).toBe(true);
    expect(parseAppSettings({ editor: { defaultWordWrap: false } }).editor.defaultWordWrap).toBe(false);
    expect(parseAppSettings({ editor: { showStatusBar: false } }).editor.showStatusBar).toBe(false);
    expect(parseAppSettings({ editor: { defaultWordWrap: 'yes' } }).editor.defaultWordWrap).toBe(true);
    expect(parseAppSettings({ editor: { showStatusBar: 1 } }).editor.showStatusBar).toBe(true);
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
      // Absent from the input above, so they fall back — the section is parsed FIELD BY FIELD, not
      // all-or-nothing, so an old settings file that predates 016 still gets working indentation.
      indent: { style: 'spaces', indentWidth: 2, tabWidth: 4 },
      indentByLanguage: SHIPPED_INDENT_BY_LANGUAGE,
      languageByExtension: {},
      persistUndoHistory: true,
      openTarget: 'lastActive',
      saveDocumentScroll: false,
      defaultWordWrap: true,
      showStatusBar: true,
    });
  });

  describe('indentation (016, FR-018/FR-022)', () => {
    it('takes a global profile, and falls back FIELD by field on a bad one', () => {
      const s = parseAppSettings({
        editor: { indent: { style: 'tabs', indentWidth: 8, tabWidth: 'wide' } },
      });
      expect(s.editor.indent).toEqual({ style: 'tabs', indentWidth: 8, tabWidth: 4 });
    });

    it('rejects a nonsensical width rather than letting it through', () => {
      // A zero-width indent inserts nothing, and a 500-wide one is not a preference, it is a typo.
      expect(parseAppSettings({ editor: { indent: { indentWidth: 0 } } }).editor.indent.indentWidth).toBe(2);
      expect(parseAppSettings({ editor: { indent: { indentWidth: 500 } } }).editor.indent.indentWidth).toBe(2);
    });

    it('ships the per-language map FROM THE REGISTRY, so Go indents with tabs', () => {
      const s = parseAppSettings({});
      expect(s.editor.indentByLanguage.go).toEqual({ style: 'tabs', indentWidth: 4, tabWidth: 4 });
      expect(s.editor.indentByLanguage.python).toEqual({
        style: 'spaces',
        indentWidth: 4,
        tabWidth: 4,
      });
    });

    it('lets an EXPLICIT empty map mean empty — the whole of FR-022c', () => {
      // The `terminals.defaultParams` precedent. A map that fell back to its shipped value whenever
      // it was empty could never be cleared: the user deletes every row, saves, and watches them all
      // come back. `languageByExtension` MUST be clearable.
      expect(parseAppSettings({ editor: { languageByExtension: {} } }).editor.languageByExtension).toEqual({});
      expect(parseAppSettings({ editor: { indentByLanguage: {} } }).editor.indentByLanguage).toEqual({});
    });

    it('DROPS a malformed row instead of failing the whole map', () => {
      // One bad row in a hand-edited JSON file must not cost the user the other twenty.
      const s = parseAppSettings({
        editor: {
          languageByExtension: { '.foo': 'python', '.bar': 42, '.baz': '' },
          indentByLanguage: { go: { style: 'tabs', indentWidth: 4, tabWidth: 4 }, bogus: 'nonsense' },
        },
      });
      expect(s.editor.languageByExtension).toEqual({ '.foo': 'python' });
      expect(s.editor.indentByLanguage).toEqual({ go: { style: 'tabs', indentWidth: 4, tabWidth: 4 } });
    });

    it('parses persistUndoHistory (default true; honours an explicit false)', () => {
      expect(parseAppSettings({}).editor.persistUndoHistory).toBe(true);
      expect(
        parseAppSettings({ editor: { persistUndoHistory: false } }).editor.persistUndoHistory,
      ).toBe(false);
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
