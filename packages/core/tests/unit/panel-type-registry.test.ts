import { describe, it, expect } from 'vitest';
import {
  createPanelTypeRegistry,
  defaultPanelTypeRegistry,
  type PanelTypeDescriptor,
} from '@throng/core';

function fake(id: string, label = id, offered?: boolean): PanelTypeDescriptor {
  return {
    id,
    label,
    ...(offered === undefined ? {} : { offered }),
    inputs: [],
    defaults: () => ({}),
    validate: () => ({ ok: true }),
    buildConfig: () => ({}),
  };
}

describe('panel-type registry', () => {
  it('register then list returns the descriptor', () => {
    const r = createPanelTypeRegistry();
    r.register(fake('terminal', 'Terminal'));
    expect(r.list().map((d) => d.id)).toEqual(['terminal']);
  });

  it('list preserves registration order, stable across calls', () => {
    const r = createPanelTypeRegistry();
    r.register(fake('a'));
    r.register(fake('b'));
    r.register(fake('c'));
    expect(r.list().map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(r.list().map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('get resolves by id and returns undefined for unknown', () => {
    const r = createPanelTypeRegistry();
    const d = fake('terminal');
    r.register(d);
    expect(r.get('terminal')).toBe(d);
    expect(r.get('nope')).toBeUndefined();
  });

  it('a duplicate id replaces in place, keeping its order position', () => {
    const r = createPanelTypeRegistry();
    r.register(fake('a'));
    r.register(fake('b'));
    const replacement = fake('a', 'A2');
    r.register(replacement);
    expect(r.list().map((d) => d.id)).toEqual(['a', 'b']); // order unchanged
    expect(r.get('a')).toBe(replacement); // last wins
    expect(r.get('a')!.label).toBe('A2');
  });

  it('separate registries do not share state', () => {
    const r1 = createPanelTypeRegistry();
    const r2 = createPanelTypeRegistry();
    r1.register(fake('a'));
    expect(r2.list()).toEqual([]);
  });

  it('the shared default registry has the Terminal type registered', () => {
    expect(defaultPanelTypeRegistry.get('terminal')?.label).toBe('Terminal');
    expect(defaultPanelTypeRegistry.list().map((d) => d.id)).toContain('terminal');
  });
});

/**
 * 043 FR-017 / R17 — a type may be REGISTERED without being OFFERED.
 *
 * The registry is not only the New Panel dropdown's source: it is also what supplies a panel's
 * header label and icon (`panel-placeholder.tsx`, `use-panel-display-names.ts` both call `get()`).
 * So "just don't register it" is not an option — it would trade FR-017 for a panel header showing a
 * raw kind string and no icon. The seam is one flag and one filtered listing, and the split matters:
 * `list()` stays EVERY registered type, so anything resolving metadata keeps working.
 */
describe('offered — registered, but not offered (043 FR-017)', () => {
  it('an unoffered type is resolvable by get() and present in list(), but absent from listOfferable()', () => {
    const r = createPanelTypeRegistry();
    r.register(fake('terminal', 'Terminal'));
    const hidden = fake('findInFiles', 'Find in Files', false);
    r.register(hidden);

    expect(r.get('findInFiles')).toBe(hidden); // the header still finds its label and icon
    expect(r.list().map((d) => d.id)).toEqual(['terminal', 'findInFiles']);
    expect(r.listOfferable().map((d) => d.id)).toEqual(['terminal']);
  });

  it('omitting the flag means offered — the two existing descriptors need no change', () => {
    const r = createPanelTypeRegistry();
    r.register(fake('terminal'));
    r.register(fake('editor'));
    expect(r.listOfferable().map((d) => d.id)).toEqual(['terminal', 'editor']);
  });

  it('offered: true is explicit and behaves identically to omitting it', () => {
    const r = createPanelTypeRegistry();
    r.register(fake('a', 'A', true));
    expect(r.listOfferable().map((d) => d.id)).toEqual(['a']);
  });

  it('listOfferable keeps registration order, like list()', () => {
    const r = createPanelTypeRegistry();
    r.register(fake('a'));
    r.register(fake('b', 'B', false));
    r.register(fake('c'));
    expect(r.listOfferable().map((d) => d.id)).toEqual(['a', 'c']);
  });
});
