/**
 * 054 FR-044, FR-046g — a diagram's last good render and its view state belong to the FILE it was drawn from.
 *
 * Layer: component — the carry-over is the Markdown body keeping its diagram hosts and portal keys by
 * ordinal across draws; only the real body in the real panel shows it. mermaid is faked through the real
 * renderer module (jsdom cannot lay out SVG), as in `preview-mermaid-standalone.test.ts`.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBlockRenderer } from '../../src/renderer/preview/blocks/block-renderers.js';
import { createMermaidRenderer, type MermaidLike } from '../../src/renderer/preview/diagram/mermaid-renderer.js';
import { createDiagramSvgSanitiser } from '../../src/renderer/preview/diagram/svg-sanitise.js';
import { getMaximiseStack, maximiseSection, tabOfMaximisePanel } from '../../src/renderer/workspace/maximise-store.js';
import { COLD, README, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const OTHER = `${ROOT}/other.md`;
const fence = (body: string): string => ['# Doc', '', '```mermaid', body, '```', ''].join('\n');

const mermaid: MermaidLike = {
  initialize: vi.fn(),
  parse: vi.fn((source: string) => (source.includes('INVALID') ? Promise.reject(new Error('Parse error on line 2:\n...')) : Promise.resolve(true))),
  render: vi.fn((_id: string, source: string) =>
    Promise.resolve({ svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text>${source.trim()}</text></svg>` }),
  ),
};

let pv: MountedPreviewWindow | undefined;
let restore: (() => void) | null = null;

beforeEach(() => {
  const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(mermaid), sanitise: createDiagramSvgSanitiser(window) });
  restore = registerBlockRenderer({ lang: 'mermaid', load: () => Promise.resolve(renderer) });
});

afterEach(() => {
  restore?.();
  pv?.unmount();
  pv = undefined;
  document.body.replaceChildren();
});

const frame = (): HTMLElement | null => screen.queryByTestId(`diagram-frame-${pv!.id}-diagram-0`);

/** The panel moves to another file the way a followed link or a history step does: a raised navigation. */
function navigateTo(text: string, revision = 2): void {
  pv!.push(previewUpdate({ panelId: pv!.id, filePath: OTHER, revision, navigationSeq: 1, content: { kind: 'text', text } }));
}

describe('a diagram does not carry state into another file (FR-044, FR-046g)', () => {
  it('an invalid diagram in the new file shows the notice with NO dimmed drawing from the old one', async () => {
    pv = await mountMarkdownPreview(fence('graph TD; A-->B'), README);
    await waitFor(() => expect(frame()?.querySelector('svg text')?.textContent).toBe('graph TD; A-->B'), COLD);

    navigateTo(fence('graph TD; INVALID'));

    await screen.findByTestId(`diagram-notice-${pv.id}-diagram-0`, {}, COLD);
    expect(frame()).toBeNull();
    expect(document.body.querySelector('.preview-diagram-frame--dimmed')).toBeNull();
  });

  it('a valid diagram in the new file starts in Fit, whatever the old one was zoomed to', async () => {
    pv = await mountMarkdownPreview(fence('graph TD; A-->B'), README);
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy(), COLD);
    fireEvent.click(within(frame()!).getByTitle('Zoom in'));
    expect(frame()!.getAttribute('data-mode')).toBe('zoom');

    navigateTo(fence('graph LR; X-->Y'));

    await waitFor(() => expect(frame()?.querySelector('svg text')?.textContent).toBe('graph LR; X-->Y'), COLD);
    expect(frame()!.getAttribute('data-mode')).toBe('fit');
  });

  it('a Full Pane target of a diagram the new file does not have is released; one it still has is kept (FR-073)', async () => {
    const two = [fence('graph TD; A-->B'), fence('graph TD; C-->D')].join('\n');
    pv = await mountMarkdownPreview(two, README);
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy(), COLD);
    const tabId = tabOfMaximisePanel(pv.id)!;
    maximiseSection(tabId, pv.id, 'diagram-0', () => null);
    maximiseSection(tabId, pv.id, 'diagram-1', () => null);

    // Same file edited down to one diagram: diagram-1 is really gone.
    expect(getMaximiseStack(tabId).map((t) => (t.kind === 'section' ? t.sectionId : t.kind))).toEqual(['diagram-0', 'diagram-1']);
    pv.push(previewUpdate({ panelId: pv.id, revision: 2, content: { kind: 'text', text: fence('graph TD; A-->B') } }));
    await waitFor(() => expect(getMaximiseStack(tabId).map((t) => (t.kind === 'section' ? t.sectionId : t.kind))).toEqual(['diagram-0']));

    // Another file: nothing carries over.
    navigateTo('# Plain\n', 3);
    await waitFor(() => expect(getMaximiseStack(tabId)).toEqual([]));
  });

  it('an edit WITHIN the same file keeps the zoom (the ordinal keying stays)', async () => {
    pv = await mountMarkdownPreview(fence('graph TD; A-->B'), README);
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy(), COLD);
    fireEvent.click(within(frame()!).getByTitle('Zoom in'));

    pv.push(previewUpdate({ panelId: pv.id, revision: 2, content: { kind: 'text', text: fence('graph TD; A-->B') + '\nMore.\n' } }));

    await waitFor(() => expect(document.body.textContent).toContain('More.'));
    expect(frame()!.getAttribute('data-mode')).toBe('zoom');
  });
});
