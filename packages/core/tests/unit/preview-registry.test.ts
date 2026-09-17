import { describe, it, expect } from 'vitest';
import {
  createPreviewProviderRegistry,
  enabledProviderFor,
  previewAffordance,
  providerFor,
} from '../../src/preview/registry.js';
import {
  SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
  SHIPPED_PREVIEW_PROVIDERS,
} from '../../src/preview/providers/index.js';
import type { PreviewProviderDescriptor } from '../../src/preview/provider.js';
import type { PreviewSettings } from '../../src/preview/settings-types.js';

/**
 * 044 T005 — the provider registry and the one decision every preview affordance is drawn from.
 *
 * The registry is the FR-070 seam: a surface asks it, never names a provider. So the rules pinned here
 * are the whole of what "a file has a preview" means — the extension match, the enabled filter, and
 * the six-row affordance table of data-model §2, in its first-match-wins order.
 */

const text = (over: Partial<PreviewProviderDescriptor> = {}): PreviewProviderDescriptor => ({
  id: 'notes',
  displayName: 'Notes',
  extensions: ['.note'],
  kind: 'text',
  ...over,
});

const binary = (over: Partial<PreviewProviderDescriptor> = {}): PreviewProviderDescriptor => ({
  id: 'pdf',
  displayName: 'PDF',
  extensions: ['.pdf'],
  kind: 'binary',
  sourceMimeTypes: ['application/pdf'],
  ...over,
});

const settings = (providers: Record<string, boolean>): PreviewSettings => ({
  updateDelayMs: 300,
  maxWaitMs: 1000,
  copyFormat: 'rich',
  syncScroll: true,
  providers: Object.fromEntries(
    Object.entries(providers).map(([id, enabled]) => [id, { enabled }]),
  ),
});

describe('createPreviewProviderRegistry — registration validation (FR-071, FR-072)', () => {
  it('throws naming BOTH providers when two claim one extension (FR-072)', () => {
    const markdown = text({ id: 'markdown', extensions: ['.md', '.markdown'] });
    const notes = text({ id: 'notes', extensions: ['.md'] });
    expect(() => createPreviewProviderRegistry([markdown, notes])).toThrowError(
      'Preview providers "markdown" and "notes" both claim ".md"',
    );
  });

  it('accepts providers whose extensions are disjoint', () => {
    const r = createPreviewProviderRegistry([text(), binary()]);
    expect(r.list().map((p) => p.id)).toEqual(['notes', 'pdf']);
    expect(r.get('pdf')?.displayName).toBe('PDF');
    expect(r.get('nope')).toBeUndefined();
  });

  it('rejects a duplicate id', () => {
    expect(() =>
      createPreviewProviderRegistry([text(), text({ extensions: ['.other'] })]),
    ).toThrowError(/notes/);
  });

  it.each(['Markdown', '1md', 'mark-down', ''])('rejects the malformed id %j', (id) => {
    expect(() => createPreviewProviderRegistry([text({ id })])).toThrowError();
  });

  it('rejects an empty extension list', () => {
    expect(() => createPreviewProviderRegistry([text({ extensions: [] })])).toThrowError(/notes/);
  });

  it.each(['md', '.MD', '.', '. md'])('rejects the malformed extension %j', (ext) => {
    expect(() => createPreviewProviderRegistry([text({ extensions: [ext] })])).toThrowError();
  });

  it('rejects a setting leaf declared twice, or named enabled / defaultOpenAction', () => {
    const toggle = (leaf: string) =>
      ({ leaf, label: 'L', description: 'D', control: 'toggle', default: true }) as const;
    expect(() =>
      createPreviewProviderRegistry([text({ settings: [toggle('a'), toggle('a')] })]),
    ).toThrowError();
    expect(() => createPreviewProviderRegistry([text({ settings: [toggle('enabled')] })])).toThrowError();
    expect(() =>
      createPreviewProviderRegistry([text({ settings: [toggle('defaultOpenAction')] })]),
    ).toThrowError();
  });

  it('rejects a remoteImagesSetting that names no toggle', () => {
    const select = {
      leaf: 'mode',
      label: 'L',
      description: 'D',
      control: 'select',
      default: 'a',
      allowedValues: ['a'],
    } as const;
    expect(() =>
      createPreviewProviderRegistry([text({ settings: [select], remoteImagesSetting: 'mode' })]),
    ).toThrowError();
    expect(() => createPreviewProviderRegistry([text({ remoteImagesSetting: 'absent' })])).toThrowError();
  });

  it('rejects sourceMimeTypes on a text provider, and their absence on a binary one', () => {
    expect(() =>
      createPreviewProviderRegistry([text({ sourceMimeTypes: ['text/plain'] })]),
    ).toThrowError();
    expect(() =>
      createPreviewProviderRegistry([binary({ sourceMimeTypes: undefined })]),
    ).toThrowError();
  });
});

describe('forPath / providerFor — by extension only, case-insensitively', () => {
  const r = createPreviewProviderRegistry([
    text({ id: 'markdown', extensions: ['.md', '.markdown'] }),
    binary(),
  ]);

  it('matches either separator and any case of the extension', () => {
    expect(r.forPath('C:\\p\\README.md')?.id).toBe('markdown');
    expect(r.forPath('C:/p/notes.MARKDOWN')?.id).toBe('markdown');
    expect(r.forPath('/p/Guide.Md')?.id).toBe('markdown');
    expect(providerFor(r, 'D:/docs/spec.PDF')?.id).toBe('pdf');
  });

  it('matches nothing for an unclaimed extension, no extension, or an extension in a FOLDER name', () => {
    expect(r.forPath('C:/p/a.txt')).toBeUndefined();
    expect(r.forPath('C:/p/Makefile')).toBeUndefined();
    expect(r.forPath('C:/p/folder.md/file.txt')).toBeUndefined();
    expect(providerFor(r, 'C:/p/a.mdx')).toBeUndefined();
  });

  it('does not treat a dotfile named after the extension as having that extension', () => {
    expect(r.forPath('C:/p/.md')).toBeUndefined();
  });
});

describe('enabledProviderFor — the provider only while it is enabled (FR-062)', () => {
  const r = createPreviewProviderRegistry([text()]);

  it('returns the provider when enabled', () => {
    expect(enabledProviderFor(r, settings({ notes: true }), 'C:/p/a.note')?.id).toBe('notes');
  });

  it('returns undefined when disabled, unclaimed, or absent from settings', () => {
    expect(enabledProviderFor(r, settings({ notes: false }), 'C:/p/a.note')).toBeUndefined();
    expect(enabledProviderFor(r, settings({ notes: true }), 'C:/p/a.txt')).toBeUndefined();
    expect(enabledProviderFor(r, settings({}), 'C:/p/a.note')).toBeUndefined();
  });
});

describe('previewAffordance — the six-row decision table (data-model §2)', () => {
  const r = createPreviewProviderRegistry([text(), binary()]);
  const on = settings({ notes: true, pdf: true });
  const base = {
    registry: r,
    settings: on,
    absPath: 'C:/proj/docs/a.note' as string | undefined,
    projectRoot: 'C:/proj' as string | undefined,
    isFolder: false,
    previewOpen: false,
    surface: 'editor' as 'editor' | 'explorer',
  };

  it('row 1: absent for an editor with no file on disk (FR-004)', () => {
    expect(previewAffordance({ ...base, absPath: undefined })).toEqual({ state: 'absent' });
  });

  it('row 1: absent for a folder (FR-003)', () => {
    expect(
      previewAffordance({ ...base, absPath: 'C:/proj/docs.note', isFolder: true, surface: 'explorer' }),
    ).toEqual({ state: 'absent' });
  });

  it('row 1: absent for a file outside the project, or with no project at all (FR-004)', () => {
    expect(previewAffordance({ ...base, absPath: 'C:/other/a.note' })).toEqual({ state: 'absent' });
    // A segment boundary, not a string prefix.
    expect(previewAffordance({ ...base, absPath: 'C:/project-two/a.note' , projectRoot: 'C:/proj' })).toEqual({
      state: 'absent',
    });
    expect(previewAffordance({ ...base, projectRoot: undefined })).toEqual({ state: 'absent' });
  });

  it('row 1 outranks everything: an outside file is absent even while its preview is open', () => {
    expect(
      previewAffordance({ ...base, absPath: 'C:/other/a.note', previewOpen: true }),
    ).toEqual({ state: 'absent' });
  });

  it('row 2: absent when no provider claims the extension (FR-001, FR-003)', () => {
    expect(previewAffordance({ ...base, absPath: 'C:/proj/a.txt' })).toEqual({ state: 'absent' });
    expect(
      previewAffordance({ ...base, absPath: 'C:/proj/a.txt', surface: 'explorer' }),
    ).toEqual({ state: 'absent' });
  });

  it('row 3: absent for a binary provider on the editor surface only (FR-073)', () => {
    expect(previewAffordance({ ...base, absPath: 'C:/proj/a.pdf' })).toEqual({ state: 'absent' });
    const explorer = previewAffordance({ ...base, absPath: 'C:/proj/a.pdf', surface: 'explorer' });
    expect(explorer.state).toBe('enabled');
  });

  it('row 4: DISABLED, not absent, while the provider is disabled (FR-001, FR-003, FR-062)', () => {
    const off = settings({ notes: false, pdf: true });
    const result = previewAffordance({ ...base, settings: off });
    expect(result).toEqual({ state: 'disabled', reason: 'provider-disabled', provider: r.get('notes') });
    // Row 4 outranks row 5: a disabled provider says so even while a preview happens to be open.
    expect(previewAffordance({ ...base, settings: off, previewOpen: true })).toEqual({
      state: 'disabled',
      reason: 'provider-disabled',
      provider: r.get('notes'),
    });
  });

  it('row 5: disabled with preview-open while a preview of the file is open (FR-012)', () => {
    expect(previewAffordance({ ...base, previewOpen: true })).toEqual({
      state: 'disabled',
      reason: 'preview-open',
      provider: r.get('notes'),
    });
  });

  it('row 6: enabled otherwise, on both surfaces', () => {
    expect(previewAffordance(base)).toEqual({ state: 'enabled', provider: r.get('notes') });
    expect(previewAffordance({ ...base, surface: 'explorer' })).toEqual({
      state: 'enabled',
      provider: r.get('notes'),
    });
  });

  it('tolerates mixed separators and case between the path and the root', () => {
    expect(
      previewAffordance({ ...base, absPath: 'c:\\PROJ\\docs\\a.note', projectRoot: 'C:/proj/' }).state,
    ).toBe('enabled');
  });
});

describe('the shipped registration (FR-065, FR-080)', () => {
  it('registers exactly Markdown, for .md and .markdown, as a text provider', () => {
    expect(SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS.map((p) => p.id)).toEqual(['markdown']);
    const md = SHIPPED_PREVIEW_PROVIDERS.get('markdown');
    expect(md?.kind).toBe('text');
    expect(md?.extensions).toEqual(['.md', '.markdown']);
    expect(SHIPPED_PREVIEW_PROVIDERS.forPath('C:/p/README.md')).toBe(md);
  });

  it('declares its own Load remote images toggle, shipping on, and names it as the remote-image switch (FR-092)', () => {
    const md = SHIPPED_PREVIEW_PROVIDERS.get('markdown')!;
    const toggle = md.settings?.find((s) => s.leaf === 'loadRemoteImages');
    expect(toggle).toMatchObject({ label: 'Load remote images', control: 'toggle', default: true });
    expect(toggle?.description.trim().length).toBeGreaterThan(0);
    expect(md.remoteImagesSetting).toBe('loadRemoteImages');
    expect(md.sourceMimeTypes).toBeUndefined();
  });

  it('declares exactly its two own settings, Load remote images then Show front matter, both toggles shipping on (FR-092, FR-117)', () => {
    const md = SHIPPED_PREVIEW_PROVIDERS.get('markdown')!;
    expect(md.settings?.map((s) => s.leaf)).toEqual(['loadRemoteImages', 'showFrontMatter']);
    const frontMatter = md.settings?.find((s) => s.leaf === 'showFrontMatter');
    expect(frontMatter).toMatchObject({ label: 'Show front matter', control: 'toggle', default: true });
    expect(frontMatter?.description.trim().length).toBeGreaterThan(0);
  });
});
