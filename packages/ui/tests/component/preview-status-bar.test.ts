/**
 * 044 T112 — a preview panel's status bar (FR-015a, FR-015c, FR-015d, FR-015e;
 * contracts/menus-and-controls.md §8).
 *
 * ══ THE MIRROR OF THE EDITOR'S BAR ══
 *
 * An editor carries Open Preview in its status bar; a preview carries the route back — in the same
 * element, with the same classes, following the same `editor.showStatusBar` setting, and in the same
 * trailing controls group, so it is never hidden by width. A rendered document has no caret and no character
 * count worth reporting, so its one readout is a hovered or focused link's target (FR-118, iteration
 * 2026-09-15) — the mounted behaviour is `preview-link-readout.test.ts`'s.
 *
 * One button, token `editorPanel`: *Open in Editor* while the preview is standalone, *Go to Editor*
 * (pressed) while it is parented. A binary provider has no editor at all, so its preview's bar would
 * carry nothing — and is not shown (FR-015e).
 *
 * Mounted through the real `PanelPlaceholder` with a TEST provider (`preview-panel-mount.test.ts`'s
 * reason: the chrome must derive everything from the registry and name no provider).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME, createPreviewProviderRegistry } from '@throng/core';
import type { PreviewBodyProps, PreviewProviderView } from '../../src/renderer/preview/provider-view.js';
import { PreviewStatusBar } from '../../src/renderer/preview/preview-status-bar.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const TEXT_FILE = 'D:/proj/notes.prvtxt';
const BINARY_FILE = 'D:/proj/manual.prvbin';

const registry = createPreviewProviderRegistry([
  { id: 'testText', displayName: 'Test text', extensions: ['.prvtxt'], kind: 'text' },
  { id: 'testBinary', displayName: 'Test binary', extensions: ['.prvbin'], kind: 'binary', sourceMimeTypes: ['application/pdf'] },
]);

function FakeBody({ panelId, content }: PreviewBodyProps): ReactElement {
  return createElement('div', { 'data-testid': `fake-body-${panelId}` }, content.kind === 'text' ? content.text : 'binary');
}
const views: Record<string, PreviewProviderView> = {
  testText: { id: 'testText', textSelection: true, load: () => Promise.resolve(FakeBody) },
  testBinary: { id: 'testBinary', textSelection: false, load: () => Promise.resolve(FakeBody) },
};

let m: MountedPreviewWindow | undefined;

async function mountText(settings?: Record<string, unknown>): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview('hello', TEXT_FILE, { providers: { registry, views }, providerId: 'testText', settings });
  await screen.findByTestId(`fake-body-${m.id}`);
  return m;
}

const bar = (id: string): HTMLElement | null => screen.queryByTestId(`preview-status-bar-${id}`);
const button = (id: string): HTMLElement | null => screen.queryByTestId(`preview-editor-${id}`);

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('the preview status bar looks like the editor’s (FR-015a)', () => {
  /*
   * Amended for FR-118 (iteration 2026-09-15), which supersedes FR-015a's "it carries no readouts" for ONE
   * readout: the hovered or focused link's target. With nothing to name, the readouts group is still empty.
   */
  it('is the editor strip’s element, with its two groups, and with no link to name its readouts group is empty', async () => {
    const { id } = await mountText();
    const strip = await screen.findByTestId(`preview-status-bar-${id}`);

    expect(strip).toHaveClass('editor-status-strip');
    expect(strip.querySelector('.editor-status-strip__group--controls')).not.toBeNull();
    // No caret, no counts, no language, no wrap toggle — the preview reports nothing about text.
    expect(strip.querySelector('.editor-status-strip__group--readouts')?.childElementCount).toBe(0);
    expect(strip.querySelectorAll('.editor-status-strip__readout')).toHaveLength(0);
    expect(strip.querySelector('.editor-status-strip__language')).toBeNull();
    expect(strip.querySelector('.editor-status-strip__wrap')).toBeNull();
    // Its two controls (FR-122c partly supersedes FR-015a's one): the scroll-sync toggle, then the route.
    expect([...strip.querySelectorAll('button')].map((b) => b.getAttribute('data-testid'))).toEqual([
      `preview-sync-scroll-${id}`,
      `preview-editor-${id}`,
    ]);
  });

  it('with a readout, shows that text in the editor strip’s readout class — the controls group unchanged (FR-118)', () => {
    const draw = (readout: string | null) =>
      render(
        createElement(PreviewStatusBar, {
          panelId: 'pv',
          providerKind: 'text',
          parented: false,
          onEditorRoute: () => {},
          syncScroll: true,
          onToggleSyncScroll: () => {},
          readout,
        }),
      );
    const target = 'D:/proj/docs/a-very-long-folder-name/setup.md#install';
    const view = draw(target);
    const strip = screen.getByTestId('preview-status-bar-pv');
    const readouts = strip.querySelector('.editor-status-strip__group--readouts') as HTMLElement;
    const shown = readouts.querySelectorAll('.editor-status-strip__readout');
    expect(shown).toHaveLength(1);
    expect(shown[0].textContent).toBe(target);
    const controls = strip.querySelector('.editor-status-strip__group--controls') as HTMLElement;
    expect(within(controls).getAllByRole('button')).toHaveLength(2);
    expect(within(controls).getByTestId('preview-editor-pv')).toHaveAccessibleName('Open in Editor');
    // The readout does not displace the scroll-sync toggle (FR-122c).
    expect(within(controls).getByTestId('preview-sync-scroll-pv').nextElementSibling).toBe(
      within(controls).getByTestId('preview-editor-pv'),
    );
    view.unmount();

    draw(null);
    expect(screen.getByTestId('preview-status-bar-pv').querySelector('.editor-status-strip__group--readouts')?.childElementCount).toBe(0);
    expect(within(screen.getByTestId('preview-status-bar-pv')).getAllByRole('button')).toHaveLength(2);
  });

  it('sits in the preview panel, below the body', async () => {
    const { id } = await mountText();
    const panel = screen.getByTestId(`preview-${id}`);
    const strip = await screen.findByTestId(`preview-status-bar-${id}`);
    expect(panel.contains(strip)).toBe(true);
    const body = screen.getByTestId(`preview-body-${id}`);
    // Document order: the body, then the bar.
    expect(body.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('follows editor.showStatusBar, live', async () => {
    const mounted = await mountText({ editor: { showStatusBar: false } });
    await waitFor(() => expect(bar(mounted.id)).toBeNull());

    mounted.setSettings({ editor: { showStatusBar: true } });
    await waitFor(() => expect(bar(mounted.id)).not.toBeNull());

    mounted.setSettings({ editor: { showStatusBar: false } });
    await waitFor(() => expect(bar(mounted.id)).toBeNull());
  });
});

describe('its one button is the route back to the source (FR-015a, FR-015c, FR-015d)', () => {
  it('standalone: token editorPanel, “Open in Editor”, not pressed', async () => {
    const { id } = await mountText();
    const b = await screen.findByTestId(`preview-editor-${id}`);

    expect(b).toHaveAccessibleName('Open in Editor');
    expect(b).toHaveAttribute('title', 'Open in Editor');
    expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(b).toHaveTextContent(THRONG_THEME.icons.editorPanel);
    expect(b.querySelector('svg')).toBeNull();
  });

  it('parented: “Go to Editor”, pressed — and back to Open in Editor when the parent goes', async () => {
    const mounted = await mountText();
    const { id } = mounted;
    mounted.push(previewUpdate({ panelId: id, providerId: 'testText', filePath: TEXT_FILE, revision: 2, content: null, parent: { panelId: 'ed', title: 'notes' } }));

    await waitFor(() => expect(button(id)).toHaveAccessibleName('Go to Editor'));
    expect(button(id)).toHaveAttribute('aria-pressed', 'true');

    mounted.push(previewUpdate({ panelId: id, providerId: 'testText', filePath: TEXT_FILE, revision: 3, content: null, parent: null }));
    await waitFor(() => expect(button(id)).toHaveAccessibleName('Open in Editor'));
    expect(button(id)).toHaveAttribute('aria-pressed', 'false');
  });

  it('is never hidden by width: it lives in the measured controls group, with nothing fitted against it', async () => {
    const { id } = await mountText();
    const strip = await screen.findByTestId(`preview-status-bar-${id}`);
    const controls = strip.querySelector<HTMLElement>('.editor-status-strip__group--controls');
    expect(controls).not.toBeNull();
    expect(within(controls as HTMLElement).getByTestId(`preview-editor-${id}`)).toBeVisible();
    expect(button(id)).not.toHaveAttribute('hidden');
  });
});

describe('a binary provider’s preview has no status bar (FR-015e)', () => {
  it('draws neither the bar nor the button', async () => {
    m = await mountMarkdownPreview('', BINARY_FILE, { providers: { registry, views }, providerId: 'testBinary' });
    await screen.findByTestId(`fake-body-${m.id}`);

    expect(bar(m.id)).toBeNull();
    expect(button(m.id)).toBeNull();
    expect(screen.queryByTestId(`preview-sync-scroll-${m.id}`)).toBeNull();
  });
});

/*
 * 044 T235 — the scroll-sync toggle on a preview's bar (FR-122, FR-122a, FR-122c, FR-122e;
 * contracts/menus-and-controls.md §8, §10): immediately before the route button, standalone and parented
 * alike, pressed from the one global setting, writing it through the one command body.
 */
describe('the scroll-sync toggle (FR-122c)', () => {
  const toggle = (id: string): HTMLElement | null => screen.queryByTestId(`preview-sync-scroll-${id}`);

  /** `writeConfigPatch` reads `window.throng.config.writePatch` per call, so a spy set after mount is seen. */
  function spyPatches(result: { ok: true } | { ok: false; error: string } = { ok: true }) {
    const writePatch = vi.fn((_id: unknown, _changes: unknown) => Promise.resolve(result));
    (window.throng as unknown as { config: Record<string, unknown> }).config.writePatch = writePatch;
    return writePatch;
  }

  it('is an icon button with the syncScroll token, immediately before the route button', async () => {
    const { id } = await mountText();
    const t = await screen.findByTestId(`preview-sync-scroll-${id}`);
    expect(t.nextElementSibling).toBe(button(id));
    expect(t.closest('.editor-status-strip__group--controls')).not.toBeNull();
    expect(t).toHaveTextContent(THRONG_THEME.icons.syncScroll);
    expect(t.querySelector('svg')).toBeNull();
  });

  it('stays immediately before the route button when the preview is parented', async () => {
    const mounted = await mountText();
    const { id } = mounted;
    mounted.push(previewUpdate({ panelId: id, providerId: 'testText', filePath: TEXT_FILE, revision: 2, content: null, parent: { panelId: 'ed', title: 'notes' } }));
    await waitFor(() => expect(button(id)).toHaveAccessibleName('Go to Editor'));
    expect(toggle(id)?.nextElementSibling).toBe(button(id));
    expect(toggle(id)).toBeEnabled();
  });

  it('is pressed from the setting, live, and titled Synchronise Scrolling', async () => {
    const mounted = await mountText();
    const { id } = mounted;
    const t = await screen.findByTestId(`preview-sync-scroll-${id}`);
    expect(t).toHaveAttribute('aria-pressed', 'true');
    expect(t).toHaveAttribute('title', 'Synchronise Scrolling');
    expect(t).toHaveAccessibleName('Synchronise Scrolling');

    mounted.setSettings({ editor: { previews: { syncScroll: false } } });
    await waitFor(() => expect(toggle(id)).toHaveAttribute('aria-pressed', 'false'));
  });

  it('names the chord in its title only when preview.toggleSyncScroll is bound', async () => {
    Reflect.set(window, 'throng', {
      config: {
        get: () => Promise.resolve({ keybindings: { bindings: { 'preview.toggleSyncScroll': ['Ctrl+Alt+F8'] } } }),
        onChange: () => () => {},
      },
    });
    try {
      render(
        createElement(
          ConfigProvider,
          null,
          createElement(PreviewStatusBar, {
            panelId: 'pv',
            providerKind: 'text',
            parented: false,
            onEditorRoute: () => {},
            syncScroll: false,
            onToggleSyncScroll: () => {},
          }),
        ),
      );
      await waitFor(() => expect(screen.getByTestId('preview-sync-scroll-pv')).toHaveAttribute('title', 'Synchronise Scrolling (Ctrl+Alt+F8)'));
      expect(screen.getByTestId('preview-sync-scroll-pv')).toHaveAttribute('aria-pressed', 'false');
    } finally {
      Reflect.deleteProperty(window, 'throng');
    }
  });

  it('writes exactly the one key, once, when clicked — and follows the write', async () => {
    const { id } = await mountText();
    const t = await screen.findByTestId(`preview-sync-scroll-${id}`);
    const writePatch = spyPatches();
    fireEvent.click(t);
    await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
    expect(writePatch.mock.calls[0]).toEqual([{ kind: 'settings' }, [{ path: ['editor', 'previews', 'syncScroll'], value: false }]]);
    await waitFor(() => expect(toggle(id)).toHaveAttribute('aria-pressed', 'false'));
  });

  it('stays pressed when the write fails — no optimistic state (FR-122e)', async () => {
    const { id } = await mountText();
    const t = await screen.findByTestId(`preview-sync-scroll-${id}`);
    const writePatch = spyPatches({ ok: false, error: 'settings.json is read-only' });
    fireEvent.click(t);
    await waitFor(() => expect(writePatch).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(toggle(id)).toHaveAttribute('aria-pressed', 'true');
    expect(button(id)).toHaveAccessibleName('Open in Editor');
  });

  it('G2 — goes with the whole bar, and comes back with it', async () => {
    const mounted = await mountText();
    const { id } = mounted;
    await screen.findByTestId(`preview-sync-scroll-${id}`);
    mounted.setSettings({ editor: { showStatusBar: false } });
    await waitFor(() => expect(bar(id)).toBeNull());
    expect(toggle(id)).toBeNull();
    mounted.setSettings({ editor: { showStatusBar: true } });
    await waitFor(() => expect(toggle(id)).not.toBeNull());
  });
});
