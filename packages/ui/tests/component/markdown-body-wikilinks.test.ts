/**
 * 047 T063 (R12, FR-055) — the Markdown body's batched wiki-target resolution, wired to the
 * `resolveWikiTargets` prop `preview-panel.tsx` supplies. `wiki-resolution.test.ts` proves
 * `applyWikiResolution` itself over a plain DOM tree; `preview-wikilinks-sanitise.test.ts` proves a
 * wikilink survives the real sanitiser with its `data-throng-wiki-index`. This is the WIRING: that a
 * mounted body actually calls the prop with what `render()` collected, and applies what it answers.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from '../../src/renderer/preview/providers/markdown/markdown-body.js';
import type { PreviewBodyProps } from '../../src/renderer/preview/provider-view.js';

const COLD = { timeout: 10_000 };

const baseProps = (text: string, extra: Partial<PreviewBodyProps> = {}): PreviewBodyProps => ({
  panelId: 'p1',
  content: { kind: 'text', text },
  filePath: 'D:/proj/README.md',
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

afterEach(() => vi.restoreAllMocks());

describe('MarkdownBody batches resolveWikiTargets after each draw (T063)', () => {
  it('calls resolveWikiTargets with the render’s wiki targets, and marks a null answer unresolved', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: [null] });
    render(createElement(MarkdownBody, baseProps('[[Missing]]', { resolveWikiTargets })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('a')).not.toBeNull(), COLD);

    await waitFor(() => expect(resolveWikiTargets).toHaveBeenCalledWith([{ path: 'Missing', rooted: false }]));
    await waitFor(() => expect(host.querySelector('a')?.classList.contains('preview-link--unresolved')).toBe(true));
  });

  it('a resolved target carries no unresolved class', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: ['D:/proj/Note.md'] });
    render(createElement(MarkdownBody, baseProps('[[Note]]', { resolveWikiTargets })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('a')).not.toBeNull(), COLD);
    await waitFor(() => expect(resolveWikiTargets).toHaveBeenCalled());
    // Give the resolved promise's .then() a turn, then assert the negative held.
    await waitFor(() => expect(host.querySelector('a')?.getAttribute('data-throng-wiki-index')).toBe('0'));
    expect(host.querySelector('a')?.classList.contains('preview-link--unresolved')).toBe(false);
  });

  it('never calls resolveWikiTargets for a document with no wikilinks', async () => {
    const resolveWikiTargets = vi.fn().mockResolvedValue({ resolved: [] });
    render(createElement(MarkdownBody, baseProps('# Just a heading', { resolveWikiTargets })));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('h1')).not.toBeNull(), COLD);
    expect(resolveWikiTargets).not.toHaveBeenCalled();
  });

  it('a body with no resolveWikiTargets prop draws the wikilink and never throws', async () => {
    render(createElement(MarkdownBody, baseProps('[[Note]]')));
    const host = screen.getByTestId('preview-markdown-p1');
    await waitFor(() => expect(host.querySelector('a')).not.toBeNull(), COLD);
    expect(host.querySelector('a')?.textContent).toBe('Note');
  });
});
