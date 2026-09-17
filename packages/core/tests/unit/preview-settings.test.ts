/**
 * `editor.previews` — the defaults, descriptors and parse generated from a provider registry (044,
 * data-model §3, contracts/settings-bindings-tokens.md).
 *
 * ══ WHY THE REGISTRIES HERE ARE HAND-WRITTEN OBJECT LITERALS ══
 *
 * Every function under test takes the registry as a parameter, and that is the FR-070/FR-071 claim:
 * a provider's settings follow from its registration, with no settings module naming it. So the
 * registries below are plain objects implementing `PreviewProviderRegistry` — never
 * `createPreviewProviderRegistry` — which keeps these tests about the settings derivation alone and
 * lets a text provider with its own toggle sit beside a binary one, a shape the shipped registry
 * (Markdown alone) cannot show.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultOpenActionFor,
  effectiveMaxWaitMs,
  parsePreviewSettings,
  previewSettingsDefaults,
  previewSettingsDescriptors,
  providersTurnedOff,
  remoteImagesPermitted,
} from '../../src/config/preview-settings.js';
import { auditRegistry, leavesOfDeclared, type FieldDescriptor } from '../../src/config/metadata.js';
import type {
  PreviewProviderDescriptor,
  PreviewProviderRegistry,
} from '../../src/preview/provider.js';
import { markdownProvider } from '../../src/preview/providers/markdown.js';
import type { PreviewSettings } from '../../src/preview/settings-types.js';

/** A registry over `providers`, matching by extension — enough of the interface for settings. */
function registryOf(...providers: PreviewProviderDescriptor[]): PreviewProviderRegistry {
  return {
    list: () => providers,
    get: (id) => providers.find((p) => p.id === id),
    forPath: (path) => {
      const lower = path.toLowerCase();
      return providers.find((p) => p.extensions.some((e) => lower.endsWith(e)));
    },
  };
}

const markdown: PreviewProviderDescriptor = {
  id: 'markdown',
  displayName: 'Markdown',
  extensions: ['.md', '.markdown'],
  kind: 'text',
  settings: [
    {
      leaf: 'loadRemoteImages',
      label: 'Load remote images',
      description: 'Load https images.',
      control: 'toggle',
      default: true,
    },
    {
      leaf: 'showFrontMatter',
      label: 'Show front matter',
      description: 'Show the front matter block.',
      control: 'toggle',
      default: true,
    },
  ],
  remoteImagesSetting: 'loadRemoteImages',
};

/** A second text provider with ONE own toggle and no remote-images setting. */
const notes: PreviewProviderDescriptor = {
  id: 'notes',
  displayName: 'Notes',
  extensions: ['.note'],
  kind: 'text',
  settings: [
    {
      leaf: 'showOutline',
      label: 'Show outline',
      description: 'Draw an outline beside the note.',
      control: 'toggle',
      default: false,
    },
  ],
};

const image: PreviewProviderDescriptor = {
  id: 'image',
  displayName: 'Image',
  extensions: ['.png'],
  kind: 'binary',
  sourceMimeTypes: ['image/png'],
};

const SHIPPED_LIKE = registryOf(markdown);
/** The SC-003 S5 registry: one text provider with one own toggle, and one binary provider. */
const TEST_REGISTRY = registryOf(notes, image);

const byKey = (descriptors: readonly FieldDescriptor[], key: string): FieldDescriptor => {
  const found = descriptors.find((d) => d.key === key);
  expect(found, `no descriptor for ${key}`).toBeDefined();
  return found!;
};

describe('previewSettingsDefaults (FR-035b, FR-050, FR-060, FR-060a, FR-065, FR-092)', () => {
  it('ships 300 / 1000 / rich / sync on, and Markdown enabled, opening in an editor, loading remote images, showing front matter', () => {
    expect(previewSettingsDefaults(SHIPPED_LIKE)).toEqual({
      updateDelayMs: 300,
      maxWaitMs: 1000,
      copyFormat: 'rich',
      // FR-114 — ships on.
      syncScroll: true,
      providers: {
        markdown: { enabled: true, defaultOpenAction: 'editor', loadRemoteImages: true, showFrontMatter: true },
      },
    });
  });

  it('ships syncScroll on for any registry, since it belongs to no provider (FR-114)', () => {
    expect(previewSettingsDefaults(TEST_REGISTRY).syncScroll).toBe(true);
  });

  it('gives a binary provider no defaultOpenAction leaf (FR-051)', () => {
    const d = previewSettingsDefaults(TEST_REGISTRY);
    expect(d.providers.image).toEqual({ enabled: true });
    expect('defaultOpenAction' in d.providers.image).toBe(false);
    expect(d.providers.notes).toEqual({ enabled: true, defaultOpenAction: 'editor', showOutline: false });
  });

  it('hands out a fresh object each call, so no caller can edit another caller’s defaults', () => {
    const a = previewSettingsDefaults(SHIPPED_LIKE);
    const b = previewSettingsDefaults(SHIPPED_LIKE);
    expect(a.providers).not.toBe(b.providers);
    expect(a.providers.markdown).not.toBe(b.providers.markdown);
  });
});

describe('previewSettingsDescriptors (FR-051, FR-061, FR-071)', () => {
  const descriptors = previewSettingsDescriptors(SHIPPED_LIKE);

  it('files every descriptor under Editor → Previews', () => {
    expect(descriptors.length).toBeGreaterThan(0);
    for (const d of descriptors) {
      expect(d.group, d.key).toBe('Editor');
      expect(d.subgroup, d.key).toBe('Previews');
      expect(d.label.length, d.key).toBeGreaterThan(0);
      expect(d.description.length, d.key).toBeGreaterThan(0);
    }
  });

  it('describes the three static leaves with the contract’s controls and ranges', () => {
    const delay = byKey(descriptors, 'editor.previews.updateDelayMs');
    expect(delay).toMatchObject({ control: 'slider', min: 0, max: 5000 });
    const wait = byKey(descriptors, 'editor.previews.maxWaitMs');
    expect(wait).toMatchObject({ control: 'slider', min: 0, max: 10000 });
    const copy = byKey(descriptors, 'editor.previews.copyFormat');
    expect(copy.control).toBe('select');
    expect(copy.allowedValues).toEqual(['rich', 'plain']);
    expect(copy.optionLabels).toEqual({ rich: 'Rich text', plain: 'Plain text' });
  });

  /*
   * 2026-09-15 iteration (FR-113, FR-114). NO `enabledWhen`: scroll sync applies to every text
   * provider and is gated by none of them, so drawing it disabled while Markdown is off would suspend
   * a setting that still governs every other provider.
   */
  it('describes syncScroll as a toggle labelled "Synchronise preview and editor scrolling", never disabled by a provider (FR-114)', () => {
    const sync = byKey(descriptors, 'editor.previews.syncScroll');
    expect(sync).toMatchObject({
      control: 'toggle',
      group: 'Editor',
      subgroup: 'Previews',
      label: 'Synchronise preview and editor scrolling',
    });
    expect(sync.enabledWhen).toBeUndefined();
    // Emitted whatever the registry holds — it is not generated per provider.
    expect(previewSettingsDescriptors(TEST_REGISTRY).map((d) => d.key)).toContain('editor.previews.syncScroll');
  });

  /*
   * 2026-09-16 iteration (FR-122f, FR-121; plan decision 1). The description has to say the two facts
   * the requirement names — sync runs BOTH ways, and the setting is also switched from the panels'
   * menus and status bars. Substrings, not the sentence, so the wording can be polished without a test
   * edit. The old sentence ("Scrolling the preview never moves the editor") became false under FR-121.
   */
  it('describes syncScroll as two-way, and names the menu item and the status-bar button that also switch it (FR-122f)', () => {
    const sync = byKey(descriptors, 'editor.previews.syncScroll');
    expect(sync.description).toContain('both directions');
    expect(sync.description).toContain('Synchronise Scrolling');
    expect(sync.description).toContain('status bar');
    expect(sync.description).not.toContain('never moves the editor');
    // Analyze T1 — the preview's own bar has no preview button: there the toggle sits beside Open in Editor /
    // Go to Editor, so "beside the preview button" is true of only one of the two bars it names.
    expect(sync.description).not.toContain('beside the preview button');
    // Label and presence rule unchanged by the iteration.
    expect(sync.label).toBe('Synchronise preview and editor scrolling');
    expect(sync.enabledWhen).toBeUndefined();
  });

  /*
   * FR-117 against the SHIPPED Markdown descriptor, not this file's `markdown` literal: the generator
   * is generic, so a literal carrying `showFrontMatter` would prove the generator and nothing about
   * whether Markdown declares the setting at all.
   */
  it('generates Markdown: Show front matter from the shipped Markdown descriptor — toggle, on, disabled while Markdown is off (FR-117)', () => {
    const shipped = registryOf(markdownProvider);
    const d = byKey(previewSettingsDescriptors(shipped), 'editor.previews.providers.markdown.showFrontMatter');
    expect(d).toMatchObject({
      control: 'toggle',
      group: 'Editor',
      subgroup: 'Previews',
      label: 'Markdown: Show front matter',
    });
    expect(d.description.trim().length).toBeGreaterThan(0);
    expect(d.enabledWhen).toEqual({ key: 'editor.previews.providers.markdown.enabled', is: true });
    expect(previewSettingsDefaults(shipped).providers.markdown.showFrontMatter).toBe(true);
  });

  it('puts both shipped delays exactly on a slider stop', () => {
    const defaults = previewSettingsDefaults(SHIPPED_LIKE);
    for (const [key, shipped] of [
      ['editor.previews.updateDelayMs', defaults.updateDelayMs],
      ['editor.previews.maxWaitMs', defaults.maxWaitMs],
    ] as const) {
      const d = byKey(descriptors, key);
      expect((shipped - d.min!) % d.step!, `${key}: ${shipped} is between two stops`).toBe(0);
    }
  });

  it('prefixes every provider label with the provider’s display name', () => {
    expect(byKey(descriptors, 'editor.previews.providers.markdown.enabled').label).toBe('Markdown: Enabled');
    expect(byKey(descriptors, 'editor.previews.providers.markdown.defaultOpenAction').label).toBe(
      'Markdown: Default open action',
    );
    expect(byKey(descriptors, 'editor.previews.providers.markdown.loadRemoteImages').label).toBe(
      'Markdown: Load remote images',
    );
  });

  it('offers Editor and Preview as the default open action', () => {
    const d = byKey(descriptors, 'editor.previews.providers.markdown.defaultOpenAction');
    expect(d.control).toBe('select');
    expect(d.allowedValues).toEqual(['editor', 'preview']);
    expect(d.optionLabels).toEqual({ editor: 'Editor', preview: 'Preview' });
  });

  it('draws the default open action and own settings DISABLED while the provider is off (FR-061)', () => {
    const when = { key: 'editor.previews.providers.markdown.enabled', is: true };
    expect(byKey(descriptors, 'editor.previews.providers.markdown.defaultOpenAction').enabledWhen).toEqual(when);
    expect(byKey(descriptors, 'editor.previews.providers.markdown.loadRemoteImages').enabledWhen).toEqual(when);
    // …and the toggle that governs them is always live.
    expect(byKey(descriptors, 'editor.previews.providers.markdown.enabled').enabledWhen).toBeUndefined();
    expect(byKey(descriptors, 'editor.previews.providers.markdown.enabled').control).toBe('toggle');
  });

  it('sweeps every provider in TEST_REGISTRY: enabledWhen on every own setting and defaultOpenAction, none on enabled (FR-061)', () => {
    const swept = previewSettingsDescriptors(TEST_REGISTRY);
    for (const provider of TEST_REGISTRY.list()) {
      const enabledKey = `editor.previews.providers.${provider.id}.enabled`;
      const when = { key: enabledKey, is: true };
      expect(byKey(swept, enabledKey).enabledWhen, enabledKey).toBeUndefined();
      if (provider.kind === 'text') {
        expect(
          byKey(swept, `editor.previews.providers.${provider.id}.defaultOpenAction`).enabledWhen,
          `${provider.id}.defaultOpenAction`,
        ).toEqual(when);
      }
      for (const s of provider.settings ?? []) {
        expect(
          byKey(swept, `editor.previews.providers.${provider.id}.${s.leaf}`).enabledWhen,
          `${provider.id}.${s.leaf}`,
        ).toEqual(when);
      }
    }
    // notes.showOutline is the own-setting case this sweep exists to cover.
    expect(byKey(swept, 'editor.previews.providers.notes.showOutline').enabledWhen).toEqual({
      key: 'editor.previews.providers.notes.enabled',
      is: true,
    });
  });

  it('declares no defaultOpenAction descriptor for a binary provider (FR-051)', () => {
    const keys = previewSettingsDescriptors(TEST_REGISTRY).map((d) => d.key);
    expect(keys).toContain('editor.previews.providers.image.enabled');
    expect(keys).not.toContain('editor.previews.providers.image.defaultOpenAction');
  });

  it('describes a test registry completely — zero missing, zero unknown (FR-071, SC-003 S5)', () => {
    const defaults = previewSettingsDefaults(TEST_REGISTRY);
    const registryDescriptors = previewSettingsDescriptors(TEST_REGISTRY);
    // Relative to `editor.previews`, as the leaves sit inside the settings document.
    const leaves = leavesOfDeclared({ editor: { previews: defaults } }, registryDescriptors);
    expect(auditRegistry(leaves, registryDescriptors)).toEqual({ missing: [], unknown: [], duplicated: [] });
    expect(leaves).toContain('editor.previews.providers.notes.showOutline');
    expect(byKey(registryDescriptors, 'editor.previews.providers.notes.showOutline').label).toBe(
      'Notes: Show outline',
    );
  });
});

describe('parsePreviewSettings — tolerant per leaf', () => {
  const defaults = previewSettingsDefaults(SHIPPED_LIKE);

  it('returns the defaults for a missing or non-object section', () => {
    for (const raw of [undefined, null, 42, 'on', []]) {
      expect(parsePreviewSettings(raw, SHIPPED_LIKE)).toEqual(defaults);
    }
  });

  it('keeps every valid leaf', () => {
    const parsed = parsePreviewSettings(
      {
        updateDelayMs: 0,
        maxWaitMs: 4000,
        copyFormat: 'plain',
        syncScroll: false,
        providers: {
          markdown: { enabled: false, defaultOpenAction: 'preview', loadRemoteImages: false, showFrontMatter: false },
        },
      },
      SHIPPED_LIKE,
    );
    expect(parsed).toEqual({
      updateDelayMs: 0,
      maxWaitMs: 4000,
      copyFormat: 'plain',
      syncScroll: false,
      providers: {
        markdown: { enabled: false, defaultOpenAction: 'preview', loadRemoteImages: false, showFrontMatter: false },
      },
    });
  });

  it('parses a non-boolean syncScroll as true, and keeps its neighbours (FR-114)', () => {
    for (const bad of ['off', 0, 1, null, {}, []]) {
      const parsed = parsePreviewSettings({ syncScroll: bad, copyFormat: 'plain' }, SHIPPED_LIKE);
      expect(parsed.syncScroll, JSON.stringify(bad)).toBe(true);
      expect(parsed.copyFormat, JSON.stringify(bad)).toBe('plain');
    }
    expect(parsePreviewSettings({}, SHIPPED_LIKE).syncScroll).toBe(true);
  });

  it('replaces a bad leaf with its own default and keeps its neighbours', () => {
    const parsed = parsePreviewSettings(
      {
        updateDelayMs: 'soon',
        maxWaitMs: 2000,
        copyFormat: 'html',
        syncScroll: 'yes',
        providers: {
          markdown: { enabled: 'yes', defaultOpenAction: 'window', loadRemoteImages: false, showFrontMatter: 'no' },
        },
      },
      SHIPPED_LIKE,
    );
    expect(parsed).toEqual({
      updateDelayMs: 300,
      maxWaitMs: 2000,
      copyFormat: 'rich',
      syncScroll: true,
      providers: {
        markdown: { enabled: true, defaultOpenAction: 'editor', loadRemoteImages: false, showFrontMatter: true },
      },
    });
  });

  it('fills a registered provider absent from the document with its defaults', () => {
    expect(parsePreviewSettings({ providers: {} }, SHIPPED_LIKE).providers.markdown).toEqual(
      defaults.providers.markdown,
    );
  });

  it('PRESERVES an unknown provider id — a hand-added or later-build key is legitimate', () => {
    const later = { enabled: false, somethingNew: 3 };
    const parsed = parsePreviewSettings({ providers: { mermaid: later } }, SHIPPED_LIKE);
    expect(parsed.providers.mermaid).toEqual(later);
    expect(parsed.providers.markdown).toEqual(defaults.providers.markdown);
  });

  it('never gives a binary provider a defaultOpenAction, even one written by hand (FR-051)', () => {
    const parsed = parsePreviewSettings(
      { providers: { image: { enabled: true, defaultOpenAction: 'editor' } } },
      TEST_REGISTRY,
    );
    expect(parsed.providers.image).toEqual({ enabled: true });
  });
});

describe('effectiveMaxWaitMs (FR-060a)', () => {
  const base = previewSettingsDefaults(SHIPPED_LIKE);

  it('is the maximum wait while that is at least the update delay', () => {
    expect(effectiveMaxWaitMs({ ...base, updateDelayMs: 300, maxWaitMs: 1000 })).toBe(1000);
  });

  it('behaves as the update delay when the stored maximum is below it', () => {
    expect(effectiveMaxWaitMs({ ...base, updateDelayMs: 2000, maxWaitMs: 500 })).toBe(2000);
  });
});

describe('defaultOpenActionFor (FR-050, FR-062)', () => {
  const withMarkdown = (patch: Partial<PreviewSettings['providers']['markdown']>): PreviewSettings => {
    const s = previewSettingsDefaults(SHIPPED_LIKE);
    s.providers.markdown = { ...s.providers.markdown, ...patch };
    return s;
  };

  it('is editor by default', () => {
    expect(defaultOpenActionFor(SHIPPED_LIKE, previewSettingsDefaults(SHIPPED_LIKE), 'C:/p/README.md')).toBe('editor');
  });

  it('is preview when an ENABLED provider says so', () => {
    expect(defaultOpenActionFor(SHIPPED_LIKE, withMarkdown({ defaultOpenAction: 'preview' }), 'C:/p/a.md')).toBe(
      'preview',
    );
  });

  it('is editor while the provider is disabled — WITHOUT rewriting the stored choice', () => {
    const s = withMarkdown({ enabled: false, defaultOpenAction: 'preview' });
    expect(defaultOpenActionFor(SHIPPED_LIKE, s, 'C:/p/a.md')).toBe('editor');
    expect(s.providers.markdown.defaultOpenAction, 're-enabling must restore the user’s choice').toBe('preview');
  });

  it('is editor for a file no provider claims', () => {
    expect(defaultOpenActionFor(SHIPPED_LIKE, withMarkdown({ defaultOpenAction: 'preview' }), 'C:/p/a.ts')).toBe(
      'editor',
    );
  });

  it('is preview for an ENABLED binary provider (FR-051)', () => {
    const s = previewSettingsDefaults(TEST_REGISTRY);
    expect(defaultOpenActionFor(TEST_REGISTRY, s, 'C:/p/a.png')).toBe('preview');
  });

  it('is editor for a DISABLED binary provider (FR-062)', () => {
    const s = previewSettingsDefaults(TEST_REGISTRY);
    s.providers.image = { ...s.providers.image, enabled: false };
    expect(defaultOpenActionFor(TEST_REGISTRY, s, 'C:/p/a.png')).toBe('editor');
  });
});

describe('remoteImagesPermitted (FR-092)', () => {
  it('is true while an enabled provider’s remote-images setting is on', () => {
    expect(remoteImagesPermitted(SHIPPED_LIKE, previewSettingsDefaults(SHIPPED_LIKE))).toBe(true);
  });

  it('is false when that setting is off', () => {
    const s = previewSettingsDefaults(SHIPPED_LIKE);
    s.providers.markdown.loadRemoteImages = false;
    expect(remoteImagesPermitted(SHIPPED_LIKE, s)).toBe(false);
  });

  it('is false when the provider declaring it is disabled', () => {
    const s = previewSettingsDefaults(SHIPPED_LIKE);
    s.providers.markdown.enabled = false;
    expect(remoteImagesPermitted(SHIPPED_LIKE, s)).toBe(false);
  });

  it('is false for a registry in which no provider declares a remote-images setting', () => {
    expect(remoteImagesPermitted(TEST_REGISTRY, previewSettingsDefaults(TEST_REGISTRY))).toBe(false);
  });
});

describe('providersTurnedOff — FR-063’s trigger', () => {
  const settingsWith = (enabled: Record<string, boolean>): PreviewSettings => {
    const s = previewSettingsDefaults(TEST_REGISTRY);
    for (const [id, on] of Object.entries(enabled)) {
      s.providers[id] = { ...(s.providers[id] ?? {}), enabled: on };
    }
    return s;
  };

  it('returns exactly the ids that went true → false', () => {
    expect(providersTurnedOff(settingsWith({ notes: true, image: true }), settingsWith({ notes: false, image: true }), TEST_REGISTRY)).toEqual(['notes']);
  });

  it('ignores false → false and true → true', () => {
    expect(providersTurnedOff(settingsWith({ notes: false, image: true }), settingsWith({ notes: false, image: true }), TEST_REGISTRY)).toEqual([]);
  });

  it('ignores false → true', () => {
    expect(providersTurnedOff(settingsWith({ notes: false }), settingsWith({ notes: true }), TEST_REGISTRY)).toEqual([]);
  });

  it('ignores a provider absent from the previous settings', () => {
    const previous = settingsWith({});
    delete previous.providers.notes;
    expect(providersTurnedOff(previous, settingsWith({ notes: false }), TEST_REGISTRY)).toEqual([]);
  });

  it('ignores an unregistered id, however its enabled flag moved', () => {
    const previous = settingsWith({ mermaid: true });
    const next = settingsWith({ mermaid: false });
    expect(providersTurnedOff(previous, next, TEST_REGISTRY)).toEqual([]);
  });
});
