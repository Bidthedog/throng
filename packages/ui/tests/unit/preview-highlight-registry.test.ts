/**
 * 049 R2 — the per-panel preview highlight registry. `CSS.highlights` is ONE registry per document, so two
 * previews painting the same name would overwrite each other; the registry keeps each panel's ranges and
 * registers the union under each name.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearPanel, setPanelRanges } from '../../src/renderer/preview/highlight-registry.js';

class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

const range = (tag: string): Range => ({ tag }) as unknown as Range;
const held = (map: Map<string, unknown>, name: string): string[] =>
  ((map.get(name) as FakeHighlight | undefined)?.ranges ?? []).map((r) => (r as unknown as { tag: string }).tag);

describe('highlight registry (049 R2)', () => {
  let map: Map<string, unknown>;

  beforeEach(() => {
    map = new Map();
    (globalThis as Record<string, unknown>).CSS = { highlights: map };
    (globalThis as Record<string, unknown>).Highlight = FakeHighlight;
    clearPanel('a');
    clearPanel('b');
  });
  afterEach(() => {
    clearPanel('a');
    clearPanel('b');
    delete (globalThis as Record<string, unknown>).CSS;
    delete (globalThis as Record<string, unknown>).Highlight;
  });

  it('holds the union of two panels under one name', () => {
    setPanelRanges('n', 'a', [range('a1')]);
    setPanelRanges('n', 'b', [range('b1'), range('b2')]);
    expect(map.size).toBe(1);
    expect(held(map, 'n').sort()).toEqual(['a1', 'b1', 'b2']);
  });

  it("replaces only the calling panel's ranges", () => {
    setPanelRanges('n', 'a', [range('a1')]);
    setPanelRanges('n', 'b', [range('b1')]);
    setPanelRanges('n', 'a', [range('a2')]);
    expect(held(map, 'n').sort()).toEqual(['a2', 'b1']);
  });

  it('clearPanel removes that panel under every name and keeps the other', () => {
    setPanelRanges('n', 'a', [range('a1')]);
    setPanelRanges('m', 'a', [range('a2')]);
    setPanelRanges('n', 'b', [range('b1')]);
    clearPanel('a');
    expect(held(map, 'n')).toEqual(['b1']);
    expect(map.has('m')).toBe(false);
  });

  it('deletes a name with no ranges left', () => {
    setPanelRanges('n', 'a', [range('a1')]);
    setPanelRanges('n', 'a', []);
    expect(map.has('n')).toBe(false);
  });

  it('is a no-op without CSS.highlights', () => {
    delete (globalThis as Record<string, unknown>).CSS;
    expect(() => setPanelRanges('n', 'a', [range('a1')])).not.toThrow();
    expect(() => clearPanel('a')).not.toThrow();
  });
});
