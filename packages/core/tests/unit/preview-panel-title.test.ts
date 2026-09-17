import { describe, it, expect } from 'vitest';
import { PREVIEW_TITLE_SUFFIX, panelDisplayTitle, previewTitleParts } from '../../src/workspace/panel-title.js';
import { PREVIEW_KIND } from '../../src/preview/panel-type.js';
import { countGraphemes } from '../../src/text/grapheme.js';
import type { Panel } from '../../src/workspace/model.js';

/**
 * 044 T011 — what a preview panel is called (FR-031, FR-032).
 *
 * The parent's display title is an INPUT: a preview stores no link to an editor (FR-013), so the
 * caller hands in whatever the parent currently shows, and this function only composes. The rule that
 * matters most is FR-032's — " - Preview" is the half of the name that says what the panel IS, so a
 * long file name gives way and the suffix never does.
 */

const preview = (over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id: 'pv1',
  originProjectId: 'proj',
  title: 'Panel 4',
  kind: PREVIEW_KIND,
  ...over,
});

describe('panelDisplayTitle — preview branch (FR-031)', () => {
  it('the suffix is " - Preview"', () => {
    expect(PREVIEW_TITLE_SUFFIX).toBe(' - Preview');
  });

  it('parented: <parent display title> - Preview, whatever that title is', () => {
    expect(panelDisplayTitle(preview(), { previewParentTitle: 'README' })).toBe('README - Preview');
    // A custom editor name is just a title the caller passes in.
    expect(panelDisplayTitle(preview(), { previewParentTitle: 'My Notes', previewFilePath: 'C:/p/README.md' })).toBe(
      'My Notes - Preview',
    );
  });

  it('standalone: the name an editor would derive for the file, - Preview', () => {
    expect(panelDisplayTitle(preview(), { previewFilePath: 'C:\\p\\docs\\guide.md' })).toBe('guide - Preview');
    expect(panelDisplayTitle(preview(), { previewParentTitle: null, previewFilePath: 'C:/p/.notes.md' })).toBe(
      '.notes - Preview',
    );
  });

  it('a blank parent title reads as standalone', () => {
    expect(panelDisplayTitle(preview(), { previewParentTitle: '   ', previewFilePath: 'C:/p/a.md' })).toBe('a - Preview');
  });

  it('with no live source, names itself from the persisted config — history’s current entry first', () => {
    expect(panelDisplayTitle(preview({ config: { filePath: 'C:/p/a.md' } }))).toBe('a - Preview');
    expect(
      panelDisplayTitle(
        preview({
          config: {
            filePath: 'C:/p/a.md',
            history: { v: 1, entries: [{ filePath: 'C:/p/b.md' }, { filePath: 'C:/p/c.md' }], index: 0 },
          },
        }),
      ),
    ).toBe('b - Preview');
  });

  it('falls back to the placeholder only when it has no file at all', () => {
    expect(panelDisplayTitle(preview())).toBe('Panel 4');
  });

  it('leaves every other kind exactly as it was', () => {
    const editor = preview({ kind: 'editor' });
    expect(panelDisplayTitle(editor, { previewParentTitle: 'X', editorFilePath: 'C:/p/a.ts' })).toBe('a');
  });
});

describe('panelDisplayTitle — preview truncation (FR-032)', () => {
  const SETTING_MAX = 128;
  const suffixLength = countGraphemes(PREVIEW_TITLE_SUFFIX);

  it('leaves a title that fits untouched', () => {
    expect(panelDisplayTitle(preview(), { previewParentTitle: 'README' }, 16)).toBe('README - Preview');
  });

  it('shortens the NAME part and keeps the suffix whole', () => {
    expect(panelDisplayTitle(preview(), { previewParentTitle: 'README' }, 12)).toBe('RE - Preview');
    expect(panelDisplayTitle(preview(), { previewFilePath: 'C:/p/a-very-long-file-name.md' }, 16)).toBe(
      'a-very - Preview',
    );
  });

  it(`never cuts " - Preview" at any limit from 1 to ${SETTING_MAX}, and never empties the name`, () => {
    const sources = [
      { previewParentTitle: 'x'.repeat(300) },
      { previewFilePath: `C:/p/${'long name '.repeat(30)}.md` },
      { previewParentTitle: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'.repeat(60) },
    ];
    for (const source of sources) {
      for (let limit = 1; limit <= SETTING_MAX; limit += 1) {
        const title = panelDisplayTitle(preview(), source, limit);
        const where = `limit ${limit}: ${JSON.stringify(title)}`;
        expect(title.endsWith(PREVIEW_TITLE_SUFFIX), where).toBe(true);
        const name = title.slice(0, -PREVIEW_TITLE_SUFFIX.length);
        expect(name.trim().length, where).toBeGreaterThan(0);
        // The whole title fits the limit wherever the limit leaves room for a name at all.
        if (limit > suffixLength) expect(countGraphemes(title), where).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('cuts only on a grapheme boundary', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const title = panelDisplayTitle(preview(), { previewParentTitle: family.repeat(10) }, suffixLength + 3);
    expect(title).toBe(`${family.repeat(3)}${PREVIEW_TITLE_SUFFIX}`);
  });
});

/**
 * FR-032 (amended) — where a truncation marker goes. The header draws its ellipsis as a CSS `::after`
 * on the title element, which would put it AFTER " - Preview" (`README - Preview…`) and read as if the
 * suffix had been cut. So the renderer needs the two halves apart: it marks the NAME, then appends the
 * suffix (`REA… - Preview`).
 */
describe('previewTitleParts — the name and suffix apart, for the marker (FR-032)', () => {
  it('splits a bounded preview title, saying whether the NAME was shortened', () => {
    expect(previewTitleParts(preview(), { previewParentTitle: 'README' }, 12)).toEqual({
      name: 'RE',
      suffix: PREVIEW_TITLE_SUFFIX,
      nameTruncated: true,
    });
    expect(previewTitleParts(preview(), { previewParentTitle: 'README' }, 16)).toEqual({
      name: 'README',
      suffix: PREVIEW_TITLE_SUFFIX,
      nameTruncated: false,
    });
    expect(previewTitleParts(preview(), { previewFilePath: 'C:/p/guide.md' })).toEqual({
      name: 'guide',
      suffix: PREVIEW_TITLE_SUFFIX,
      nameTruncated: false,
    });
  });

  it('at a limit no longer than the suffix, keeps one name character and marks it', () => {
    expect(previewTitleParts(preview(), { previewParentTitle: 'README' }, 10)).toEqual({
      name: 'R',
      suffix: PREVIEW_TITLE_SUFFIX,
      nameTruncated: true,
    });
    // A one-character name at that limit is whole, so nothing is marked.
    expect(previewTitleParts(preview(), { previewParentTitle: 'R' }, 10)?.nameTruncated).toBe(false);
  });

  it('is null wherever panelDisplayTitle does not compose a preview title', () => {
    expect(previewTitleParts(preview())).toBeNull(); // no file: the placeholder
    expect(previewTitleParts(preview({ kind: 'editor' }), { editorFilePath: 'C:/p/a.md' })).toBeNull();
    expect(previewTitleParts(preview({ titleIsCustom: true }), { previewParentTitle: 'README' })).toBeNull();
  });

  it('always agrees with panelDisplayTitle: name + suffix is the title, at every limit', () => {
    const sources = { previewParentTitle: 'a rather long parent editor name' };
    for (let limit = 1; limit <= 128; limit += 1) {
      const parts = previewTitleParts(preview(), sources, limit)!;
      expect(`${parts.name}${parts.suffix}`, `limit ${limit}`).toBe(panelDisplayTitle(preview(), sources, limit));
      expect(parts.nameTruncated, `limit ${limit}`).toBe(parts.name !== sources.previewParentTitle);
    }
  });
});
