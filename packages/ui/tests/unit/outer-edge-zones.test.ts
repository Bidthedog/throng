/**
 * 048 FR-060/064/065/066 — the pure half of the outer-edge drop bands: their ids, which collision wins
 * where bands overlap, and the stylesheet (distinct preview, corners to left/right, nothing measured).
 * jsdom has no layout, so a real drop onto a band is the E2E's (`outer-edge-drop.e2e.ts`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { outerEdgeDropId, parseOuterEdgeDropId, preferOuterEdge } from '../../src/renderer/workspace/drag-state.js';

const css = readFileSync(resolve(__dirname, '../../src/renderer/theme.css'), 'utf8');
const zoneSource = readFileSync(resolve(__dirname, '../../src/renderer/workspace/outer-edge-zones.tsx'), 'utf8');

describe('outer-edge droppable ids', () => {
  it('round-trips, and is not confused with a panel edge zone or a tab drop', () => {
    const id = outerEdgeDropId('t-1', 'left');
    expect(parseOuterEdgeDropId(id)).toEqual({ tabId: 't-1', edge: 'left' });
    expect(parseOuterEdgeDropId('edge|p1|left')).toBeNull();
    expect(parseOuterEdgeDropId('tab|t-1')).toBeNull();
  });
});

describe('preferOuterEdge (FR-060, FR-064)', () => {
  const panelEdge = { id: 'edge|p1|left' };
  const tabDrop = { id: 'tab|t1' };

  it('leaves collisions alone when no band is involved', () => {
    const c = [panelEdge, tabDrop];
    expect(preferOuterEdge(c)).toBe(c);
  });

  it('a band beats the panel edge zone underneath it', () => {
    expect(preferOuterEdge([panelEdge, { id: outerEdgeDropId('t1', 'top') }])).toEqual([
      { id: outerEdgeDropId('t1', 'top') },
    ]);
  });

  it('left and right win over top and bottom at a corner', () => {
    const top = { id: outerEdgeDropId('t1', 'top') };
    const right = { id: outerEdgeDropId('t1', 'right') };
    expect(preferOuterEdge([top, right, panelEdge])).toEqual([right]);
    expect(preferOuterEdge([right, top])).toEqual([right]);
    const bottom = { id: outerEdgeDropId('t1', 'bottom') };
    const left = { id: outerEdgeDropId('t1', 'left') };
    expect(preferOuterEdge([bottom, left])).toEqual([left]);
  });
});

describe('outer-edge stylesheet', () => {
  it('the top and bottom bands are inset so the corners belong to left and right', () => {
    expect(css).toMatch(/\.outer-edge-zone--left \{[^}]*top: 0; bottom: 0;/);
    expect(css).toMatch(/\.outer-edge-zone--right \{[^}]*top: 0; bottom: 0;/);
    expect(css).toMatch(/\.outer-edge-zone--top \{[^}]*left: var\(--outer-edge-band\);[^}]*right: var\(--outer-edge-band\)/);
    expect(css).toMatch(/\.outer-edge-zone--bottom \{[^}]*left: var\(--outer-edge-band\);[^}]*right: var\(--outer-edge-band\)/);
  });

  it('the preview is dashed and so distinct from .edge-zone--over, and the host is positioned', () => {
    expect(css).toMatch(/\.outer-edge-preview \{[^}]*border: 2px dashed/);
    expect(css).toMatch(/\.edge-zone--over \{[^}]*outline: 2px solid/);
    expect(css).toMatch(/\.tab-body \{\s*position: relative;/);
  });

  it('nothing is measured while the pointer moves (FR-066)', () => {
    expect(zoneSource).not.toMatch(/getBoundingClientRect/);
    expect(zoneSource).not.toMatch(/pointermove/);
  });
});
