/**
 * 054 T045 — a standalone `.mmd` / `.mermaid` preview (FR-042, FR-043, FR-044, FR-045, research R5).
 *
 * Layer: component — the real panel with the SHIPPED view for the `mermaid` provider, so what is proved is
 * that the provider is reached through the ordinary seam (044 US5) and draws the whole file through the
 * same `DiagramBlock`/`DiagramFrame` an embedded fence uses (FR-043). mermaid itself is faked through the
 * real renderer module, as in `preview-diagram-hostile.test.ts`: jsdom cannot lay out SVG.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBlockRenderer } from '../../src/renderer/preview/blocks/block-renderers.js';
import { createMermaidRenderer, type MermaidLike } from '../../src/renderer/preview/diagram/mermaid-renderer.js';
import { createDiagramSvgSanitiser } from '../../src/renderer/preview/diagram/svg-sanitise.js';
import { COLD, ROOT, mountMarkdownPreview, previewUpdate, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const FILE = `${ROOT}/flow.mmd`;

const mermaid: MermaidLike & { render: ReturnType<typeof vi.fn>; parse: ReturnType<typeof vi.fn> } = {
  initialize: vi.fn(),
  parse: vi.fn((source: string) => (source.includes('INVALID') ? Promise.reject(new Error('Parse error on line 2:\n...')) : Promise.resolve(true))),
  render: vi.fn((_id: string, source: string) =>
    Promise.resolve({
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><script>window.__pwned = 1</script><text>${source.trim()}</text></svg>`,
    }),
  ),
};
const sanitise = vi.fn(createDiagramSvgSanitiser(window));

let pv: MountedPreviewWindow | undefined;
let restore: (() => void) | null = null;

beforeEach(() => {
  sanitise.mockClear();
  mermaid.render.mockClear();
  const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(mermaid), sanitise });
  restore = registerBlockRenderer({ lang: 'mermaid', load: () => Promise.resolve(renderer) });
});

afterEach(() => {
  restore?.();
  pv?.unmount();
  pv = undefined;
  document.body.replaceChildren();
});

const frame = (): HTMLElement | null => screen.queryByTestId(`diagram-frame-${pv!.id}-diagram-0`);

async function mount(text: string): Promise<MountedPreviewWindow> {
  pv = await mountMarkdownPreview(text, FILE, { providerId: 'mermaid' });
  return pv;
}

describe('a standalone Mermaid preview (FR-042, FR-043)', () => {
  it('draws the whole file as one diagram, in a frame with its view controls', async () => {
    await mount('graph TD; A-->B\n');
    await waitFor(() => expect(frame()?.querySelector('svg text')?.textContent).toBe('graph TD; A-->B'), COLD);
    expect(within(frame()!).getByTitle('Fit diagram')).toBeInTheDocument();
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), 'graph TD; A-->B\n');
  });

  it('the diagram sanitiser is in the path (FR-045)', async () => {
    await mount('graph TD; A-->B\n');
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy(), COLD);
    expect(sanitise).toHaveBeenCalled();
    expect(frame()!.querySelector('script')).toBeNull();
  });

  it('follows content updates', async () => {
    const m = await mount('graph TD; A-->B\n');
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy(), COLD);
    m.push(previewUpdate({ panelId: m.id, filePath: FILE, providerId: 'mermaid', revision: 2, content: { kind: 'text', text: 'graph LR; X-->Y\n' } }));
    await waitFor(() => expect(frame()?.querySelector('svg text')?.textContent).toBe('graph LR; X-->Y'));
  });

  it('a source that does not parse shows the inline notice, and the last good diagram stays dimmed (FR-044)', async () => {
    const m = await mount('graph TD; A-->B\n');
    await waitFor(() => expect(frame()?.querySelector('svg')).toBeTruthy(), COLD);
    m.push(previewUpdate({ panelId: m.id, filePath: FILE, providerId: 'mermaid', revision: 2, content: { kind: 'text', text: 'graph TD; INVALID\n' } }));
    const notice = await screen.findByTestId(`diagram-notice-${m.id}-diagram-0`);
    expect(notice).toHaveTextContent('Parse error on line 2:');
    expect(frame()!.classList.contains('preview-diagram-frame--dimmed')).toBe(true);
  });

  it('never rendered and invalid: the notice alone', async () => {
    const m = await mount('INVALID\n');
    await screen.findByTestId(`diagram-notice-${m.id}-diagram-0`, {}, COLD);
    expect(frame()).toBeNull();
  });
});
