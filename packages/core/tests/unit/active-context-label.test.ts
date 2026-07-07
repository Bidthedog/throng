import { describe, it, expect } from 'vitest';
import {
  activeContextLabel,
  addPanel,
  createDefaultLayout,
  renameTab,
  setActivePanel,
} from '@throng/core';

const ids = { tab: 't1', panel: 'p1' };

// The active "Tab · Panel" label shared by the status bar and the window title
// (FR-004 / FR-040), so the two can never drift.
describe('activeContextLabel', () => {
  it('returns "<tab> · <panel>" for the active tab\'s active panel', () => {
    expect(activeContextLabel(createDefaultLayout('proj', ids))).toBe('Tab 1 · Panel 1');
  });

  it('follows the active-panel selection within the active tab', () => {
    let layout = createDefaultLayout('proj', ids);
    layout = addPanel(layout, 't1', 'p2'); // "Panel 2"
    layout = setActivePanel(layout, 't1', 'p2');
    expect(activeContextLabel(layout)).toBe('Tab 1 · Panel 2');
  });

  it('reflects a renamed tab', () => {
    let layout = createDefaultLayout('proj', ids);
    layout = renameTab(layout, 't1', 'Server');
    expect(activeContextLabel(layout)).toBe('Server · Panel 1');
  });

  it('returns an empty string when there is no active tab', () => {
    const layout = { ...createDefaultLayout('proj', ids), activeTabId: 'gone' };
    expect(activeContextLabel(layout)).toBe('');
  });
});
