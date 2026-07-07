import { describe, it, expect } from 'vitest';
import {
  addPanel,
  createDefaultLayout,
  effectiveActivePanelId,
  removePanel,
  setActivePanel,
} from '@throng/core';

const ids = { tab: 't1', panel: 'p1' };

describe('active panel (FR-002)', () => {
  it('createDefaultLayout sets the active panel to the initial panel', () => {
    const layout = createDefaultLayout('proj', ids);
    expect(layout.tabs[0].activePanelId).toBe('p1');
    expect(effectiveActivePanelId(layout.tabs[0])).toBe('p1');
  });

  it('setActivePanel activates an existing panel and ignores unknowns', () => {
    let layout = createDefaultLayout('proj', ids);
    layout = addPanel(layout, 't1', 'p2');
    layout = setActivePanel(layout, 't1', 'p2');
    expect(layout.tabs[0].activePanelId).toBe('p2');
    // unknown panel → unchanged
    expect(setActivePanel(layout, 't1', 'nope').tabs[0].activePanelId).toBe('p2');
    // unknown tab → unchanged
    expect(setActivePanel(layout, 'nope', 'p1')).toEqual(layout);
  });

  it('effectiveActivePanelId falls back to the first panel when the active id is stale', () => {
    let layout = createDefaultLayout('proj', ids);
    layout = addPanel(layout, 't1', 'p2');
    layout = setActivePanel(layout, 't1', 'p2');
    // remove the active panel — activePanelId becomes stale
    layout = removePanel(layout, 'p2');
    expect(effectiveActivePanelId(layout.tabs[0])).toBe('p1');
  });

  it('preserves activePanelId across panel-removal operations on other tabs', () => {
    let layout = createDefaultLayout('proj', ids);
    layout = addPanel(layout, 't1', 'p2');
    layout = setActivePanel(layout, 't1', 'p2');
    // removing a different panel leaves the active id intact
    layout = addPanel(layout, 't1', 'p3');
    layout = removePanel(layout, 'p3');
    expect(layout.tabs[0].activePanelId).toBe('p2');
  });
});
