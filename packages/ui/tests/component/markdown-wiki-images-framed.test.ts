/**
 * 074 FR-055 (R8a) — a wiki image embed standing as its own paragraph (`![[x.png]]`, `![[x.svg|200]]`) is drawn in
 * the same diagram frame, with the same controls, as `![alt](x.png)`: one claim path for both spellings.
 *
 * Layer: component — the mounted Markdown body with the `resolveWikiTargets` answer main gives; jsdom decodes no
 * image, so the browser picture loader is spied.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserPictureLoader } from '../../src/renderer/preview/blocks/picture.js';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const COLD = { timeout: 10_000 };

const baseProps = (text: string, extra: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: 'D:/proj/note.md',
  projectRoot: 'D:/proj',
  providerSettings: { enabled: true },
  initialViewState: undefined,
  onViewStateCapture: () => {},
  onFollow: () => {},
  onNotice: () => {},
  onDrawn: () => {},
  onBodyFailure: () => {},
  ...extra,
});

beforeEach(() => {
  vi.spyOn(browserPictureLoader, 'load').mockResolvedValue({ width: 64, height: 32 });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** The framed picture's `<svg>` under the first diagram frame, or `null`. */
const framedPicture = (): SVGSVGElement | null =>
  document.querySelector<SVGSVGElement>('.preview-diagram-frame svg[data-throng-picture]');

describe('a wiki image embed alone on its line is framed like ![alt](x.png) (FR-055)', () => {
  it('the standard spelling is framed with the diagram controls (the reference behaviour)', async () => {
    render(createElement(MarkdownBody, baseProps('![Logo](img/x.png)\n')));
    await waitFor(() => expect(framedPicture()?.querySelector('image')?.getAttribute('href')).toMatch(/^throng-preview:\/\/asset\/.+x\.png$/), COLD);
    expect(screen.getByRole('toolbar', { name: 'Diagram view' })).toBeInTheDocument();
  });

  it('![[x.png]] is framed with the same controls, keeping its alternative text', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: ['D:/proj/img/x.png'] });
    render(createElement(MarkdownBody, baseProps('![[img/x.png]]\n', { resolveWikiTargets })));
    await waitFor(() => expect(framedPicture()?.querySelector('image')?.getAttribute('href')).toMatch(/^throng-preview:\/\/asset\/.+x\.png$/), COLD);
    expect(framedPicture()!.getAttribute('aria-label')).toBe('x.png');
    expect(screen.getByRole('toolbar', { name: 'Diagram view' })).toBeInTheDocument();
    // Drawn once, in the frame — no bare <img> left in a paragraph beside it.
    expect(document.querySelector('.preview-markdown p img')).toBeNull();
  });

  it('![[x.svg|200]] is framed at the width its alias gives, its height kept in proportion', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: ['D:/proj/x.svg'] });
    render(createElement(MarkdownBody, baseProps('![[x.svg|200]]\n', { resolveWikiTargets })));
    await waitFor(() => expect(framedPicture()?.querySelector('image')?.getAttribute('href')).toMatch(/x\.svg$/), COLD);
    expect(framedPicture()!.getAttribute('width')).toBe('200');
    expect(framedPicture()!.getAttribute('height')).toBe('100');
  });

  it('the same image embedded twice at different sizes draws each at its own size (B1)', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: ['D:/proj/x.png', 'D:/proj/x.png'] });
    render(createElement(MarkdownBody, baseProps('![[x.png|100]]\n\n![[x.png|300]]\n', { resolveWikiTargets })));
    const pictures = (): SVGSVGElement[] => [...document.querySelectorAll<SVGSVGElement>('.preview-diagram-frame svg[data-throng-picture]')];
    await waitFor(() => expect(pictures()).toHaveLength(2), COLD);
    await waitFor(() => expect(pictures().map((p) => p.getAttribute('viewBox'))).toEqual(['0 0 100 50', '0 0 300 150']), COLD);
    expect(pictures().map((p) => p.querySelector('image')?.getAttribute('width'))).toEqual(['100', '300']);
  });

  it('an embed inline with text stays an image in its sentence', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: ['D:/proj/b.png'] });
    render(createElement(MarkdownBody, baseProps('A badge ![[b.png]] in a sentence.\n', { resolveWikiTargets })));
    await waitFor(() => expect(document.querySelector('p img[src$="b.png"]')).toBeTruthy(), COLD);
    expect(framedPicture()).toBeNull();
  });

  it('an embed main cannot resolve keeps its alternative text, unframed', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: [null] });
    render(createElement(MarkdownBody, baseProps('![[gone.png]]\n', { resolveWikiTargets })));
    await waitFor(() => expect(resolveWikiTargets).toHaveBeenCalled(), COLD);
    await waitFor(() => expect(document.querySelector('.preview-markdown')?.textContent).toContain('gone.png'), COLD);
    expect(framedPicture()).toBeNull();
  });
});
