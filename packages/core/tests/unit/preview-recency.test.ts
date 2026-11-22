/**
 * 054 T007 — `initialPreviewRecency(tab, isPreview)`: which preview a restored tab's Last Active reuses
 * first (FR-001, FR-002).
 */
import { describe, expect, it } from 'vitest';
import { initialPreviewRecency, type LayoutNode, type Tab } from '../../src/index.js';

const leaf = (panelId: string): LayoutNode => ({ type: 'panel', id: panelId, originProjectId: 'A', title: panelId }) as unknown as LayoutNode;
const split = (...children: LayoutNode[]): LayoutNode =>
  ({ type: 'split', orientation: 'row', children, sizes: children.map(() => 1) }) as unknown as LayoutNode;
const previews = new Set(['v1', 'v2', 'v3']);
const isPreview = (id: string) => previews.has(id);

const tab = (extra: Partial<Tab>): Tab => ({
  id: 't1',
  title: 'T',
  root: split(leaf('e1'), leaf('v1'), split(leaf('v2'), leaf('v3'))),
  ...extra,
});

describe('initialPreviewRecency', () => {
  // Every restored preview stays a candidate (FR-001): Last Active is per type (FR-007), so one left out could
  // never be reused for a file of its type (maintainer, 2026-11-22).
  it('leads with the persisted order, dropping ids no longer in the tab or no longer previews, then the rest', () => {
    expect(initialPreviewRecency(tab({ previewRecency: ['v3', 'gone', 'e1', 'v1'] }), isPreview)).toEqual(['v3', 'v1', 'v2']);
  });

  it('without one, leads with the focused preview, then the rest in layout order', () => {
    expect(initialPreviewRecency(tab({ activePanelId: 'v2' }), isPreview)).toEqual(['v2', 'v1', 'v3']);
  });

  it('without one and with a non-preview focused, lists the tab’s previews in layout order', () => {
    expect(initialPreviewRecency(tab({ activePanelId: 'e1' }), isPreview)).toEqual(['v1', 'v2', 'v3']);
    expect(initialPreviewRecency(tab({}), isPreview)).toEqual(['v1', 'v2', 'v3']);
  });

  it('an empty persisted list is treated as absent', () => {
    expect(initialPreviewRecency(tab({ previewRecency: [], activePanelId: 'v3' }), isPreview)).toEqual(['v3', 'v1', 'v2']);
  });
});
