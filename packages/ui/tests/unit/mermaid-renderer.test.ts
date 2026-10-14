import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIAGRAM_RENDER_TIMEOUT_MS,
  createMermaidRenderer,
  mermaidThemeVariables,
  type MermaidLike,
} from '../../src/renderer/preview/diagram/mermaid-renderer.js';
import { createDiagramSvgSanitiser } from '../../src/renderer/preview/diagram/svg-sanitise.js';
import type { DiagramTheme } from '../../src/renderer/preview/diagram/diagram-theme.js';

/**
 * 054 T034 — the Mermaid renderer's contract (FR-044 – FR-048, research R5), with a FAKE mermaid module:
 * jsdom cannot lay out SVG (`getBBox`), so the real library is exercised only in Electron
 * (`preview-mermaid.e2e.ts`). What is proved here is everything the renderer itself decides: how it
 * initialises mermaid, that every SVG goes through the diagram sanitiser, and the timeout bound.
 */
const { window } = new JSDOM('');
const realSanitise = createDiagramSvgSanitiser(window as unknown as Window & typeof globalThis);

const THEME: DiagramTheme = {
  background: '#101010',
  foreground: '#eeeeee',
  muted: '#999999',
  accent: '#3388ff',
  border: '#444444',
  surface: '#202020',
  selection: '#304060',
  fontFamily: 'Fira Sans',
  key: 'dark',
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" id="m1"><script>alert(1)</script><rect onclick="x()" width="5"/></svg>';

function fakeMermaid(over: Partial<MermaidLike> = {}): MermaidLike & { initialize: ReturnType<typeof vi.fn> } {
  return {
    initialize: vi.fn(),
    parse: vi.fn(() => Promise.resolve(true)),
    render: vi.fn(() => Promise.resolve({ svg: SVG })),
    ...over,
  } as MermaidLike & { initialize: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('initialisation (FR-045, FR-046)', () => {
  let mermaid: ReturnType<typeof fakeMermaid>;
  beforeEach(async () => {
    mermaid = fakeMermaid();
    const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(mermaid), sanitise: realSanitise });
    await renderer.render('graph TD; A-->B', { theme: THEME });
  });

  it('runs at the strictest security level, never on load, with no HTML labels', () => {
    const config = mermaid.initialize.mock.calls[0][0];
    expect(config).toMatchObject({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: 'base',
    });
  });

  it('locks the settings a diagram directive could otherwise override (secure list)', () => {
    const config = mermaid.initialize.mock.calls[0][0];
    expect(config.secure).toEqual(expect.arrayContaining(['securityLevel', 'themeCSS', 'fontFamily', 'htmlLabels']));
  });

  it('takes its colours and font from the theme tokens', () => {
    const config = mermaid.initialize.mock.calls[0][0];
    expect(config.themeVariables).toMatchObject({
      background: '#101010',
      primaryTextColor: '#eeeeee',
      primaryBorderColor: '#444444',
      lineColor: '#999999',
      fontFamily: 'Fira Sans',
      darkMode: true,
    });
  });

  it('a light background is not dark mode', () => {
    expect(mermaidThemeVariables({ ...THEME, background: '#fafafa' }).darkMode).toBe(false);
  });
});

describe('every SVG passes the diagram sanitiser (FR-045)', () => {
  it('hands mermaid\'s SVG to the sanitiser and returns the sanitiser\'s answer', async () => {
    const sanitise = vi.fn(realSanitise);
    const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(fakeMermaid()), sanitise });

    const svg = await renderer.render('graph TD; A-->B', { theme: THEME });

    expect(sanitise).toHaveBeenCalledWith(SVG);
    expect(svg).toBe(sanitise.mock.results[0].value);
    expect(svg.outerHTML).not.toMatch(/script|onclick/);
  });

  it('rejects when the sanitiser leaves nothing to draw', async () => {
    const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(fakeMermaid()), sanitise: () => null });
    await expect(renderer.render('graph TD', { theme: THEME })).rejects.toThrow();
  });
});

describe('failures (FR-044, FR-048)', () => {
  it('a parse error rejects with the first line of mermaid\'s message, never the whole stack', async () => {
    const mermaid = fakeMermaid({ parse: vi.fn(() => Promise.reject(new Error('Parse error on line 2:\n...A-->\n---^\nExpecting X'))) });
    const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(mermaid), sanitise: realSanitise });
    await expect(renderer.render('graph TD; A-->', { theme: THEME })).rejects.toThrow(/^Parse error on line 2:$/);
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it(`a render that takes longer than ${DIAGRAM_RENDER_TIMEOUT_MS} ms rejects as a timeout`, async () => {
    vi.useFakeTimers();
    const mermaid = fakeMermaid({ render: vi.fn(() => new Promise<{ svg: string }>(() => undefined)) });
    const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(mermaid), sanitise: realSanitise });
    const outcome = renderer.render('graph TD; A-->B', { theme: THEME });
    const settled = expect(outcome).rejects.toThrow(/longer than 5 seconds/);
    await vi.advanceTimersByTimeAsync(DIAGRAM_RENDER_TIMEOUT_MS + 1);
    await settled;
  });

  it('the bound is 5000 ms', () => {
    expect(DIAGRAM_RENDER_TIMEOUT_MS).toBe(5000);
  });
});

/** 054 (manual test change request, 2026-10-12) — a source drawn before, under the same theme, skips mermaid. */
describe('the render cache', () => {
  const idSvg = (id: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><marker id="${id}_pointEnd"/><path marker-end="url(#${id}_pointEnd)"/></svg>`;

  it('draws a repeated source without mermaid, under fresh ids', async () => {
    const mermaid = fakeMermaid({ render: vi.fn((id: string) => Promise.resolve({ svg: idSvg(id) })) });
    const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(mermaid), sanitise: realSanitise });
    const first = await renderer.render('graph TD; A-->B', { theme: THEME });
    const second = await renderer.render('graph TD; A-->B', { theme: THEME });
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(second.id).not.toBe(first.id);
    expect(second.querySelector('marker')?.id).toBe(`${second.id}_pointEnd`);
    expect(second.querySelector('path')?.getAttribute('marker-end')).toBe(`url(#${second.id}_pointEnd)`);
  });

  it('draws again for a new source or a new theme', async () => {
    const mermaid = fakeMermaid({ render: vi.fn((id: string) => Promise.resolve({ svg: idSvg(id) })) });
    const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(mermaid), sanitise: realSanitise });
    await renderer.render('graph TD; A-->B', { theme: THEME });
    await renderer.render('graph TD; A-->C', { theme: THEME });
    await renderer.render('graph TD; A-->B', { theme: { ...THEME, key: 'light' } });
    expect(mermaid.render).toHaveBeenCalledTimes(3);
  });

  it('does not remember a failure', async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ svg: idSvg('x') });
    const renderer = createMermaidRenderer({ loadMermaid: () => Promise.resolve(fakeMermaid({ render })), sanitise: realSanitise });
    await expect(renderer.render('graph TD; A-->B', { theme: THEME })).rejects.toThrow();
    await renderer.render('graph TD; A-->B', { theme: THEME });
    expect(render).toHaveBeenCalledTimes(2);
  });
});
