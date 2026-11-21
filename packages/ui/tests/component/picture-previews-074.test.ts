/**
 * 074 — the SVG and Image previews, and SVG / framed images in a Markdown preview, through the real panel and the
 * SHIPPED views (FR-030, FR-031, FR-040, FR-022, FR-020, FR-054, FR-055, FR-053).
 *
 * Layer: component — the real chrome and seam; jsdom decodes no image, so the browser picture loader is spied.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserPictureLoader } from '../../src/renderer/preview/blocks/picture.js';
import { diagramActionsAt } from '../../src/renderer/preview/diagram/diagram-actions.js';
import { isPanelFindAbsent } from '../../src/renderer/preview/unsearchable-panels.js';
import { pathForms } from '@throng/core';
import { COLD, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

let pv: MountedPreviewWindow | undefined;

beforeEach(() => {
  vi.spyOn(browserPictureLoader, 'load').mockResolvedValue({ width: 64, height: 32 });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  pv?.unmount();
  pv = undefined;
  document.body.replaceChildren();
});

const frame = (section = 'diagram-0'): HTMLElement | null => screen.queryByTestId(`diagram-frame-${pv!.id}-${section}`);

describe('an SVG Preview (FR-030, FR-031, FR-040)', () => {
  it('draws the file as one isolated picture in the diagram frame, with its view controls', async () => {
    pv = await mountMarkdownPreview('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><script>x()</script></svg>', `${ROOT}/logo.svg`, {
      providerId: 'svg',
    });
    await waitFor(() => expect(frame()?.querySelector('image')).toBeTruthy(), COLD);
    expect(frame()!.querySelector('image')!.getAttribute('href')).toMatch(/^blob:/);
    expect(frame()!.querySelector('script')).toBeNull();
    expect(within(frame()!).getByTitle('Fit diagram')).toBeInTheDocument();
    // FR-031 — no inline Maximise: the panel header's Focus Mode maximises the one picture.
    expect(within(frame()!).queryByTitle('Enter Focus Mode')).toBeNull();
  });

  it('shows the notice, not a blank panel, for a malformed SVG (FR-045)', async () => {
    pv = await mountMarkdownPreview('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', `${ROOT}/bad.svg`, { providerId: 'svg' });
    await waitFor(() => expect(screen.getByTestId(`diagram-notice-${pv!.id}-diagram-0`).textContent).toMatch(/This SVG could not be drawn/), COLD);
  });
});

describe('an Image Preview (FR-020, FR-022, FR-030)', () => {
  const resource = { kind: 'resource' as const, url: 'throng-preview://source/p1?rev=1' };

  it('draws the source URL as a picture and names its pixel size in the status bar', async () => {
    pv = await mountMarkdownPreview('', `${ROOT}/shot.png`, { providerId: 'image', attach: { content: resource } });
    await waitFor(() => expect(frame()?.querySelector('image')?.getAttribute('href')).toBe(resource.url), COLD);
    await waitFor(() => expect(screen.getByTestId(`preview-status-readout-${pv!.id}`).textContent).toContain('64 × 32 pixels'));
  });

  // FR-020a (2026-11-19) — an Image and an SVG preview open in the opening view (100%, or Fit when larger than the
  // panel; the rule itself is `preview-diagram-frame.test.ts`'s), with no setting to choose otherwise.
  it('an Image and an SVG preview open in the opening view', async () => {
    pv = await mountMarkdownPreview('', `${ROOT}/shot.png`, { providerId: 'image', attach: { content: resource } });
    await waitFor(() => expect(frame()?.getAttribute('data-mode')).toBe('open'), COLD);
    pv.unmount();
    document.body.replaceChildren();
    pv = await mountMarkdownPreview('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>', `${ROOT}/logo.svg`, { providerId: 'svg' });
    await waitFor(() => expect(frame()?.getAttribute('data-mode')).toBe('open'), COLD);
  });

  // FR-086a (2026-11-19) — a picture has no text: its panel registers Find as absent, for both menus and the chord.
  it('an Image and an SVG preview register Find as absent', async () => {
    pv = await mountMarkdownPreview('', `${ROOT}/shot.png`, { providerId: 'image', attach: { content: resource } });
    await waitFor(() => expect(isPanelFindAbsent(pv!.id)).toBe(true), COLD);
    pv.unmount();
    document.body.replaceChildren();
    pv = await mountMarkdownPreview('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>', `${ROOT}/logo.svg`, { providerId: 'svg' });
    await waitFor(() => expect(isPanelFindAbsent(pv!.id)).toBe(true), COLD);
  });

  // FR-033 (2026-11-19) — the body menu reads Copy Image over an image or SVG: each registers its drawing as a picture.
  it('an Image and an SVG preview register their drawing as a picture, for the menu’s Copy Image', async () => {
    pv = await mountMarkdownPreview('', `${ROOT}/shot.png`, { providerId: 'image', attach: { content: resource } });
    await waitFor(() => expect(diagramActionsAt(frame()?.querySelector('image') ?? null)?.picture).toBe(true), COLD);
    pv.unmount();
    document.body.replaceChildren();
    pv = await mountMarkdownPreview('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>', `${ROOT}/logo.svg`, { providerId: 'svg' });
    await waitFor(() => expect(diagramActionsAt(frame()?.querySelector('svg[data-throng-picture]') ?? null)?.picture).toBe(true), COLD);
  });

  // 2026-11-19 — the fill rules named `.preview-mermaid` alone, so an Image or SVG preview's viewport collapsed to its
  // 36px floor (off-centre picture, clipped toolbar, no visible zoom). jsdom has no layout: the classes the fill rules
  // select on are what is pinned here, and the rules' selector is `diagram-css.test.ts`'s.
  it('fills its panel as every one-drawing body does, on a scrolling canvas with a hatch (FR-031, FR-031a, FR-027b)', async () => {
    pv = await mountMarkdownPreview('', `${ROOT}/shot.png`, { providerId: 'image', attach: { content: resource } });
    await waitFor(() => expect(frame()?.querySelector('image')).toBeTruthy(), COLD);
    expect(screen.getByTestId(`preview-image-${pv.id}`)).toHaveClass('preview-drawing-file');
    expect(frame()).toHaveClass('preview-diagram-frame--fills');
    expect(frame()).toHaveClass('preview-diagram-frame--scrolls');
    expect(screen.getByTestId(`diagram-hatch-${pv.id}-diagram-0`)).toBeInTheDocument();
  });

  // 074 convergence T062 — FR-028 (and FR-068a for a PDF): the body menu offers Copy Path, in the four forms the File
  // Explorer offers, alongside Copy Image.
  it('offers Copy Path in the body menu, and copies the form picked', async () => {
    pv = await mountMarkdownPreview('', `${ROOT}/shot.png`, { providerId: 'image', attach: { content: resource } });
    await waitFor(() => expect(frame()?.querySelector('image')).toBeTruthy(), COLD);
    fireEvent.contextMenu(screen.getByTestId(`preview-image-${pv.id}`), { clientX: 5, clientY: 5 });
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((el) => el.textContent?.trim())).toContain('Copy Path'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Copy Path/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Absolute \(POSIX\)/ }));
    await waitFor(() =>
      expect(pv!.clipboardWrite).toHaveBeenCalledWith({ text: pathForms(ROOT, 'shot.png').absPosix, mode: 'verbatim' }),
    );
  });

  it('draws no hatch when Image: Hatch transparent areas is off (FR-027b)', async () => {
    pv = await mountMarkdownPreview('', `${ROOT}/shot.png`, {
      providerId: 'image',
      attach: { content: resource },
      settings: { editor: { previews: { providers: { image: { transparencyHatch: false } } } } },
    });
    await waitFor(() => expect(frame()?.querySelector('image')).toBeTruthy(), COLD);
    expect(screen.queryByTestId(`diagram-hatch-${pv.id}-diagram-0`)).toBeNull();
  });
});

describe('an SVG Preview fills its panel too (FR-031, FR-031a, FR-027b)', () => {
  it('on a scrolling canvas, hatched unless SVG: Hatch transparent areas is off', async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>';
    pv = await mountMarkdownPreview(source, `${ROOT}/logo.svg`, { providerId: 'svg' });
    await waitFor(() => expect(frame()?.querySelector('image')).toBeTruthy(), COLD);
    expect(screen.getByTestId(`preview-svg-${pv.id}`)).toHaveClass('preview-drawing-file');
    expect(frame()).toHaveClass('preview-diagram-frame--scrolls');
    expect(screen.getByTestId(`diagram-hatch-${pv.id}-diagram-0`)).toBeInTheDocument();
    pv.unmount();

    pv = await mountMarkdownPreview(source, `${ROOT}/logo.svg`, {
      providerId: 'svg',
      settings: { editor: { previews: { providers: { svg: { transparencyHatch: false } } } } },
    });
    await waitFor(() => expect(frame()?.querySelector('image')).toBeTruthy(), COLD);
    expect(screen.queryByTestId(`diagram-hatch-${pv.id}-diagram-0`)).toBeNull();
  });
});

describe('SVG and images in a Markdown preview (FR-053, FR-054, FR-055)', () => {
  it('draws a ```svg fence as a picture in a diagram frame', async () => {
    pv = await mountMarkdownPreview('# Note\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>\n```\n', `${ROOT}/note.md`);
    await waitFor(() => expect(frame()?.querySelector('image')?.getAttribute('href')).toMatch(/^blob:/), COLD);
  });

  it('still removes raw inline <svg> markup with its content', async () => {
    pv = await mountMarkdownPreview('before\n\n<svg><text>INLINE</text></svg>\n\nafter\n', `${ROOT}/note.md`);
    await waitFor(() => expect(screen.getByText('after')).toBeInTheDocument(), COLD);
    expect(document.body.textContent).not.toContain('INLINE');
    expect(document.querySelector('.preview-body svg text')).toBeNull();
  });

  it('frames a local image standing alone, and leaves one inline with text as it is', async () => {
    pv = await mountMarkdownPreview('![Logo](img/logo.svg)\n\nA badge ![b](img/b.png) in a sentence.\n', `${ROOT}/note.md`);
    await waitFor(() => expect(frame()?.querySelector('image')?.getAttribute('href')).toMatch(/^throng-preview:\/\/asset\/.+logo\.svg$/), COLD);
    expect(frame()!.querySelector('svg[data-throng-picture]')!.getAttribute('aria-label')).toBe('Logo');
    // The inline badge stays an <img> in its paragraph.
    expect(document.querySelector('p img[alt="b"]')).toBeTruthy();
  });
});
