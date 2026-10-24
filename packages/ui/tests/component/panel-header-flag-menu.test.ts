/**
 * Flag in every panel's header menu (057 FR-125; constitution VI, "every panel action has a menu item").
 *
 * Layer: component — the builder `panelHeaderMenu` is pure, so one row per panel kind is a DOM-free call.
 * That the click reaches `attention.flag` with the panel's project, tab and title is the call site's wiring
 * in `panel-placeholder.tsx`; the builder's contract is that it calls `actions.flag` exactly once. Flag is a
 * plain item with no command and no chord (the failure banner's *Try again* is the precedent).
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, type Panel } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';

const noop = (): void => {};
const actionsWith = (flag: () => void): PanelHeaderMenuActions =>
  new Proxy({} as PanelHeaderMenuActions, { get: (_t, key) => (key === 'flag' ? flag : noop) });

const panel = (over: Partial<Panel>): Panel => ({ type: 'panel', id: 'p1', originProjectId: 'proj', title: 'Panel', ...over });

function menu(p: Panel, flag: () => void = noop, over: { panelFailure?: boolean } = {}): MenuAction[] {
  return panelHeaderMenu({
    panel: p,
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: p.kind === 'editor' ? { dirty: false, hasFilePath: true } : null,
    panelFailure: over.panelFailure ?? false,
    detach: null,
    preview: p.kind === PREVIEW_KIND ? { providerKind: 'text', parented: false } : null,
    actions: actionsWith(flag),
  });
}

describe.each([
  ['an untyped panel', panel({})],
  ['a terminal', panel({ kind: 'terminal' })],
  ['an editor', panel({ kind: 'editor' })],
  ['a preview', panel({ kind: PREVIEW_KIND, config: { filePath: 'D:/proj/README.md' } })],
])('%s', (_name, p) => {
  it('offers Flag in View & state, with the attention icon and no chord', () => {
    const flag = menu(p).filter((i) => i.label === 'Flag');
    expect(flag).toHaveLength(1);
    expect(flag[0]).toMatchObject({ section: 'viewState', icon: 'attention' });
    expect(flag[0]!.shortcut).toBeUndefined();
    expect(flag[0]!.disabled).not.toBe(true);
  });

  it('calls flag once when chosen', () => {
    const flag = vi.fn();
    menu(p, flag).find((i) => i.label === 'Flag')!.onClick();
    expect(flag).toHaveBeenCalledTimes(1);
  });
});

it('is still offered while the failure banner is up', () => {
  expect(menu(panel({ kind: 'editor' }), noop, { panelFailure: true }).some((i) => i.label === 'Flag')).toBe(true);
});
