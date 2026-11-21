/**
 * 074 FR-068a / FR-086c (review finding, 2026-11-20) — a page's text is laid out by the paint and by Find's background
 * build; two layers streaming into one container must never interleave their spans.
 *
 * Layer: component — needs a DOM container; PDF.js's TextLayer is faked as a stream the test drives by hand.
 */
import { describe, expect, it } from 'vitest';
import { exclusiveTextLayer, type CancellableLayer } from '../../src/renderer/preview/providers/pdf/text-layer-guard.js';

/** A layer that appends one span per `push`, until cancelled, and finishes on `end`. */
function streamingLayer(container: HTMLElement, word: string) {
  let cancelled = false;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const layer: CancellableLayer = {
    render: () => done,
    cancel: () => {
      cancelled = true;
      finish();
    },
  };
  return {
    layer,
    push: () => {
      if (cancelled) return;
      const span = document.createElement('span');
      span.textContent = word;
      container.appendChild(span);
    },
    end: () => finish(),
  };
}

describe('one text layer per page at a time', () => {
  it('a second layer stops the first one still streaming, so their spans never interleave', async () => {
    const container = document.createElement('div');
    const first = streamingLayer(container, 'first');
    const second = streamingLayer(container, 'second');

    const a = exclusiveTextLayer(container, () => first.layer);
    first.push();
    const b = exclusiveTextLayer(container, () => second.layer);
    first.push(); // the first stream would still be arriving
    second.push();
    second.end();
    await Promise.all([a, b]);

    expect([...container.children].map((c) => c.textContent)).toEqual(['second']);
  });

  it('a layer that finished leaves its spans, and a later one replaces them', async () => {
    const container = document.createElement('div');
    const first = streamingLayer(container, 'first');
    const pending = exclusiveTextLayer(container, () => first.layer);
    first.push();
    first.end();
    await pending;
    expect(container.textContent).toBe('first');

    const second = streamingLayer(container, 'second');
    const again = exclusiveTextLayer(container, () => second.layer);
    second.push();
    second.end();
    await again;
    expect(container.textContent).toBe('second');
  });
});
