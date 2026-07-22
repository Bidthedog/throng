/**
 * Plain-text files default to a four-space indent (user request), while still deferring to what a
 * file already does (FR-018d) — a tab-indented file stays tabs. Auto-indent on Enter (copying the
 * previous line) is CodeMirror's stock behaviour and is intentionally kept.
 */
import { describe, expect, it } from 'vitest';
import { effectiveIndent } from '../../src/editor/effective-indent.js';
import { SHIPPED_INDENT_BY_LANGUAGE, PLAIN_TEXT_ID } from '../../src/editor/languages.js';
import type { EditorSettings } from '../../src/config/app-settings.js';

const settings = {
  indent: { style: 'spaces', indentWidth: 2, tabWidth: 4 },
  indentByLanguage: SHIPPED_INDENT_BY_LANGUAGE,
} as unknown as EditorSettings;

describe('plain-text indentation', () => {
  it('ships a four-space default for plain text', () => {
    expect(SHIPPED_INDENT_BY_LANGUAGE[PLAIN_TEXT_ID]).toEqual({
      style: 'spaces',
      indentWidth: 4,
      tabWidth: 4,
    });
  });

  it('a fresh plain-text document indents with four spaces', () => {
    expect(effectiveIndent({ inferred: null, languageId: PLAIN_TEXT_ID, settings })).toEqual({
      style: 'spaces',
      indentWidth: 4,
      tabWidth: 4,
    });
  });

  it('still honours what a tab-indented plain-text file already does', () => {
    const p = effectiveIndent({
      inferred: { style: 'tabs', width: 4 },
      languageId: PLAIN_TEXT_ID,
      settings,
    });
    expect(p.style).toBe('tabs');
  });
});
