/**
 * Flag in every panel's header menu (057 FR-125; constitution VI, "every panel action has a menu item").
 *
 * Layer: component — the builder `panelHeaderMenu` is pure, so one row per panel kind is a DOM-free call.
 * That the click reaches `attention.flag` with the panel's project, tab and title is the call site's wiring
 * in `panel-placeholder.tsx`; the builder's contract is that it calls `actions.flag` exactly once. Since the v1
 * review both rows show `panel.toggleFlag`'s chord, which runs the same flag or unflag.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, PREVIEW_KIND, type Panel } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuActions } from '../../src/renderer/workspace/panel-header-menu.js';

const noop = (): void => {};

const panel = (over: Partial<Panel>): Panel => ({ type: 'panel', id: 'p1', originProjectId: 'proj', title: 'Panel', ...over });

function menu(p: Panel, flag: () => void = noop, over: { panelFailure?: boolean; flagged?: boolean; unflag?: () => void } = {}): MenuAction[] {
  return panelHeaderMenu({
    panel: p,
    flagged: over.flagged ?? false,
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: p.kind === 'editor' ? { dirty: false, hasFilePath: true } : null,
    panelFailure: over.panelFailure ?? false,
    detach: null,
    preview: p.kind === PREVIEW_KIND ? { providerKind: 'text', parented: false } : null,
    actions: new Proxy({} as PanelHeaderMenuActions, {
      get: (_t, key) => (key === 'flag' ? flag : key === 'unflag' ? (over.unflag ?? noop) : noop),
    }),
  });
}

/*
 * A blank panel — one with no type chosen yet, showing only the type-selection form — has nothing to
 * draw a user's attention to, so it offers no Flag: absent rather than greyed (constitution VI), as the
 * untyped placeholder's missing Zoom commands are.
 */
it('a blank (untyped) panel offers no Flag', () => {
  expect(menu(panel({})).map((i) => i.label)).not.toContain('Flag');
});

describe.each([
  ['a terminal', panel({ kind: 'terminal' })],
  ['an editor', panel({ kind: 'editor' })],
  ['a preview', panel({ kind: PREVIEW_KIND, config: { filePath: 'D:/proj/README.md' } })],
])('%s', (_name, p) => {
  it('offers Flag in View & state, with the flag icon (057 FR-139 as amended, #732) and panel.toggleFlag\'s chord', () => {
    const flag = menu(p).filter((i) => i.label === 'Flag');
    expect(flag).toHaveLength(1);
    expect(flag[0]).toMatchObject({ section: 'viewState' });
    expect(flag[0]!.icon).toBe('flag');
    expect(flag[0]!.shortcut).toBe('Ctrl+Alt+G');
    expect(flag[0]!.disabled).not.toBe(true);
  });

  it('offers Unflag instead, with the crossed-out flag, once the panel is marked, and it clears the mark (v1 review)', () => {
    const unflag = vi.fn();
    const flag = vi.fn();
    const items = menu(p, flag, { flagged: true, unflag });
    expect(items.map((i) => i.label)).not.toContain('Flag');
    const row = items.find((i) => i.label === 'Unflag');
    expect(row).toMatchObject({ section: 'viewState', icon: 'unflag', shortcut: 'Ctrl+Alt+G' });
    row!.onClick();
    expect(unflag).toHaveBeenCalledTimes(1);
    expect(flag).not.toHaveBeenCalled();
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
