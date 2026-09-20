/**
 * 044 T195 (3) — the link target readout in a mounted preview panel (iteration 2026-09-15, FR-118;
 * contracts/menus-and-controls.md §8).
 *
 * The body reports hover and focus separately (`onLinkTarget`); the chrome resolves them — the hovered link
 * wins, the focused one is the fallback — and draws the result at the left of its status bar. Only a mounted
 * panel holds both halves, so this mounts one with the shipped Markdown view.
 *
 * Pointer events are dispatched as `MouseEvent`s under their pointer names: React listens by event name, and
 * a `MouseEvent` carries the `relatedTarget` the "moved inside the same link" case turns on, where jsdom's
 * fallback for a missing `PointerEvent` constructor would drop it.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COLD, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const DOC = [
  '# Links',
  '',
  'Plain words, then [Site](https://example.com/) and [Setup](docs/setup.md#install).',
  '',
  '[Picture ![logo](logo.png)](https://example.com/pictures)',
].join('\n');

let m: MountedPreviewWindow | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

function pointer(type: 'pointerover' | 'pointerout', target: Element, relatedTarget: Element | null = null): void {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget }));
  });
}

const linkEl = (name: string): HTMLElement => screen.getByText(name).closest<HTMLElement>('[data-throng-link]')!;

/** The readout's text, or `null` when the readouts group shows nothing. */
function readout(id: string): string | null {
  const bar = screen.getByTestId(`preview-status-bar-${id}`);
  const el = bar.querySelector('.editor-status-strip__group--readouts .editor-status-strip__readout');
  return el === null ? null : el.textContent;
}

async function mount(settings?: Record<string, unknown>): Promise<MountedPreviewWindow> {
  m = await mountMarkdownPreview(DOC, `${ROOT}/README.md`, settings ? { settings } : {});
  await screen.findByText('Site', {}, COLD);
  return m;
}

describe('the status bar names the hovered or focused link (FR-118)', () => {
  it('pointer over a link shows its target; pointer out clears it', async () => {
    const { id } = await mount();
    await screen.findByTestId(`preview-status-bar-${id}`);
    expect(readout(id)).toBeNull();

    const site = linkEl('Site');
    pointer('pointerover', site);
    await waitFor(() => expect(readout(id)).toBe('https://example.com/'));

    pointer('pointerout', site, screen.getByText(/Plain words/));
    await waitFor(() => expect(readout(id)).toBeNull());
  });

  it('keyboard focus on a link shows its target; focus leaving clears it', async () => {
    const { id } = await mount();
    const setup = linkEl('Setup');
    act(() => setup.focus());
    await waitFor(() => expect(readout(id)).toBe('docs/setup.md#install'));

    act(() => setup.blur());
    await waitFor(() => expect(readout(id)).toBeNull());
  });

  it('hover wins over focus, and focus shows again when the pointer leaves', async () => {
    const { id } = await mount();
    const site = linkEl('Site');
    const setup = linkEl('Setup');

    act(() => site.focus());
    await waitFor(() => expect(readout(id)).toBe('https://example.com/'));

    pointer('pointerover', setup);
    await waitFor(() => expect(readout(id)).toBe('docs/setup.md#install'));

    pointer('pointerout', setup, screen.getByText(/Plain words/));
    await waitFor(() => expect(readout(id)).toBe('https://example.com/'));
  });

  it('an image inside a link names the link, and moving from its text onto the image does not clear it', async () => {
    const { id } = await mount();
    const picture = linkEl('Picture');
    const image = picture.querySelector('img');
    expect(image).not.toBeNull();

    pointer('pointerover', image!);
    await waitFor(() => expect(readout(id)).toBe('https://example.com/pictures'));
    pointer('pointerout', image!, screen.getByText(/Plain words/));
    await waitFor(() => expect(readout(id)).toBeNull());

    const text = screen.getByText(/Picture/);
    pointer('pointerover', text);
    await waitFor(() => expect(readout(id)).toBe('https://example.com/pictures'));
    // Leaving the text FOR the image: the pointer is still over the same link.
    pointer('pointerout', text, image!);
    pointer('pointerover', image!);
    expect(readout(id)).toBe('https://example.com/pictures');
  });

  it('is cleared when the panel’s file changes', async () => {
    const mounted = await mount();
    const { id } = mounted;
    pointer('pointerover', linkEl('Site'));
    await waitFor(() => expect(readout(id)).toBe('https://example.com/'));

    mounted.push(
      previewUpdate({
        panelId: id,
        filePath: `${ROOT}/docs/other.md`,
        content: { kind: 'text', text: '# Other\n\nNo links here.\n' },
        revision: 2,
      }),
    );
    await screen.findByText('No links here.', {}, COLD);
    await waitFor(() => expect(readout(id)).toBeNull());
  });

  it('with editor.showStatusBar off, no bar is rendered — the link’s tooltip is the surface', async () => {
    const { id } = await mount({ editor: { showStatusBar: false } });
    const site = linkEl('Site');
    pointer('pointerover', site);
    fireEvent.focus(site);
    await waitFor(() => expect(screen.queryByTestId(`preview-status-bar-${id}`)).toBeNull());
    expect(document.querySelector('.editor-status-strip__readout')).toBeNull();
    expect(site.getAttribute('title')).toBe('https://example.com/');
  });
});
