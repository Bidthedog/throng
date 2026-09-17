/**
 * 044 T107 — a standalone preview ADOPTS a parent in place, and lets it go (FR-013, FR-013a, FR-013b,
 * FR-015c, FR-015d, FR-031, FR-040, FR-043; US2 scenario 3).
 *
 * ══ NOTHING MOVES ══
 *
 * Whether a preview is parented is derived, never stored (FR-013): main's `PreviewService` makes the
 * run follow the document the moment an editor registers the file, and says so on the next update as
 * `parent: { panelId, title }`. The renderer's whole part is to DRAW that from `preview-store` — the
 * same panel, in the same slot of the same tab, with the same body still mounted (so the reader keeps
 * their place, FR-024) — while the chrome changes: the title takes the parent's name, the unsaved dot
 * follows `dirty`, and the route back to the source reads *Go to Editor* instead of *Open in Editor*.
 * `parent: null` (the editor closed) reverses every one of those.
 *
 * The whole window is mounted (real `PanelPlaceholder`, the shipped Markdown body) and main's updates
 * are pushed exactly as they arrive.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editorAutoTitle } from '@throng/core';
import { __resetPreviewStore } from '../../src/renderer/preview/preview-store.js';
import { COLD, README, mountMarkdownPreview, previewUpdate, type MountedPreview } from './helpers/mount-preview-panel.js';

let m: MountedPreview | undefined;

async function mountStandalone(): Promise<MountedPreview> {
  m = await mountMarkdownPreview('# Readme\n\nOn disk.\n');
  await screen.findByText('On disk.', {}, COLD);
  return m;
}

const panel = (): MountedPreview => m!;
const title = (): string => screen.getByTestId(`panel-title-${panel().id}`).textContent ?? '';
const dot = (): HTMLElement | null => screen.queryByTestId(`panel-unsaved-${panel().id}`);
const STANDALONE_TITLE = `${editorAutoTitle(README)} - Preview`;

async function headerMenuLabels(): Promise<string[]> {
  fireEvent.contextMenu(screen.getByTestId(`panel-handle-${panel().id}`));
  const menu = await screen.findByRole('menu');
  const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((el) =>
    (el.getAttribute('data-testid') ?? '').replace(/^menu-item-/, ''),
  );
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return labels;
}

const parentOf = { panelId: 'ed-1', title: 'Release notes' };

beforeEach(() => {
  __resetPreviewStore();
});

afterEach(() => {
  m?.unmount();
  m = undefined;
  document.body.replaceChildren();
});

describe('becoming parented, in place (FR-013a)', () => {
  it('keeps the same panel, the same slot and the same mounted body', async () => {
    await mountStandalone();
    const id = panel().id;
    const box = screen.getByTestId(`panel-${id}`);
    const bodyHost = screen.getByTestId(`preview-body-${id}`);
    const rendered = screen.getByText('On disk.');
    const panelsBefore = document.querySelectorAll('.panel-box').length;

    panel().push(previewUpdate({ panelId: id, revision: 2, content: null, parent: parentOf }));

    expect(screen.getByTestId(`panel-${id}`)).toBe(box);
    expect(screen.getByTestId(`preview-body-${id}`)).toBe(bodyHost);
    expect(screen.getByText('On disk.')).toBe(rendered);
    expect(document.querySelectorAll('.panel-box')).toHaveLength(panelsBefore);
  });

  it('takes the parent editor’s name in its title (FR-031)', async () => {
    await mountStandalone();
    expect(title()).toBe(STANDALONE_TITLE);

    panel().push(previewUpdate({ panelId: panel().id, revision: 2, content: null, parent: parentOf }));

    expect(title()).toBe('Release notes - Preview');
  });

  it('wears the source document’s unsaved dot exactly while main says dirty (FR-040)', async () => {
    await mountStandalone();
    panel().push(previewUpdate({ panelId: panel().id, revision: 2, content: null, parent: parentOf }));
    expect(dot()).toBeNull();

    panel().push(previewUpdate({ panelId: panel().id, revision: 3, content: null, parent: parentOf, dirty: true }));
    expect(dot()).toBeInTheDocument();

    panel().push(previewUpdate({ panelId: panel().id, revision: 4, content: null, parent: parentOf, dirty: false }));
    expect(dot()).toBeNull();
  });

  it('follows the live buffer the parented update carries, without remounting the body', async () => {
    await mountStandalone();
    const bodyHost = screen.getByTestId(`preview-body-${panel().id}`);
    panel().push(previewUpdate({ panelId: panel().id, revision: 2, content: null, parent: parentOf }));
    panel().push(
      previewUpdate({
        panelId: panel().id,
        revision: 3,
        content: { kind: 'text', text: '# Readme\n\nTyped, not saved.\n' },
        parent: parentOf,
        dirty: true,
      }),
    );

    expect(await screen.findByText('Typed, not saved.')).toBeVisible();
    expect(screen.getByTestId(`preview-body-${panel().id}`)).toBe(bodyHost);
  });

  it('offers Go to Editor instead of Open in Editor (FR-015c, FR-015d)', async () => {
    await mountStandalone();
    const before = await headerMenuLabels();
    expect(before).toContain('Open in Editor');
    expect(before).not.toContain('Go to Editor');

    panel().push(previewUpdate({ panelId: panel().id, revision: 2, content: null, parent: parentOf }));

    const after = await headerMenuLabels();
    expect(after).toContain('Go to Editor');
    expect(after).not.toContain('Open in Editor');
  });
});

describe('falling back when the parent closes (FR-013b)', () => {
  it('parent: null reverts the title, clears the dot and the route back, in the same panel', async () => {
    await mountStandalone();
    const id = panel().id;
    const box = screen.getByTestId(`panel-${id}`);
    panel().push(previewUpdate({ panelId: id, revision: 2, content: null, parent: parentOf, dirty: true }));
    expect(dot()).toBeInTheDocument();

    // Main re-reads the disk on the way back and sends it with the standalone state.
    panel().push(
      previewUpdate({ panelId: id, revision: 3, content: { kind: 'text', text: '# Readme\n\nOn disk again.\n' }, parent: null, dirty: false }),
    );

    expect(title()).toBe(STANDALONE_TITLE);
    expect(dot()).toBeNull();
    expect(await screen.findByText('On disk again.')).toBeVisible();
    expect(screen.getByTestId(`panel-${id}`)).toBe(box);
    const labels = await headerMenuLabels();
    expect(labels).toContain('Open in Editor');
    expect(labels).not.toContain('Go to Editor');
  });

  it('a standalone preview never wears the dot, even if an update were to say dirty (FR-043)', async () => {
    await mountStandalone();
    panel().push(previewUpdate({ panelId: panel().id, revision: 2, content: null, parent: null, dirty: true }));
    expect(dot()).toBeNull();
  });
});
