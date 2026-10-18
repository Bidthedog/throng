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
    expect(activeContextLabel(createDefaultLayout('proj', ids))).toBe('Tab 1 · Blank Panel');
  });

  it('follows the active-panel selection within the active tab', () => {
    let layout = createDefaultLayout('proj', ids);
    layout = addPanel(layout, 't1', 'p2'); // "Blank Panel 2"
    layout = setActivePanel(layout, 't1', 'p2');
    expect(activeContextLabel(layout, (p) => p.id)).toBe('Tab 1 · p2');
  });

  it('reflects a renamed tab', () => {
    let layout = createDefaultLayout('proj', ids);
    layout = renameTab(layout, 't1', 'Server');
    expect(activeContextLabel(layout)).toBe('Server · Blank Panel');
  });

  it('names the panel as its header does, never by the stored "Blank Panel 2" (#504)', () => {
    let layout = createDefaultLayout('proj', ids);
    layout = addPanel(layout, 't1', 'p2'); // stored as "Blank Panel 2"
    layout = setActivePanel(layout, 't1', 'p2');
    // An untyped panel's header reads the bare placeholder; the number only keeps stored names unique.
    expect(activeContextLabel(layout)).toBe('Tab 1 · Blank Panel');
  });

  it('uses the namer it is given, so a caller with live sources names the panel as its header does', () => {
    const layout = createDefaultLayout('proj', ids);
    expect(activeContextLabel(layout, (p) => `live:${p.id}`)).toBe('Tab 1 · live:p1');
  });

  it('returns an empty string when there is no active tab', () => {
    const layout = { ...createDefaultLayout('proj', ids), activeTabId: 'gone' };
    expect(activeContextLabel(layout)).toBe('');
  });
});
