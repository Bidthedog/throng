import { describe, it, expect } from 'vitest';
import {
  createPanelTypeRegistry,
  defaultPanelTypeRegistry,
  type PanelTypeDescriptor,
} from '@throng/core';

function fake(id: string, label = id): PanelTypeDescriptor {
  return {
    id,
    label,
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
