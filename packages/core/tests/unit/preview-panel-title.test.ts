import { describe, it, expect } from 'vitest';
import { PREVIEW_TITLE_SUFFIX, panelDisplayTitle, previewTitleParts } from '../../src/workspace/panel-title.js';
import { PREVIEW_KIND } from '../../src/preview/panel-type.js';
import { countGraphemes } from '../../src/text/grapheme.js';
import type { Panel } from '../../src/workspace/model.js';
import type { PanelTitleSources } from '../../src/workspace/panel-title.js';

/**
 * 044 T011 — what a preview panel is called (FR-031, FR-032).
 *
 * The parent's display title is an INPUT: a preview stores no link to an editor (FR-013), so the
 * caller hands in whatever the parent currently shows, and this function only composes. The rule that
 * matters most is FR-032's — the suffix is the half of the name that says what the panel IS, so a
 * long file name gives way and the suffix never does. 074 FR-104 names the type in it:
 * `<name> - Markdown Preview`, falling back to " - Preview" only where no provider is known.
 */

const preview = (over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id: 'pv1',
  originProjectId: 'proj',
  title: 'Panel 4',
  kind: PREVIEW_KIND,
  ...over,
});

describe('panelDisplayTitle — preview branch (054 FR-005a, superseding 044 FR-031)', () => {
  it('the generic suffix, for a preview whose type is unknown, is " - Preview"', () => {
    expect(PREVIEW_TITLE_SUFFIX).toBe(' - Preview');
  });

  it('names the file by its full file name, extension included', () => {
    expect(panelDisplayTitle(preview(), { previewFilePath: 'C:\\p\\docs\\guide.md' })).toBe(
      'guide.md - Markdown Preview',
    );
    expect(panelDisplayTitle(preview(), { previewFilePath: 'C:/p/flow.mmd' })).toBe('flow.mmd - Mermaid Preview');
    expect(panelDisplayTitle(preview(), { previewParentTitle: null, previewFilePath: 'C:/p/.notes.md' })).toBe(
      '.notes.md - Markdown Preview',
    );
  });

  it('parented: the file name too, whatever the parent editor is called', () => {
    expect(panelDisplayTitle(preview(), { previewParentTitle: 'My Notes', previewFilePath: 'C:/p/README.md' })).toBe(
      'README.md - Markdown Preview',
    );
  });

  it('parented to an editor with no file yet: the editor’s name, and the generic suffix while no type is known', () => {
    expect(panelDisplayTitle(preview(), { previewParentTitle: 'README' })).toBe('README - Preview');
    expect(
      panelDisplayTitle(preview(), { previewParentTitle: 'README', previewTypeLabel: 'Markdown Preview' }),
    ).toBe('README - Markdown Preview');
  });

  it('a blank parent title is ignored', () => {
    expect(panelDisplayTitle(preview(), { previewParentTitle: '   ', previewFilePath: 'C:/p/a.md' })).toBe(
      'a.md - Markdown Preview',
    );
  });

  it('with no live source, names itself from the persisted config — history’s current entry first', () => {
    expect(panelDisplayTitle(preview({ config: { filePath: 'C:/p/a.md' } }))).toBe('a.md - Markdown Preview');
    expect(
      panelDisplayTitle(
        preview({
          config: {
            filePath: 'C:/p/a.md',
            history: { v: 1, entries: [{ filePath: 'C:/p/b.md' }, { filePath: 'C:/p/c.md' }], index: 0 },
          },
        }),
      ),
    ).toBe('b.md - Markdown Preview');
  });

  /** 074 FR-104 — `<name> - <Type> Preview`, `<Type>` the provider's display name (superseding 044 FR-031's suffix). */
  it.each([
    ['C:/p/notes.md', 'notes.md - Markdown Preview'],
    ['C:/p/flow.mermaid', 'flow.mermaid - Mermaid Preview'],
    ['C:/p/photo.png', 'photo.png - Image Preview'],
    ['C:/p/logo.svg', 'logo.svg - SVG Preview'],
    ['C:/p/manual.pdf', 'manual.pdf - PDF Preview'],
    ['C:/p/index.html', 'index.html - HTML Preview'],
  ])('names the type of a preview of %s (074 FR-104)', (filePath, title) => {
    expect(panelDisplayTitle(preview(), { previewFilePath: filePath })).toBe(title);
    expect(panelDisplayTitle(preview({ config: { filePath } }))).toBe(title);
  });

  it('takes the type the caller hands in over the one the file’s extension implies (the run’s provider)', () => {
    expect(
      panelDisplayTitle(preview(), { previewFilePath: 'C:/p/notes.prvtxt', previewTypeLabel: 'Test text Preview' }),
    ).toBe('notes.prvtxt - Test text Preview');
  });

  it('takes the persisted provider over the file’s extension when no type is handed in', () => {
    expect(panelDisplayTitle(preview({ config: { filePath: 'C:/p/a.txt', providerId: 'markdown' } }))).toBe(
      'a.txt - Markdown Preview',
    );
  });

  it('falls back to the generic suffix for a file no shipped provider claims', () => {
    expect(panelDisplayTitle(preview(), { previewFilePath: 'C:/p/notes.prvtxt' })).toBe('notes.prvtxt - Preview');
  });

  it('falls back to the placeholder only when it has no file at all', () => {
    expect(panelDisplayTitle(preview())).toBe('Blank Panel') // 048 FR-130: a generated fallback shows unnumbered;
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
    expect(panelDisplayTitle(preview(), { previewFilePath: 'C:/p/a-very-long-file-name.md' }, 25)).toBe(
      'a-very - Markdown Preview',
    );
  });

  it(`never cuts the suffix at any limit from 1 to ${SETTING_MAX}, and never empties the name (074 FR-104 keeps 044 FR-032)`, () => {
    const sources: [PanelTitleSources, string][] = [
      [{ previewParentTitle: 'x'.repeat(300) }, PREVIEW_TITLE_SUFFIX],
      [{ previewFilePath: `C:/p/${'long name '.repeat(30)}.md` }, ' - Markdown Preview'],
      [{ previewFilePath: `C:/p/${'long name '.repeat(30)}.pdf` }, ' - PDF Preview'],
      [{ previewParentTitle: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'.repeat(60) }, PREVIEW_TITLE_SUFFIX],
    ];
    for (const [source, suffix] of sources) {
      for (let limit = 1; limit <= SETTING_MAX; limit += 1) {
        const title = panelDisplayTitle(preview(), source, limit);
        const where = `limit ${limit}: ${JSON.stringify(title)}`;
        expect(title.endsWith(suffix), where).toBe(true);
        const name = title.slice(0, -suffix.length);
        expect(name.trim().length, where).toBeGreaterThan(0);
        // The whole title fits the limit wherever the limit leaves room for a name at all.
        if (limit > countGraphemes(suffix)) expect(countGraphemes(title), where).toBeLessThanOrEqual(limit);
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
      name: 'guide.md',
      suffix: ' - Markdown Preview',
      nameTruncated: false,
    });
    expect(previewTitleParts(preview(), { previewFilePath: 'C:/p/a-long-image-name.png' }, 22)).toEqual({
      name: 'a-long',
      suffix: ' - Image Preview',
      nameTruncated: true,
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
    // 048 FR-032: a leftover custom-title flag no longer suppresses the preview's derived title.
    const legacy = { ...preview(), titleIsCustom: true } as unknown as Parameters<typeof previewTitleParts>[0];
    expect(previewTitleParts(legacy, { previewParentTitle: 'README' })?.name).toBe('README');
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
