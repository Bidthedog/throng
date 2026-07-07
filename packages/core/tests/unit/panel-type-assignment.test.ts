import { describe, it, expect } from 'vitest';
import {
  createDefaultLayout,
  addPanel,
  setPanelType,
  clearPanelType,
  collectPanels,
  isMainLayoutValid,
  type PanelConfig,
  type WorkspaceLayout,
} from '@throng/core';

function base(): WorkspaceLayout {
  return createDefaultLayout('proj', { tab: 't1', panel: 'p1' });
}

function panel(layout: WorkspaceLayout, id: string) {
  return layout.tabs.flatMap((t) => collectPanels(t.root)).find((p) => p.id === id);
}

const CONFIG: PanelConfig = { flavourId: 'pwsh', params: '-NoLogo' };

describe('setPanelType (assign from untyped — FR-006)', () => {
  it('assigns kind + config to an untyped panel', () => {
    const l = setPanelType(base(), 'p1', 'terminal', CONFIG);
    const p = panel(l, 'p1')!;
    expect(p.kind).toBe('terminal');
    expect(p.config).toEqual(CONFIG);
    expect(isMainLayoutValid(l)).toBe(true);
  });

  it('does not mutate the input layout (immutable)', () => {
    const original = base();
    setPanelType(original, 'p1', 'terminal', CONFIG);
    expect(panel(original, 'p1')!.kind).toBeUndefined();
  });

  it('is a no-op while the panel is already typed (type cannot change while live)', () => {
    const typed = setPanelType(base(), 'p1', 'terminal', CONFIG);
    const again = setPanelType(typed, 'p1', 'terminal', { flavourId: 'bash', params: '-i' });
    const p = panel(again, 'p1')!;
    expect(p.kind).toBe('terminal');
    expect(p.config).toEqual(CONFIG); // unchanged
  });

  it('ignores an unknown panel id', () => {
    const l = setPanelType(base(), 'nope', 'terminal', CONFIG);
    expect(panel(l, 'p1')!.kind).toBeUndefined();
  });

  it('assigns the correct panel only, leaving siblings untyped', () => {
    const two = addPanel(base(), 't1', 'p2');
    const l = setPanelType(two, 'p2', 'terminal', CONFIG);
    expect(panel(l, 'p2')!.kind).toBe('terminal');
    expect(panel(l, 'p1')!.kind).toBeUndefined();
  });
});

describe('clearPanelType (revert to untyped — FR-020)', () => {
  it('clears kind + config back to undefined', () => {
    const typed = setPanelType(base(), 'p1', 'terminal', CONFIG);
    const reverted = clearPanelType(typed, 'p1');
    const p = panel(reverted, 'p1')!;
    expect(p.kind).toBeUndefined();
    expect(p.config).toBeUndefined();
    expect(isMainLayoutValid(reverted)).toBe(true);
  });

  it('allows a subsequent re-type after revert', () => {
    const typed = setPanelType(base(), 'p1', 'terminal', CONFIG);
    const reverted = clearPanelType(typed, 'p1');
    const retyped = setPanelType(reverted, 'p1', 'terminal', { flavourId: 'bash', params: '-i' });
    expect(panel(retyped, 'p1')!.kind).toBe('terminal');
    expect(panel(retyped, 'p1')!.config).toEqual({ flavourId: 'bash', params: '-i' });
  });

  it('ignores an unknown panel id', () => {
    const typed = setPanelType(base(), 'p1', 'terminal', CONFIG);
    const l = clearPanelType(typed, 'nope');
    expect(panel(l, 'p1')!.kind).toBe('terminal');
  });
});

describe('Panel kind/config round-trip through a layout blob (FR-007)', () => {
  it('survives JSON serialise/deserialise', () => {
    const typed = setPanelType(base(), 'p1', 'terminal', CONFIG);
    const restored = JSON.parse(JSON.stringify(typed)) as WorkspaceLayout;
    const p = panel(restored, 'p1')!;
    expect(p.kind).toBe('terminal');
    expect(p.config).toEqual(CONFIG);
  });

  it('an untyped layout round-trips unchanged (back-compat)', () => {
    const untyped = base();
    const restored = JSON.parse(JSON.stringify(untyped)) as WorkspaceLayout;
    expect(panel(restored, 'p1')!.kind).toBeUndefined();
    expect(panel(restored, 'p1')!.config).toBeUndefined();
  });
});
