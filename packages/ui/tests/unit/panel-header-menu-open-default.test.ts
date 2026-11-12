/**
 * 067 T036 (FR-016, FR-017, FR-020, FR-021) — Open in OS Default Program on a panel's title menu.
 *
 * Navigate section, on an editor or a preview panel that shows a file on disk. It lives in the shared
 * preview title menu, so a provider the builder has never heard of gets it with no code of its own: the
 * builder is driven here with two provider kinds and no provider name. Absent with the setting off.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, type Panel } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import {
  panelHeaderMenu,
  type PanelHeaderMenuActions,
} from '../../src/renderer/workspace/panel-header-menu.js';

const LABEL = 'Open in OS Default Program';
const noop = (): void => {};

function actions(open: () => void = noop): PanelHeaderMenuActions {
  return {
    split: noop,
    zoomIn: noop,
    zoomOut: noop,
    resetZoom: noop,
    save: noop,
    saveAs: noop,
    revert: noop,
    reloadFromDisk: noop,
    reloadTerminal: noop,
    revealInTree: noop,
    openInOsExplorer: noop,
    openInDefaultProgram: open,
    tryAgain: noop,
    copyDetails: noop,
    clearPanelType: noop,
    redraw: noop,
    sendToNewTab: noop,
    sendToTab: noop,
    find: noop,
    goToHeading: noop,
    replace: noop,
    replaceAll: noop,
    destroy: noop,
    openPreview: noop,
    navigateBack: noop,
    navigateForward: noop,
    refreshPreview: noop,
    openInEditor: noop,
    goToEditor: noop,
    toggleSyncScroll: noop,
    flag: noop,
  };
}

const panel = (kind: Panel['kind']): Panel => ({
  type: 'panel',
  id: 'p1',
  originProjectId: 'proj',
  title: 'Panel',
  ...(kind === undefined ? {} : { kind }),
});

function menu(over: {
  kind: 'editor' | typeof PREVIEW_KIND | 'terminal';
  hasFilePath?: boolean;
  providerKind?: 'text' | 'binary';
  show?: boolean;
  open?: () => void;
}): MenuAction[] {
  return panelHeaderMenu({
    panel: panel(over.kind),
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: over.kind === 'editor' ? { dirty: false, hasFilePath: over.hasFilePath ?? true } : null,
    panelFailure: false,
    detach: null,
    preview:
      over.kind === PREVIEW_KIND ? { providerKind: over.providerKind ?? 'text', parented: false } : null,
    showOpenInDefaultProgram: over.show ?? true,
    actions: actions(over.open),
  });
}

const row = (items: MenuAction[]): MenuAction | undefined => items.find((i) => i.label === LABEL);

describe('Open in OS Default Program on the panel title menu (067 US2)', () => {
  it('is in Navigate on an editor showing a file on disk, and runs the action', () => {
    const open = vi.fn();
    const item = row(menu({ kind: 'editor', open }));
    expect(item?.section).toBe('navigate');
    item!.onClick?.();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('is absent on an editor with no file on disk', () => {
    expect(row(menu({ kind: 'editor', hasFilePath: false }))).toBeUndefined();
  });

  it.each(['text', 'binary'] as const)('is in Navigate on a %s preview with no provider-specific code', (providerKind) => {
    const item = row(menu({ kind: PREVIEW_KIND, providerKind }));
    expect(item?.section).toBe('navigate');
  });

  it('is absent on a terminal', () => {
    expect(row(menu({ kind: 'terminal' }))).toBeUndefined();
  });

  it.each([
    ['an editor', 'editor'],
    ['a preview', PREVIEW_KIND],
  ] as const)('is absent on %s with the setting off', (_what, kind) => {
    expect(row(menu({ kind, show: false }))).toBeUndefined();
  });
});
