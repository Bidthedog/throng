import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { parseSettingsGuarded } from '../../src/config/settings-read.js';
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
      // 040 FR-040 — the gutter, shipped ON. Exhaustive assertion, same reason as the blocks below.
      showGutter: true,
      // 033 FR-069b — the navigation block. Shipped ON: Quick Open starts by excluding what the
      // project hides, so the modal and the tree give one answer.
      // 033 FR-058 — and the two remember toggles, both shipped OFF. Their own key-by-key parsing
      // is asserted in `editor-navigation-settings.test.ts`; they appear here because this
      // assertion is exhaustive, which is what makes a silently-added key impossible.
      navigation: {
        quickOpenExcludeHidden: true,
        rememberQuickOpenQuery: false,
        rememberGotoLineNumber: false,
      },
      // 040 FR-030/FR-031 — the status-bar readout block, both shipped ON. Here for the same reason
      // the navigation block is: this assertion is exhaustive, which is what makes a silently-added
      // key impossible. Its key-by-key parsing is asserted below.
      statusBar: {
        showCursorPosition: true,
        showCounts: true,
      },
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

  /*
   * 040 — `editor.statusBar`, key by key.
   *
   * The exhaustive assertions above prove the block EXISTS and defaults correctly; they cannot tell
   * a real sub-parser from `fallback` handed straight back, because both produce the shipped
   * values. These four cases are the difference: an explicit `false` has to survive, a non-boolean
   * has to fall back to its OWN default rather than discarding the block, and a half-specified
   * block must keep the half that was specified.
   */
  it('parses editor.statusBar field by field (040 FR-030/FR-031)', () => {
    expect(parseAppSettings({}).editor.statusBar).toEqual({
      showCursorPosition: true,
      showCounts: true,
    });
    expect(
      parseAppSettings({ editor: { statusBar: { showCursorPosition: false, showCounts: false } } })
        .editor.statusBar,
    ).toEqual({ showCursorPosition: false, showCounts: false });
    // Half a block is not all-or-nothing: the specified leaf wins, the absent one defaults.
    expect(
      parseAppSettings({ editor: { statusBar: { showCounts: false } } }).editor.statusBar,
    ).toEqual({ showCursorPosition: true, showCounts: false });
    // A non-boolean is not a value, and it does not take the rest of the block down with it.
    expect(
      parseAppSettings({ editor: { statusBar: { showCursorPosition: 'no', showCounts: false } } })
        .editor.statusBar,
    ).toEqual({ showCursorPosition: true, showCounts: false });
    // A block that is not an object at all falls back WHOLE.
    expect(parseAppSettings({ editor: { statusBar: 'off' } }).editor.statusBar).toEqual({
      showCursorPosition: true,
      showCounts: true,
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
      // 040 FR-040 — the gutter, shipped ON. Exhaustive assertion, same reason as the blocks below.
      showGutter: true,
      // 033 FR-069b — the navigation block. Shipped ON: Quick Open starts by excluding what the
      // project hides, so the modal and the tree give one answer.
      // 033 FR-058 — and the two remember toggles, both shipped OFF. Their own key-by-key parsing
      // is asserted in `editor-navigation-settings.test.ts`; they appear here because this
      // assertion is exhaustive, which is what makes a silently-added key impossible.
      navigation: {
        quickOpenExcludeHidden: true,
        rememberQuickOpenQuery: false,
        rememberGotoLineNumber: false,
      },
      // 040 FR-030/FR-031 — the status-bar readout block, both shipped ON. Here for the same reason
      // the navigation block is: this assertion is exhaustive, which is what makes a silently-added
      // key impossible. Its key-by-key parsing is asserted below.
      statusBar: {
        showCursorPosition: true,
        showCounts: true,
      },
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
      // A zero-width indent inserts nothing — meaningless rather than out of range, so the parser
      // still refuses it on its own.
      expect(parseAppSettings({ editor: { indent: { indentWidth: 0 } } }).editor.indent.indentWidth).toBe(2);
    });

    /*
     * 031 (#227) — the RANGE moved, it did not disappear.
     *
     * `parseAppSettings` used to hard-code 1–16 here, duplicating what
     * `editor.indent.indentWidth`'s descriptor already declares. That second copy is exactly the
     * drift #227 exists to remove: raising the descriptor's maximum would have left the parser
     * silently substituting the default for anything above 16.
     *
     * So the assertion moves to the guarded read, which is what every settings reader now calls.
     * Deleting it instead would have quietly dropped the only coverage of a real bound.
     */
    it('clamps an out-of-range width through the GUARDED read, not the bare parser', () => {
      const raw = { editor: { indent: { indentWidth: 500 } } };
      expect(
        parseAppSettings(raw).editor.indent.indentWidth,
        'the bare parser no longer owns the range',
      ).toBe(500);
      const guarded = parseSettingsGuarded(raw);
      expect(guarded.value.editor.indent.indentWidth, 'the declared maximum is 16').toBe(16);
      expect(guarded.corrected, 'and it reports the correction, so the file is written back').toBe(true);
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
      // The `terminals.defaultShellArguments` precedent. A map that fell back to its shipped value whenever
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

  /*
   * ══ THE SECTION-LEVEL FALLBACK HANDS OUT A COPY, NOT THE SHIPPED OBJECTS ══
   *
   * `editorSettings` takes an early return whenever the document has no `editor` key or a
   * non-record one — which is the commonest input in this codebase, `parseAppSettings({})`. That
   * return used to be a SPREAD of the defaults with a single nested member re-cloned by hand, so
   * the other three came back BY REFERENCE and every caller shared one object with
   * `DEFAULT_APP_SETTINGS` (which is not frozen, so a mutation is silent rather than a throw).
   *
   * `indentByLanguage` is the sharp end: its default IS `SHIPPED_INDENT_BY_LANGUAGE`, the language
   * registry's own derived table, so the shared reference reached past the config module entirely.
   *
   * These are IDENTITY assertions on purpose. Every value assertion in this file passes just as
   * happily on a shared object as on a copy — which is why the defect survived a suite that already
   * covers this section key by key.
   */
  describe('the section fallback never shares a nested object with the shipped defaults', () => {
    // Both inputs that reach `editorSettings`'s early return: an absent section and a non-record one.
    const fallbackInputs: [string, unknown][] = [
      ['no editor key at all', {}],
      ['a null editor section', { editor: null }],
    ];

    for (const [label, raw] of fallbackInputs) {
      it(`copies all five object-valued members — ${label}`, () => {
        const editor = parseAppSettings(raw).editor;
        const shipped = DEFAULT_APP_SETTINGS.editor;

        /*
         * FIVE, not four: 040 added `statusBar` to `EditorSettings`, and `cloneEditor` re-clones it
         * alongside the other four. The count in this title and the list below are the same claim
         * as `app-settings.ts`'s "There are five (040 added `statusBar`)" — a title still saying
         * four while a member went unnamed is how a sixth gets added and missed.
         *
         * `expect.soft`, so a broken clone names EVERY member it shares rather than stopping at the
         * first. That matters here more than it usually does: the defect this replaces was one of
         * four members on one line being re-cloned, and a hard assertion would have reported
         * `indent` and left the reader to discover the other two by fixing it twice.
         */
        expect.soft(editor.indent, 'editor.indent').not.toBe(shipped.indent);
        expect
          .soft(editor.indentByLanguage, 'editor.indentByLanguage')
          .not.toBe(shipped.indentByLanguage);
        expect
          .soft(editor.languageByExtension, 'editor.languageByExtension')
          .not.toBe(shipped.languageByExtension);
        expect.soft(editor.navigation, 'editor.navigation').not.toBe(shipped.navigation);
        expect.soft(editor.statusBar, 'editor.statusBar').not.toBe(shipped.statusBar);

        // …and the copy still says the same thing, so this is a clone and not a reset.
        expect(editor).toEqual(shipped);
      });

      it(`does not reach into the language registry — ${label}`, () => {
        const map = parseAppSettings(raw).editor.indentByLanguage;
        expect(map, 'the map itself').not.toBe(SHIPPED_INDENT_BY_LANGUAGE);
        // Row by row too: `cloneIndentMap` is deep, so no profile is shared either.
        expect(map.go, 'the Go profile').not.toBe(SHIPPED_INDENT_BY_LANGUAGE.go);
        expect(map.go).toEqual(SHIPPED_INDENT_BY_LANGUAGE.go);
      });

      it(`survives a caller mutating what it was handed — ${label}`, () => {
        const editor = parseAppSettings(raw).editor;
        editor.indent.indentWidth = 99;
        editor.indentByLanguage.go = { style: 'spaces', indentWidth: 99, tabWidth: 99 };
        editor.languageByExtension['.mine'] = 'python';
        editor.navigation.rememberQuickOpenQuery = true;

        // The shipped defaults, the registry table, and the NEXT parse are all untouched.
        expect(DEFAULT_APP_SETTINGS.editor.indent.indentWidth).toBe(2);
        expect(SHIPPED_INDENT_BY_LANGUAGE.go).toEqual({ style: 'tabs', indentWidth: 4, tabWidth: 4 });
        expect(DEFAULT_APP_SETTINGS.editor.languageByExtension).toEqual({});
        expect(DEFAULT_APP_SETTINGS.editor.navigation.rememberQuickOpenQuery).toBe(false);
        expect(parseAppSettings(raw).editor).toEqual(DEFAULT_APP_SETTINGS.editor);
      });

      /*
       * The sweep the four named assertions above cannot do: a FIFTH object-valued member added to
       * `EditorSettings` later compiles fine without being added to `cloneEditor`, and would be
       * shared exactly as these three were. This test finds it without anyone remembering to.
       */
      it(`shares no object-valued member, named here or added later — ${label}`, () => {
        const editor = parseAppSettings(raw).editor as unknown as Record<string, unknown>;
        const shipped = DEFAULT_APP_SETTINGS.editor as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(editor)) {
          if (typeof value !== 'object' || value === null) continue;
          expect
            .soft(
              value,
              `editor.${key} is the SAME object as the shipped default — cloneEditor must re-clone it`,
            )
            .not.toBe(shipped[key]);
        }
      });
    }
  });
});
