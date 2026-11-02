import { describe, expect, it } from 'vitest';
import { cacheModel, offsetOfPoint } from '../../src/renderer/preview/preview-selection-model.js';

/**
 * A preview's selection is mapped to text-model offsets through a CACHED model, and an element boundary
 * (a select-all) is resolved by comparing the point against each cached text node. When the rendered text
 * nodes have been replaced since the cache was built — a table-layout pass wrapping tokens in spans, a
 * `normalize()` — those cached nodes are no longer in the document, and `Range.comparePoint` on a node in
 * another tree throws WrongDocumentError. That throw escaped from the selection frame as an uncaught error
 * (seen in the gate's component stage, from preview-copy.test.ts's nowrap-span test).
 *
 * Layer: component — the claim needs a real DOM Range.
 */
describe('resolving a selection point against a stale cached model', () => {
  it('answers instead of throwing when the cached text nodes have left the document', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>alpha</p><p>beta</p>';
    document.body.appendChild(host);
    const cache = cacheModel(host);

    // Re-render: every cached text node is now detached.
    host.innerHTML = '<p>alpha</p><p>beta</p>';

    expect(() => offsetOfPoint(cache, host, 0)).not.toThrow();
    host.remove();
  });
});
