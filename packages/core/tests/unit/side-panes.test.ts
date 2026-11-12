import { describe, expect, it } from 'vitest';
import { createDefaultLayout, effectiveSidePanes, isMainLayoutValid, type WorkspaceLayout } from '@throng/core';

const base = (): WorkspaceLayout => createDefaultLayout('p1', { tab: 't1', panel: 'pn1' } as never);

describe('side panes in the project layout (067 FR-056, FR-057, FR-060)', () => {
  it('reads an absent value as both expanded', () => {
    expect(effectiveSidePanes(base())).toEqual({ projects: true, files: true });
  });
  it('reads a stored value', () => {
    expect(effectiveSidePanes({ ...base(), sidePanes: { projects: false, files: true } })).toEqual({
      projects: false,
      files: true,
    });
  });
  it('round-trips through a stored layout, which validation accepts', () => {
    const layout: WorkspaceLayout = { ...base(), sidePanes: { projects: true, files: false } };
    const stored = JSON.parse(JSON.stringify(layout)) as WorkspaceLayout;
    expect(isMainLayoutValid(stored)).toBe(true);
    expect(effectiveSidePanes(stored)).toEqual({ projects: true, files: false });
  });
  it('reads a malformed value as expanded rather than losing the layout', () => {
    const layout = { ...base(), sidePanes: { projects: 'no' } } as unknown as WorkspaceLayout;
    expect(isMainLayoutValid(layout)).toBe(true);
    expect(effectiveSidePanes(layout)).toEqual({ projects: true, files: true });
  });
});
