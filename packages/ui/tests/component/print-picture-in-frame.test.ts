/**
 * The maintainer, 2026-11-20 18:10: "SVG Print preview does not show anything." A picture — an SVG file, a ```svg
 * fence, an image — is drawn in a diagram frame, whose layer shows a CLONE of the wrapper its renderer built. The
 * wrapper's bytes are registered on the wrapper itself (`registerRasterSource`), so the printable, reading the layer,
 * found no bytes for the clone and printed the picture as its alternative text: for an unlabelled SVG, nothing.
 *
 * Layer: component — the real DiagramFrame mounted, the printable built from what it draws (jsdom).
 */
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiagramFrame } from '../../src/renderer/preview/diagram/diagram-frame.js';
import { DIAGRAM_HOST_CLASS } from '../../src/renderer/preview/diagram/diagram-host.js';
import { registerRasterSource } from '../../src/renderer/preview/diagram/rasterise.js';
import { pictureWrapper } from '../../src/renderer/preview/blocks/picture.js';
import { buildPrintable } from '../../src/renderer/preview/print/printable.js';
import { registerPanelTabResolver } from '../../src/renderer/workspace/maximise-store.js';

const SOURCE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" fill="red"/></svg>';

let unresolve: (() => void) | null = null;
beforeEach(() => {
  unresolve = registerPanelTabResolver(() => 't1');
});
afterEach(() => {
  unresolve?.();
  document.body.replaceChildren();
});

describe('a picture in a diagram frame prints as itself (075 FR-066)', () => {
  it('prints the SVG from its own bytes, not as its (empty) alternative text', async () => {
    const wrapper = pictureWrapper('blob:file:///svg-1', 20, 10);
    registerRasterSource(wrapper, () => Promise.resolve(new Blob([SOURCE], { type: 'image/svg+xml' })));
    const { container } = render(
      createElement('div', { className: DIAGRAM_HOST_CLASS }, createElement(DiagramFrame, { svg: wrapper, panelId: 'p1', sectionId: 'diagram-0', maximisable: false, fillsPanel: true })),
    );
    // The frame shows a clone, as on screen.
    const shown = container.querySelector<SVGSVGElement>('.preview-diagram-frame__layer > svg');
    expect(shown).not.toBeNull();
    expect(shown).not.toBe(wrapper);

    const output = await buildPrintable(container as HTMLElement, { title: 'x.svg', fit: 'page', stylesheets: '', baseHref: 'file:///app/' });
    if (output.kind !== 'document') throw new Error('not a document');
    expect(output.html).not.toContain('blob:');
    expect(output.html).toMatch(/<image [^>]*href="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/);
  });

  it('prints an image drawn from a throng-preview: URL as that URL, which the print host serves', async () => {
    const wrapper = pictureWrapper('throng-preview://source/p1', 20, 10);
    const { container } = render(
      createElement('div', { className: DIAGRAM_HOST_CLASS }, createElement(DiagramFrame, { svg: wrapper, panelId: 'p1', sectionId: 'diagram-0', maximisable: false, fillsPanel: true })),
    );
    const output = await buildPrintable(container as HTMLElement, { title: 'x.png', fit: 'page', stylesheets: '', baseHref: 'file:///app/' });
    if (output.kind !== 'document') throw new Error('not a document');
    expect(output.html).toContain('href="throng-preview://source/p1"');
  });
});
