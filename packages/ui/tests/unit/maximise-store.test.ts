/**
 * 054 FR-070 – FR-076 — the maximise stack, per tab: the transition table in `data-model.md`
 * ("Maximise stack"). What the stack does to the DOM — the panel kept mounted, the others hidden, the
 * modal gates — is `tests/component/maximise-panel.test.ts`; the section portal is
 * `tests/component/maximise-section.test.ts`.
 */
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMaximise,
  ensurePanelVisible,
  getMaximiseStack,
  isPanelHidden,
  maximisedPanelOf,
  maximisePanel,
  maximiseSection,
  panelClosed,
  panelTypeChanged,
  registerPanelTabResolver,
  restore,
  restoreAll,
  sectionUnmounted,
  subscribeMaximise,
  toggleMaximisePanel,
  useSectionMaximised,
  useTabMaximise,
} from '../../src/renderer/workspace/maximise-store.js';

const render = (): null => null;
const shape = (tabId: string): string[] =>
  getMaximiseStack(tabId).map((t) => (t.kind === 'panel' ? `panel:${t.panelId}` : `section:${t.panelId}/${t.sectionId}`));

afterEach(() => __resetMaximise());

describe('maximise store (054 FR-070 – FR-076)', () => {
  it('starts with every tab un-maximised', () => {
    expect(getMaximiseStack('t1')).toEqual([]);
    expect(maximisedPanelOf('t1')).toBeNull();
    expect(isPanelHidden('t1', 'p1')).toBe(false);
  });

  it('maximising a panel makes it the only target; every other panel of the tab is hidden', () => {
    maximisePanel('t1', 'p1');
    expect(shape('t1')).toEqual(['panel:p1']);
    expect(maximisedPanelOf('t1')).toBe('p1');
    expect(isPanelHidden('t1', 'p1')).toBe(false);
    expect(isPanelHidden('t1', 'p2')).toBe(true);
  });

  it('is per tab (FR-073): another tab is untouched', () => {
    maximisePanel('t1', 'p1');
    expect(getMaximiseStack('t2')).toEqual([]);
    expect(isPanelHidden('t2', 'p9')).toBe(false);
  });

  it('maximising a different panel restores whatever was maximised first (FR-074)', () => {
    maximisePanel('t1', 'p1');
    maximiseSection('t1', 'p1', 'd0', render);
    maximisePanel('t1', 'p2');
    expect(shape('t1')).toEqual(['panel:p2']);
  });

  it('a section of the maximised panel nests over it; a section of another panel replaces the stack', () => {
    maximisePanel('t1', 'p1');
    maximiseSection('t1', 'p1', 'd0', render);
    expect(shape('t1')).toEqual(['panel:p1', 'section:p1/d0']);
    maximiseSection('t1', 'p2', 'd1', render);
    expect(shape('t1')).toEqual(['section:p2/d1']);
  });

  it('a section on an empty stack is the only target, and its panel is the one left visible', () => {
    maximiseSection('t1', 'p1', 'd0', render);
    expect(shape('t1')).toEqual(['section:p1/d0']);
    expect(maximisedPanelOf('t1')).toBeNull();
    expect(isPanelHidden('t1', 'p1')).toBe(false);
    expect(isPanelHidden('t1', 'p2')).toBe(true);
  });

  it('re-maximising the section already on top replaces its render, not the stack', () => {
    const next = (): null => null;
    maximiseSection('t1', 'p1', 'd0', render);
    maximiseSection('t1', 'p1', 'd0', next);
    expect(shape('t1')).toEqual(['section:p1/d0']);
    const top = getMaximiseStack('t1')[0];
    expect(top?.kind === 'section' ? top.render : undefined).toBe(next);
  });

  it('restore steps back exactly one level (diagram → panel → layout)', () => {
    maximisePanel('t1', 'p1');
    maximiseSection('t1', 'p1', 'd0', render);
    restore('t1');
    expect(shape('t1')).toEqual(['panel:p1']);
    restore('t1');
    expect(shape('t1')).toEqual([]);
    restore('t1');
    expect(shape('t1')).toEqual([]);
  });

  it('restoreAll clears the whole stack', () => {
    maximisePanel('t1', 'p1');
    maximiseSection('t1', 'p1', 'd0', render);
    restoreAll('t1');
    expect(shape('t1')).toEqual([]);
  });

  it('toggle maximises an un-maximised panel and restores the maximised one with its sections', () => {
    toggleMaximisePanel('t1', 'p1');
    expect(shape('t1')).toEqual(['panel:p1']);
    maximiseSection('t1', 'p1', 'd0', render);
    toggleMaximisePanel('t1', 'p1');
    expect(shape('t1')).toEqual([]);
  });

  it('toggle on a different panel maximises that one instead', () => {
    toggleMaximisePanel('t1', 'p1');
    toggleMaximisePanel('t1', 'p2');
    expect(shape('t1')).toEqual(['panel:p2']);
  });

  it('closing the maximised panel drops every entry it owns (FR-075)', () => {
    maximisePanel('t1', 'p1');
    maximiseSection('t1', 'p1', 'd0', render);
    panelClosed('p1');
    expect(shape('t1')).toEqual([]);
  });

  it('closing a hidden panel leaves the target alone', () => {
    maximisePanel('t1', 'p1');
    panelClosed('p2');
    expect(shape('t1')).toEqual(['panel:p1']);
  });

  it('a type change keeps the panel maximised but drops its sections (FR-075)', () => {
    maximisePanel('t1', 'p1');
    maximiseSection('t1', 'p1', 'd0', render);
    panelTypeChanged('p1');
    expect(shape('t1')).toEqual(['panel:p1']);
  });

  it('a section that unmounts drops itself, and only itself', () => {
    maximisePanel('t1', 'p1');
    maximiseSection('t1', 'p1', 'd0', render);
    sectionUnmounted('t1', 'p1', 'd0');
    expect(shape('t1')).toEqual(['panel:p1']);
    sectionUnmounted('t1', 'p1', 'd0');
    expect(shape('t1')).toEqual(['panel:p1']);
  });

  it('an open landing in a hidden panel clears the stack first; one landing in the target does not', () => {
    registerPanelTabResolver((panelId) => (panelId.startsWith('p') ? 't1' : null));
    maximisePanel('t1', 'p1');
    expect(ensurePanelVisible('p1')).toBe(false);
    expect(shape('t1')).toEqual(['panel:p1']);
    expect(ensurePanelVisible('p2')).toBe(true);
    expect(shape('t1')).toEqual([]);
    expect(ensurePanelVisible('x1')).toBe(false);
  });

  it('notifies subscribers on every change and not on a no-op', () => {
    const listener = vi.fn();
    const off = subscribeMaximise(listener);
    restore('t1');
    expect(listener).not.toHaveBeenCalled();
    maximisePanel('t1', 'p1');
    maximisePanel('t1', 'p1');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    restore('t1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('useSectionMaximised says whether that one section is a target', () => {
    function Probe(): ReactElement {
      return createElement('span', null, String(useSectionMaximised('t1', 'p1', 'd0')));
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>false</span>');
    maximiseSection('t1', 'p1', 'd1', render);
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>false</span>');
    maximiseSection('t1', 'p1', 'd0', render);
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>true</span>');
  });

  it('useTabMaximise reads the tab stack through React', () => {
    function Probe(): ReactElement {
      const m = useTabMaximise('t1');
      return createElement('span', null, `${m.maximisedPanelId ?? '-'}:${m.isMaximised}:${m.isHidden('p2')}`);
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>-:false:false</span>');
    maximisePanel('t1', 'p1');
    expect(renderToStaticMarkup(createElement(Probe))).toBe('<span>p1:true:true</span>');
  });
});
