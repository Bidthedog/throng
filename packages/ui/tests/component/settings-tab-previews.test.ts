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

/**
 * The rows directly in `el`, not in a subsection nested inside it. Since 056 every heading's contents sit
 * in one `.fold-content` container (so a fold can hide them), which is the element they are direct
 * children of.
 */
const ownRows = (el: HTMLElement): (string | null)[] =>
  [...el.querySelectorAll(':scope > .fold-content > .settings-row')].map((r) => r.getAttribute('data-testid'));
const MM = 'editor.previews.providers.mermaid';

describe('the Previews subsection over the shipped registry (FR-060, FR-060a, FR-061, FR-065, FR-114, FR-117)', () => {
  /*
   * ONE mount for what was seven read-only tests (audit, component-2a): the layout, the labels, the
   * two new toggles, and the live control for the disabled-provider case. The two search cases mutate
   * the search box, so they run LAST in the chain. The deleted "ships Markdown enabled, opening in an
   * editor" case is the shipped default, asserted by `packages/core/tests/unit/editor-settings.test.ts`
   * (previews.providers.markdown.enabled / defaultOpenAction).
   */
  it('draws the contract layout, labels, toggles and live controls, then answers a search', async () => {
    await mount({});

    // 054 FR-050 – FR-052 (contracts/menus-commands-controls-054.md "Preferences layout") SUPERSEDES the
    // flat list 044 and 047 asserted here: Previews now holds only what applies to every preview type,
    // and each provider's settings sit in that provider's own subsection beneath it. `Open previews in`
    // is per provider (FR-051), and `editor.markdownSectionsOpen` moves into Markdown with its key kept
    // (FR-054).
    expect(ownRows(subsection())).toEqual([
      'setting-editor.previews.updateDelayMs',
      'setting-editor.previews.maxWaitMs',
      'setting-editor.previews.syncScroll',
      'setting-editor.previews.copyFormat',
    ]);
    const subsections = [...subsection().querySelectorAll(':scope > .fold-content > .settings-subgroup')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(subsections).toEqual([
      'settings-subsection-Editor-Previews-Markdown',
      'settings-subsection-Editor-Previews-Mermaid',
    ]);
    expect(ownRows(screen.getByTestId('settings-subsection-Editor-Previews-Markdown'))).toEqual([
      `setting-${MD}.enabled`,
      `setting-${MD}.defaultOpenAction`,
      `setting-${MD}.openTarget`,
      `setting-${MD}.renderMermaid`,
      `setting-${MD}.loadRemoteImages`,
      `setting-${MD}.showFrontMatter`,
      `setting-${MD}.gutter`,
      `setting-${MD}.headingJumpMs`,
      'setting-editor.markdownSectionsOpen',
    ]);
    expect(ownRows(screen.getByTestId('settings-subsection-Editor-Previews-Mermaid'))).toEqual([
      `setting-${MM}.enabled`,
      `setting-${MM}.defaultOpenAction`,
      `setting-${MM}.openTarget`,
    ]);

    // The provider rows carry the provider's display name, and none of them "Open files with" (019 FR-024).
    const section = subsection();
    expect(within(section).getByText('Markdown: Enabled')).toBeInTheDocument();
    expect(within(section).getByText('Markdown: Default open action')).toBeInTheDocument();
    expect(within(section).getByText('Markdown: Load remote images')).toBeInTheDocument();
    // `editor.openOnClick`'s label — a different setting, which two rows under one name would merge.
    expect(within(section).queryByText(/open files with/i)).toBeNull();
    expect(within(screen.getByTestId(`setting-${MD}.openTarget`)).getByText('Markdown: Open previews in')).toBeInTheDocument();
    expect(within(screen.getByTestId(`setting-${MM}.openTarget`)).getByText('Mermaid: Open previews in')).toBeInTheDocument();

    // Iteration 2026-09-15 (T187): the two new toggles are drawn, shipped on (FR-114, FR-117).
    expect(within(section).getByText('Synchronise preview and editor scrolling')).toBeInTheDocument();
    expect(within(section).getByText('Markdown: Show front matter')).toBeInTheDocument();
    expect((control('editor.previews.syncScroll') as HTMLInputElement).checked).toBe(true);
    expect((control(`${MD}.showFrontMatter`) as HTMLInputElement).checked).toBe(true);

    // The control for the Markdown-disabled case below: the same controls are LIVE while Markdown is on.
    expect(control(`${MD}.defaultOpenAction`).disabled).toBe(false);
    expect(control(`${MD}.loadRemoteImages`).disabled).toBe(false);

    // Search (054 FR-052, FR-055): both providers' Open previews in are found…
    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: 'open previews' } });
    await waitFor(() => expect(screen.queryByTestId(`setting-${MD}.openTarget`)).not.toBeNull());
    expect(screen.queryByTestId(`setting-${MM}.openTarget`)).not.toBeNull();

    // …and an all-filtered provider subsection drops with its heading, keeping the other (054 FR-050a).
    expect(screen.queryByTestId('settings-subsection-Editor-Previews-Markdown')).not.toBeNull();
    fireEvent.change(screen.getByTestId('settings-search'), { target: { value: 'mermaid.openTarget' } });
    await waitFor(() => expect(screen.queryByTestId('settings-subsection-Editor-Previews-Markdown')).toBeNull());
    expect(screen.queryByTestId('settings-subsection-Editor-Previews-Mermaid')).not.toBeNull();
  });
});

describe('Synchronise preview and editor scrolling, and Markdown: Show front matter write their own key (FR-114, FR-117)', () => {
  // Each writing its OWN key: a toggle wired to the wrong path would render and check exactly like a
  // right one, so the write is the observable that discriminates.
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

describe('with Markdown disabled (FR-061, FR-062)', () => {
  it('draws the options visible and DISABLED, not hidden, keeps the stored choice, and leaves scroll sync live', async () => {
    await mount({ editor: { previews: { providers: { markdown: { enabled: false, defaultOpenAction: 'preview' } } } } });
    await waitFor(() => expect((control(`${MD}.enabled`) as HTMLInputElement).checked).toBe(false));

    const frontMatter = control(`${MD}.showFrontMatter`);
    const sync = control('editor.previews.syncScroll');
    const action = control(`${MD}.defaultOpenAction`);
    const images = control(`${MD}.loadRemoteImages`);
    for (const el of [frontMatter, sync, action, images]) expect(subsection()).toContainElement(el);
    expect(frontMatter.disabled, 'Show front matter must be inert while Markdown is off').toBe(true);
    expect(sync.disabled, 'scroll sync applies to every text provider, so Markdown being off must not suspend it').toBe(
      false,
    );
    expect(action.disabled, 'Default open action must be inert while its provider is off').toBe(true);
    expect(images.disabled, 'Load remote images must be inert while its provider is off').toBe(true);
    // The stored choice is kept, only suspended (FR-062): re-enabling restores it.
    expect(action.value).toBe('preview');
    // The toggle that turns the provider back on is never itself disabled.
    expect(control(`${MD}.enabled`).disabled).toBe(false);
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
