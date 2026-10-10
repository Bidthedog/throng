/**
 * 054 T055, T029, T037, T043 — the Previews settings audit (FR-050 – FR-055), the Render Mermaid
 * diagrams setting (FR-041) and the Mermaid provider's registration (FR-005, FR-006).
 *
 * The registries are hand-written for the generator rules (see `preview-settings.test.ts`'s note); the
 * shipped registry and `SETTINGS_METADATA` are asserted where the claim is about what ships.
 */
import { describe, expect, it } from 'vitest';
import {
  parsePreviewSettings,
  previewOpenTargetFor,
  previewSettingsDefaults,
  previewSettingsDescriptors,
} from '../../src/config/preview-settings.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import type { FieldDescriptor } from '../../src/config/metadata.js';
import type { PreviewProviderDescriptor, PreviewProviderRegistry } from '../../src/preview/provider.js';
import { SHIPPED_PREVIEW_PROVIDERS } from '../../src/preview/providers/index.js';

function registryOf(...providers: PreviewProviderDescriptor[]): PreviewProviderRegistry {
  return {
    list: () => providers,
    get: (id) => providers.find((p) => p.id === id),
    forPath: (path) => providers.find((p) => p.extensions.some((e) => path.toLowerCase().endsWith(e))),
  };
}

const notes: PreviewProviderDescriptor = {
  id: 'notes',
  displayName: 'Notes',
  extensions: ['.note'],
  kind: 'text',
  settings: [{ leaf: 'showOutline', label: 'Show outline', description: 'd', control: 'toggle', default: false }],
};
const sketch: PreviewProviderDescriptor = { id: 'sketch', displayName: 'Sketch', extensions: ['.sk'], kind: 'text' };
const image: PreviewProviderDescriptor = {
  id: 'image',
  displayName: 'Image',
  extensions: ['.png'],
  kind: 'binary',
  sourceMimeTypes: ['image/png'],
};
const REGISTRY = registryOf(notes, sketch, image);

describe('Open previews in is per provider (FR-051 – FR-053)', () => {
  it('ships lastActive on every text provider and no top-level leaf', () => {
    const d = previewSettingsDefaults(REGISTRY);
    expect(d.providers.notes?.openTarget).toBe('lastActive');
    expect(d.providers.sketch?.openTarget).toBe('lastActive');
    expect('openTarget' in (d.providers.image ?? {})).toBe(false);
    expect('openTarget' in d).toBe(false);
  });

  it('migrates a top-level openTarget to every text provider that has none of its own', () => {
    const s = parsePreviewSettings({ openTarget: 'new', providers: { sketch: { openTarget: 'lastActive' } } }, REGISTRY);
    expect(s.providers.notes?.openTarget).toBe('new');
    expect(s.providers.sketch?.openTarget).toBe('lastActive');
  });

  it('drops the retired top-level leaf from the parse output, so a write drops it (019 FR-023’s mechanism)', () => {
    expect('openTarget' in parsePreviewSettings({ openTarget: 'new' }, REGISTRY)).toBe(false);
  });

  it('is a no-op the second time', () => {
    const once = parsePreviewSettings({ openTarget: 'new', updateDelayMs: 10 }, REGISTRY);
    expect(parsePreviewSettings(once, REGISTRY)).toEqual(once);
  });

  it('falls back to lastActive for a bad value at either level', () => {
    const s = parsePreviewSettings({ openTarget: 'sideways', providers: { notes: { openTarget: 7 } } }, REGISTRY);
    expect(s.providers.notes?.openTarget).toBe('lastActive');
  });

  it('previewOpenTargetFor reads the file’s provider, and lastActive for a file no text provider claims', () => {
    const s = parsePreviewSettings({ providers: { notes: { openTarget: 'new' } } }, REGISTRY);
    expect(previewOpenTargetFor(REGISTRY, s, 'D:/p/a.NOTE')).toBe('new');
    expect(previewOpenTargetFor(REGISTRY, s, 'D:/p/a.sk')).toBe('lastActive');
    expect(previewOpenTargetFor(REGISTRY, s, 'D:/p/a.png')).toBe('lastActive');
    expect(previewOpenTargetFor(REGISTRY, s, 'D:/p/a.txt')).toBe('lastActive');
  });
});

describe('the Previews descriptors (FR-050 – FR-052)', () => {
  const descriptors = previewSettingsDescriptors(REGISTRY);
  const keys = descriptors.map((d) => d.key);

  it('keeps the shared leaves under Previews with no subsection, and describes no top-level openTarget', () => {
    for (const leaf of ['updateDelayMs', 'maxWaitMs', 'copyFormat', 'syncScroll']) {
      const d = descriptors.find((x) => x.key === `editor.previews.${leaf}`) as FieldDescriptor;
      expect(d).toMatchObject({ group: 'Editor', subgroup: 'Previews' });
      expect(d.subsection).toBeUndefined();
    }
    expect(keys).not.toContain('editor.previews.openTarget');
  });

  it('puts every provider leaf in a subsection named for the provider, in contract order', () => {
    const notesRows = descriptors.filter((d) => d.subsection === 'Notes').map((d) => d.key);
    expect(notesRows).toEqual([
      'editor.previews.providers.notes.enabled',
      'editor.previews.providers.notes.defaultOpenAction',
      'editor.previews.providers.notes.openTarget',
      'editor.previews.providers.notes.showOutline',
    ]);
    expect(descriptors.filter((d) => d.subsection === 'Image').map((d) => d.key)).toEqual([
      'editor.previews.providers.image.enabled',
    ]);
  });

  it('labels Open previews in with the provider name, disabled while the provider is off (FR-052)', () => {
    expect(descriptors.find((d) => d.key === 'editor.previews.providers.sketch.openTarget')).toMatchObject({
      label: 'Sketch: Open previews in',
      control: 'select',
      allowedValues: ['lastActive', 'new'],
      enabledWhen: { key: 'editor.previews.providers.sketch.enabled', is: true },
    });
  });

  it('says Find in Files results follow the default open action (T029, FR-030)', () => {
    const d = descriptors.find((x) => x.key === 'editor.previews.providers.notes.defaultOpenAction') as FieldDescriptor;
    expect(d.description).toContain('Find in Files');
    expect(d.description).not.toContain('Find in Files results and Open In always open an editor');
  });

  it('appends caller-supplied rows to a provider’s subsection, after its own', () => {
    const extra: FieldDescriptor = { key: 'editor.extra', label: 'Extra', description: 'd', group: 'Editor', control: 'toggle' };
    const rows = previewSettingsDescriptors(REGISTRY, { notes: [extra] });
    const placed = rows.find((d) => d.key === 'editor.extra');
    expect(placed).toMatchObject({ subgroup: 'Previews', subsection: 'Notes' });
    const notesRows = rows.filter((d) => d.subsection === 'Notes').map((d) => d.key);
    expect(notesRows.at(-1)).toBe('editor.extra');
  });
});

describe('what ships (FR-005, FR-041, FR-050)', () => {
  it('registers Mermaid as a text provider for .mmd and .mermaid', () => {
    expect(SHIPPED_PREVIEW_PROVIDERS.get('mermaid')).toMatchObject({
      displayName: 'Mermaid',
      extensions: ['.mmd', '.mermaid'],
      kind: 'text',
    });
    expect(SHIPPED_PREVIEW_PROVIDERS.forPath('D:/p/flow.MMD')?.id).toBe('mermaid');
    expect(SHIPPED_PREVIEW_PROVIDERS.list().map((p) => p.id)).toEqual(['markdown', 'mermaid']);
  });

  it('gives Markdown a Render Mermaid diagrams toggle, on by default', () => {
    expect(previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS).providers.markdown?.renderMermaid).toBe(true);
  });

  it('lays out Editor → Previews → Markdown and Mermaid in the contract order', () => {
    const inSubsection = (name: string) =>
      SETTINGS_METADATA.filter((d) => d.subgroup === 'Previews' && d.subsection === name).map((d) => d.label);
    expect(inSubsection('Markdown')).toEqual([
      'Markdown: Enabled',
      'Markdown: Default open action',
      'Markdown: Open previews in',
      'Markdown: Render Mermaid diagrams',
      'Markdown: Load remote images',
      'Markdown: Show front matter',
      'Markdown: Preview gutter',
      'Markdown: Heading jump scroll duration (ms)',
      'Markdown sections open',
    ]);
    expect(inSubsection('Mermaid')).toEqual(['Mermaid: Enabled', 'Mermaid: Default open action', 'Mermaid: Open previews in']);
  });

  it('keeps the Markdown sections open key (FR-054)', () => {
    expect(SETTINGS_METADATA.find((d) => d.label === 'Markdown sections open')?.key).toBe('editor.markdownSectionsOpen');
  });
});
