import { describe, expect, it } from 'vitest';
import { THRONG_THEME } from '../../src/config/theme.js';
import { buildShippedDefaults } from '../../src/config/shipped-defaults.js';

/**
 * 060 FR-011a, FR-011b, FR-001a, SC-009 — the icon tokens Find in Files draws default to PLAIN glyphs.
 *
 * "Plain" is a Unicode property rather than a judgement: a glyph with neither `Extended_Pictographic`
 * nor `Emoji_Presentation` is drawn by every platform as a single-colour text symbol, and one with
 * either can come out as a colour emoji. The list is the panel's — its toolbar, its grouping controls
 * and its headings, including every token `fileIconToken` can return (research R17).
 */
const FIND_IN_FILES_TOKENS = [
  'search',
  'findInFiles',
  'file',
  'fileText',
  'fileCode',
  'fileJson',
  'fileMarkdown',
  'fileImage',
  'folder',
  'folderOpen',
  'groupFolderTree',
  'busy',
  // FR-011c — the File Explorer toolbar beside `findInFiles` goes plain with it.
  'quickOpen',
  'newFolder',
] as const;

const PICTOGRAPHIC = /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;

describe('the icons Find in Files draws are plain glyphs (FR-011a, SC-009)', () => {
  it.each(FIND_IN_FILES_TOKENS)('THRONG_THEME.icons.%s is not an emoji', (token) => {
    const glyph = THRONG_THEME.icons[token];
    expect(glyph, token).toBeTruthy();
    expect(PICTOGRAPHIC.test(glyph!), `${token} = ${glyph}`).toBe(false);
  });

  it('holds in every bundled theme, so a re-skin cannot bring an emoji back', () => {
    for (const [name, theme] of Object.entries(buildShippedDefaults().themes)) {
      for (const token of FIND_IN_FILES_TOKENS) {
        const glyph = theme.icons[token] ?? '';
        expect(PICTOGRAPHIC.test(glyph), `${name}.${token} = ${glyph}`).toBe(false);
      }
    }
  });
});

describe('the File Explorer toolbar reads at one weight (FR-011c, superseding 043 FR-065)', () => {
  it('keeps the three searches three different glyphs', () => {
    const { search, quickOpen, findInFiles } = THRONG_THEME.icons;
    expect(new Set([search, quickOpen, findInFiles]).size).toBe(3);
  });
});

describe('the two glyphs the maintainer chose', () => {
  it('busy is ◜, the quarter arc every loading indicator draws (FR-001a)', () => {
    expect(THRONG_THEME.icons.busy).toBe('◜');
  });

  it('groupFolderTree is ⋔, the fork (FR-011b)', () => {
    expect(THRONG_THEME.icons.groupFolderTree).toBe('⋔');
  });
});
