/**
 * Preferences → Editor → Previews (044 US4 — FR-060, FR-060a, FR-061, FR-062, FR-065, SC-003).
 *
 * ══ WHY THE COMPONENT TIER ══
 *
 * Every claim is about the rendered form: which rows exist inside the Previews subsection, what they
 * are called, and whether a control is drawn disabled. `settings-metadata-*.test.ts` proves the
 * DESCRIPTORS exist; that is not the claim that the form draws them, nor that a disabled provider's
 * options are drawn disabled rather than hidden — a control kind that ignores `disabled` passes every
 * registry test and still lets the user change a suspended option.
 *
 * ══ THE METADATA CONTEXT (SC-003 prerequisite) ══
 *
 * The tab reads its descriptors from a context whose default is `SETTINGS_METADATA`, so a test — and
 * SC-003's provider-seam test — can render a registry of its own and see its rows appear with no edit
 * to the preferences editor (FR-070, FR-071).
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Every absence assertion here (no "Open files with" in the subsection) is preceded by a presence
 * assertion on the same subsection, so an unrendered subsection cannot pass it.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewProviderRegistry, previewSettingsDescriptors } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ResetNoticeProvider } from '../../src/renderer/preferences/reset-notice.js';
import { SettingsMetadataContext, SettingsTab } from '../../src/renderer/preferences/settings-tab.js';

const SUBSECTION = 'settings-subgroup-Editor-Previews';
const MD = 'editor.previews.providers.markdown';

function tree(child: ReactElement): ReactElement {
  return createElement(
    ConfigProvider,
    null,
    createElement(
      NotificationProvider,
      null,
      createElement(ResetNoticeProvider, null, createElement(ConfirmProvider, null, child)),
    ),
  );
}

/** Every key-scoped change the tab sent through `writePatch`, in order. */
let patches: { id: unknown; changes: { path: readonly string[]; value: unknown }[] }[] = [];

/** Mount with `settings` as the config payload main would send. */
async function mount(settings: unknown, child: ReactElement = createElement(SettingsTab, null)): Promise<void> {
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve({ settings }),
      onChange: () => () => {},
      // `applyChange` goes through `writeConfigPatch`, which reads `writePatch` — a spy on `write`
      // would observe nothing (see `preferences-settings-search.test.ts`).
      writePatch: (id: unknown, changes: { path: readonly string[]; value: unknown }[]) => {
        patches.push({ id, changes });
        return Promise.resolve({ ok: true });
      },
    },
  });
  render(tree(child));
  // The payload lands after mount; wait for it rather than asserting against the shipped defaults.
  await act(async () => {
    await Promise.resolve();
  });
}

const subsection = (): HTMLElement => screen.getByTestId(SUBSECTION);
const control = (key: string): HTMLInputElement | HTMLSelectElement =>
  screen.getByTestId(`control-${key}`) as HTMLInputElement | HTMLSelectElement;

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  patches = [];
});

describe('the Previews subsection draws every preview setting (FR-060, FR-060a, FR-061, FR-065)', () => {
  it('holds the update delay, maximum wait, copy format, and Markdown’s enabled, default open action and own setting', async () => {
    await mount({});
    const rows = [...subsection().querySelectorAll('.settings-row')].map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual([
      'setting-editor.previews.updateDelayMs',
      'setting-editor.previews.maxWaitMs',
      'setting-editor.previews.copyFormat',
      // Iteration 2026-09-15 — FR-114, then FR-117 as Markdown's second own setting.
      'setting-editor.previews.syncScroll',
      `setting-${MD}.enabled`,
      `setting-${MD}.defaultOpenAction`,
      `setting-${MD}.loadRemoteImages`,
      `setting-${MD}.showFrontMatter`,
    ]);
  });

  it('labels the provider rows with the provider’s display name, and none of them "Open files with" (019 FR-024)', async () => {
    await mount({});
    const section = subsection();
    expect(within(section).getByText('Markdown: Enabled')).toBeInTheDocument();
    expect(within(section).getByText('Markdown: Default open action')).toBeInTheDocument();
    expect(within(section).getByText('Markdown: Load remote images')).toBeInTheDocument();
    // `editor.openOnClick`'s label — a different setting, which two rows under one name would merge.
    expect(within(section).queryByText(/open files with/i)).toBeNull();
  });

  it('ships Markdown enabled, opening in an editor (FR-050, FR-065)', async () => {
    await mount({});
    expect((control(`${MD}.enabled`) as HTMLInputElement).checked).toBe(true);
    expect(control(`${MD}.defaultOpenAction`).value).toBe('editor');
  });
});

/*
 * Iteration 2026-09-15 (T187) — the two new toggles. Drawn, shipped on, and each writing its OWN key:
 * a toggle wired to the wrong path would render and check exactly like a right one, so the write is
 * the observable that discriminates.
 */
describe('Synchronise preview and editor scrolling, and Markdown: Show front matter (FR-114, FR-117)', () => {
  it('draws both in the Previews subsection, shipped on', async () => {
    await mount({});
    const section = subsection();
    expect(within(section).getByText('Synchronise preview and editor scrolling')).toBeInTheDocument();
    expect(within(section).getByText('Markdown: Show front matter')).toBeInTheDocument();
    expect((control('editor.previews.syncScroll') as HTMLInputElement).checked).toBe(true);
    expect((control(`${MD}.showFrontMatter`) as HTMLInputElement).checked).toBe(true);
  });

  for (const [label, key, path] of [
    ['Synchronise preview and editor scrolling', 'editor.previews.syncScroll', ['editor', 'previews', 'syncScroll']],
    [
      'Markdown: Show front matter',
      `${MD}.showFrontMatter`,
      ['editor', 'previews', 'providers', 'markdown', 'showFrontMatter'],
    ],
  ] as const) {
    it(`toggling ${label} writes ${key} = false, and nothing else`, async () => {
      await mount({});
      const input = control(key) as HTMLInputElement;
      expect(input.checked).toBe(true);
      await act(async () => {
        fireEvent.click(input);
      });
      await waitFor(() => expect(patches.length).toBeGreaterThan(0));
      const changes = patches.flatMap((p) => p.changes);
      expect(changes).toEqual([{ path: [...path], value: false }]);
    });
  }
});

describe('with Markdown disabled (FR-061)', () => {
  it('draws Show front matter visible and disabled, while scroll sync — no provider’s setting — stays live', async () => {
    await mount({ editor: { previews: { providers: { markdown: { enabled: false } } } } });
    await waitFor(() => expect((control(`${MD}.enabled`) as HTMLInputElement).checked).toBe(false));

    const frontMatter = control(`${MD}.showFrontMatter`);
    const sync = control('editor.previews.syncScroll');
    expect(subsection()).toContainElement(frontMatter);
    expect(subsection()).toContainElement(sync);
    expect(frontMatter.disabled, 'Show front matter must be inert while Markdown is off').toBe(true);
    expect(sync.disabled, 'scroll sync applies to every text provider, so Markdown being off must not suspend it').toBe(
      false,
    );
  });
});

describe('a disabled provider’s options are drawn DISABLED, not hidden (FR-061, FR-062)', () => {
  it('keeps Default open action and Load remote images visible and disabled while Markdown is off', async () => {
    await mount({ editor: { previews: { providers: { markdown: { enabled: false, defaultOpenAction: 'preview' } } } } });
    await waitFor(() => expect((control(`${MD}.enabled`) as HTMLInputElement).checked).toBe(false));

    const action = control(`${MD}.defaultOpenAction`);
    const images = control(`${MD}.loadRemoteImages`);
    expect(subsection()).toContainElement(action);
    expect(subsection()).toContainElement(images);
    expect(action.disabled, 'Default open action must be inert while its provider is off').toBe(true);
    expect(images.disabled, 'Load remote images must be inert while its provider is off').toBe(true);
    // The stored choice is kept, only suspended (FR-062): re-enabling restores it.
    expect(action.value).toBe('preview');
    // The toggle that turns the provider back on is never itself disabled.
    expect(control(`${MD}.enabled`).disabled).toBe(false);
  });

  it('draws the same two controls live while Markdown is on (the control)', async () => {
    await mount({});
    expect(control(`${MD}.defaultOpenAction`).disabled).toBe(false);
    expect(control(`${MD}.loadRemoteImages`).disabled).toBe(false);
  });
});

describe('the tab reads its descriptors from a metadata context (SC-003 prerequisite)', () => {
  it('renders a test registry’s generated rows, and only those, when the context supplies them', async () => {
    const registry = createPreviewProviderRegistry([
      {
        id: 'testText',
        displayName: 'Test text',
        extensions: ['.prvtxt'],
        kind: 'text',
        settings: [{ leaf: 'shout', label: 'Shout', description: 'Upper-case everything.', control: 'toggle', default: false }],
      },
    ]);
    await mount(
      {},
      createElement(SettingsMetadataContext.Provider, { value: previewSettingsDescriptors(registry) }, createElement(SettingsTab, null)),
    );

    const section = subsection();
    expect(within(section).getByText('Test text: Enabled')).toBeInTheDocument();
    expect(within(section).getByText('Test text: Default open action')).toBeInTheDocument();
    expect(within(section).getByText('Test text: Shout')).toBeInTheDocument();
    // The shipped registry is not what drew this form.
    expect(within(section).queryByText('Markdown: Enabled')).toBeNull();
    expect(screen.queryByTestId('setting-editor.openOnClick')).toBeNull();
  });
});
