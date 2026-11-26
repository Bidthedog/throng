/**
 * 074 FR-016 – FR-019 (contracts/open-in-preference.md) — one "Open <files> in" preference for EVERY preview
 * provider, text and binary, at the existing `defaultOpenAction` key, offering Throng Editor / Throng Preview /
 * Default OS Program (a binary provider has no editor). Supersedes 044 FR-050's label and options and FR-051's
 * "a binary provider has no setting".
 */
import { describe, expect, it } from 'vitest';
import {
  defaultOpenActionFor,
  offeredOpenActions,
  parsePreviewSettings,
  previewOpenTargetFor,
  previewSettingsDefaults,
  previewSettingsDescriptors,
} from '../../src/config/preview-settings.js';
import type { PreviewProviderDescriptor, PreviewProviderRegistry } from '../../src/preview/provider.js';
import { SHIPPED_PREVIEW_PROVIDERS } from '../../src/preview/providers/index.js';

function registryOf(...providers: PreviewProviderDescriptor[]): PreviewProviderRegistry {
  return {
    list: () => providers,
    get: (id) => providers.find((p) => p.id === id),
    forPath: (path) => providers.find((p) => p.extensions.some((e) => path.toLowerCase().endsWith(e))),
  };
}

const notes: PreviewProviderDescriptor = { id: 'notes', displayName: 'Notes', extensions: ['.note'], kind: 'text' };
const photo: PreviewProviderDescriptor = {
  id: 'photo',
  displayName: 'Photo',
  extensions: ['.png'],
  kind: 'binary',
  sourceMimeTypes: ['image/png'],
  filesNoun: 'photos',
};
const grid: PreviewProviderDescriptor = {
  id: 'grid',
  displayName: 'Grid',
  extensions: ['.grid'],
  kind: 'text',
  defaultOpenAction: 'preview',
  filesNoun: 'grids',
  previewOptionLabel: 'Throng Preview Editor',
};
const REGISTRY = registryOf(notes, photo, grid);
const key = (id: string, leaf: string): string => `editor.previews.providers.${id}.${leaf}`;
const row = (id: string) => previewSettingsDescriptors(REGISTRY).find((d) => d.key === key(id, 'defaultOpenAction'));

describe('Open <files> in — descriptors (FR-016, FR-017)', () => {
  it('words a text provider "Open <displayName> files in" with all three options', () => {
    const d = row('notes');
    expect(d?.label).toBe('Open Notes files in');
    expect(d?.control).toBe('select');
    expect(d?.allowedValues).toEqual(['editor', 'preview', 'os']);
    expect(d?.optionLabels).toEqual({ editor: 'Throng Editor', preview: 'Throng Preview', os: 'Default OS Program' });
    expect(d?.enabledWhen).toEqual({ key: key('notes', 'enabled'), is: true });
    expect(d?.subsection).toBe('Notes');
  });

  it('gives a BINARY provider the row too, without the editor option (supersedes 044 FR-051)', () => {
    const d = row('photo');
    expect(d?.label).toBe('Open photos in');
    expect(d?.allowedValues).toEqual(['preview', 'os']);
    expect(d?.optionLabels).toEqual({ preview: 'Throng Preview', os: 'Default OS Program' });
  });

  it("uses a provider's own preview option label", () => {
    expect(row('grid')?.optionLabels?.preview).toBe('Throng Preview Editor');
  });

  // 080 FR-013 — the options name themselves; what each does, and Open In's exception, live in the reference.
  it('says where the files open from', () => {
    const description = row('notes')?.description ?? '';
    expect(description).toBe('Where Notes files open from File Explorer, Quick Open, links and Find in Files.');
  });

  it('gives a binary provider Open previews in as well', () => {
    expect(previewSettingsDescriptors(REGISTRY).map((d) => d.key)).toContain(key('photo', 'openTarget'));
  });

  it('words every SHIPPED provider the same way', () => {
    const labels = previewSettingsDescriptors(SHIPPED_PREVIEW_PROVIDERS)
      .filter((d) => d.key.endsWith('.defaultOpenAction'))
      .map((d) => d.label);
    expect(labels.length).toBe(SHIPPED_PREVIEW_PROVIDERS.list().length);
    for (const label of labels) expect(label).toMatch(/^Open .+ in$/);
    expect(labels).toContain('Open Markdown files in');
    expect(labels).toContain('Open Mermaid files in');
  });
});

describe('Open <files> in — defaults and parse (FR-016)', () => {
  it('ships editor for a text provider, preview for a binary one, and a declared value over either', () => {
    const d = previewSettingsDefaults(REGISTRY);
    expect(d.providers.notes?.defaultOpenAction).toBe('editor');
    expect(d.providers.photo?.defaultOpenAction).toBe('preview');
    expect(d.providers.grid?.defaultOpenAction).toBe('preview');
    expect(d.providers.photo?.openTarget).toBe('lastActive');
  });

  it('keeps every offered value, os included', () => {
    const parsed = parsePreviewSettings(
      { providers: { notes: { defaultOpenAction: 'os' }, photo: { defaultOpenAction: 'os' } } },
      REGISTRY,
    );
    expect(parsed.providers.notes?.defaultOpenAction).toBe('os');
    expect(parsed.providers.photo?.defaultOpenAction).toBe('os');
  });

  it('reads a value the provider does not offer as its shipped value', () => {
    const parsed = parsePreviewSettings(
      { providers: { photo: { defaultOpenAction: 'editor' }, notes: { defaultOpenAction: 'nonsense' } } },
      REGISTRY,
    );
    expect(parsed.providers.photo?.defaultOpenAction).toBe('preview');
    expect(parsed.providers.notes?.defaultOpenAction).toBe('editor');
  });

  it('parses its own output to the same value (idempotent)', () => {
    const once = parsePreviewSettings({ providers: { photo: { defaultOpenAction: 'os', openTarget: 'new' } } }, REGISTRY);
    expect(parsePreviewSettings(once, REGISTRY)).toEqual(once);
  });

  it('offers editor only to text providers', () => {
    expect(offeredOpenActions(notes)).toEqual(['editor', 'preview', 'os']);
    expect(offeredOpenActions(photo)).toEqual(['preview', 'os']);
  });
});

describe('defaultOpenActionFor and previewOpenTargetFor (FR-018)', () => {
  it('answers os when an enabled provider says so', () => {
    const s = parsePreviewSettings({ providers: { photo: { defaultOpenAction: 'os' } } }, REGISTRY);
    expect(defaultOpenActionFor(REGISTRY, s, '/p/a.png')).toBe('os');
  });

  it('answers editor while that provider is disabled, keeping the stored os', () => {
    const s = parsePreviewSettings({ providers: { photo: { enabled: false, defaultOpenAction: 'os' } } }, REGISTRY);
    expect(defaultOpenActionFor(REGISTRY, s, '/p/a.png')).toBe('editor');
    expect(s.providers.photo?.defaultOpenAction).toBe('os');
  });

  it("reads a binary provider's own Open previews in", () => {
    const s = parsePreviewSettings({ providers: { photo: { openTarget: 'new' } } }, REGISTRY);
    expect(previewOpenTargetFor(REGISTRY, s, '/p/a.png')).toBe('new');
  });
});
