/**
 * "Refresh / redraw terminal" is on the terminal's TITLE menu, showing the chord it is bound to right now
 * (028 / #163, FR-041/FR-049c). The v1 review (#732) took it off the body menu (FR-040, amended): a redraw acts on
 * the panel, not on the text under the pointer. The tests below were written for both menus; the body half now
 * asserts the row is absent there.
 *
 * PLACE AT: `packages/ui/tests/unit/redraw-menu-parity.test.ts`
 * SPLIT OUT OF `packages/ui/tests/e2e/terminal-redraw-action.e2e.ts` (034 FR-045). That test is not
 * deleted and does not shrink to a stub: what it keeps is the half a real ConPTY is required for —
 * that a redraw loses no scrollback, types NOTHING at the shell, survives three chord presses in a
 * row and leaves the shell alive. This file takes only the half that is menu-builder data, which the
 * E2E was paying an Electron launch and a real `cmd` to read as two labels and one bracketed string.
 *
 * ══ WHY IT IS NOT ALREADY COVERED, HAVING LOOKED ══
 *
 * `packages/ui/tests/unit/menu-sections.test.ts:531` pins the label on the terminal CONTENT menu, as
 * part of a full label list. Nothing anywhere pinned it on the panel HEADER menu: that table's
 * `Panel header — terminal panel` row runs `assertSectioned`, which validates sections, divider
 * positions and intra-section order and compares no label at all — and the two exhaustive `shapeOf`
 * pins in that file are for an UNTYPED panel and an EDITOR panel, neither of which draws this row.
 * And nothing at any layer asserted the SHORTCUT either menu shows, which is the constitution
 * v4.3.0 requirement the E2E's comment calls out by name ("the chord is SHOWN, not merely bound").
 *
 * ══ WHAT IT SAYS THAT THE E2E COULD NOT ══
 *
 *   - The two labels are compared with EACH OTHER, not each written out. FR-040/041's requirement is
 *     that a user hunting for the action finds the same words in whichever menu is nearest; two
 *     hand-written string literals agree by construction and would go on agreeing after one of them
 *     was reworded.
 *   - A REBIND moves what both menus show. The E2E asserted the default `Ctrl+F5` only, so a menu
 *     that hard-coded the string would have passed it — which is precisely the defect the "shown,
 *     not merely bound" rule exists to prevent.
 *   - Each row's `onClick` is invoked and observed, so a row that draws correctly and calls nothing
 *     (or calls the wrong action) is red here. The E2E clicked them, but the terminal's response to
 *     a redraw is deliberately invisible, so a dead handler looked exactly like a working one.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `packages/ui/src/renderer/workspace/panel-header-menu.ts`, delete the
 * `if (panel.kind === 'terminal') { items.push({ label: 'Refresh / redraw terminal', … }); }` block.
 * **ALL FIVE tests below fail**: every one of them reads the header row through `headerRedraw()`,
 * which throws when the row is absent rather than returning `undefined` for an assertion to
 * silently accept.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, firstBinding, type Keybindings, type Panel } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';
import { terminalContentMenu } from '../../src/renderer/terminal/terminal-content-menu.js';

const noop = (): void => {};

const panel = (over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id: 'p1',
  originProjectId: 'proj',
  title: 'Panel 1',
  ...over,
});

const headerActions = {
  split: noop,
  zoomIn: noop,
  zoomOut: noop,
  resetZoom: noop,
  save: noop,
  saveAs: noop,
  revert: noop,
  reloadFromDisk: noop,
  revealInTree: noop,
  openInOsExplorer: noop,
  tryAgain: noop,
  copyDetails: noop,
  clearPanelType: noop,
  redraw: noop,
  sendToNewTab: noop,
  sendToTab: noop,
  destroy: noop,
};


/**
 * The panel HEADER menu for a panel of the given kind (FR-041).
 *
 * `'kind' in over` rather than `over.kind ?? 'terminal'`: an UNTYPED panel is `kind: undefined`, and
 * a `??` default would quietly turn the one fixture that must not draw the row into the one that
 * must — making the negative assertion below pass against a terminal.
 */
const header = (
  over: { kind?: Panel['kind']; keybindings?: Keybindings; redraw?: () => void } = {},
): MenuAction[] =>
  panelHeaderMenu({
    panel: panel({ kind: 'kind' in over ? over.kind : 'terminal' }),
    panelVerb: 'Destroy',
    keybindings: over.keybindings ?? DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: null,
    panelFailure: false,
    detach: null,
    actions: { ...headerActions, ...(over.redraw ? { redraw: over.redraw } : {}) },
  });

/** The terminal's own body menu: Copy, Paste and Find (v1 review, #732). */
const content = (): MenuAction[] =>
  terminalContentMenu({ selection: '', findChord: firstBinding(DEFAULT_KEYBINDINGS, 'search.find'), actions: { copySelection: noop, paste: noop, find: noop } });

/** The redraw row of a menu, or a failure that names which menu has stopped offering it. */
function redrawRow(items: MenuAction[], where: string): MenuAction {
  const row = items.find((i) => i.label?.startsWith('Refresh'));
  if (!row) {
    throw new Error(
      `${where} offers no Refresh / redraw row — it drew: ${items.map((i) => i.label).join(', ')}`,
    );
  }
  return row;
}

const headerRedraw = (over?: Parameters<typeof header>[0]): MenuAction =>
  redrawRow(header(over), 'the panel header menu');

describe('the redraw action is on the title menu alone (FR-041; FR-040 amended by the v1 review, #732)', () => {
  it('the title menu draws it under the requirement’s name, in View & state; the body menu draws none', () => {
    expect(headerRedraw().label).toBe('Refresh / redraw terminal');
    // View & state: a redraw changes nothing about the content (FR-043–046).
    expect(headerRedraw().section).toBe('viewState');
    const body = content();
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((i) => i.label?.startsWith('Refresh'))).toBe(false);
  });

  it('only a TERMINAL panel’s header offers it — an untyped panel has nothing to redraw', () => {
    // Both halves in one test on purpose: an absence assertion alone is satisfied by a menu builder
    // that returned nothing at all, which is the shape four tests on this branch were caught in.
    expect(headerRedraw({ kind: 'terminal' }).label).toBe('Refresh / redraw terminal');
    expect(header({ kind: undefined }).map((i) => i.label)).not.toContain(
      'Refresh / redraw terminal',
    );
    expect(header({ kind: 'editor' }).map((i) => i.label)).not.toContain(
      'Refresh / redraw terminal',
    );
  });
});

describe('the chord is SHOWN, and follows the binding (FR-049c, constitution v4.3.0)', () => {
  it('shows Ctrl+F5 out of the box', () => {
    // FR-049d's other half — bare F5 is deliberately NOT taken — is
    // `packages/core/tests/unit/keybindings.test.ts`'s business; what is asserted here is that the
    // menus SHOW whatever `terminal.redraw` is bound to, and by default that is Ctrl+F5.
    expect(firstBinding(DEFAULT_KEYBINDINGS, 'terminal.redraw')).toBe('Ctrl+F5');
    expect(headerRedraw().shortcut).toBe('Ctrl+F5');
  });

  it('a rebind moves what the menu shows — it does not hard-code the string', () => {
    /*
     * The regression the E2E could not see: it only ever ran against the shipped bindings, so a menu
     * that printed the literal "Ctrl+F5" passed it and would go on printing it after the user had
     * rebound the command to something else. A menu that names a key the user has not got teaches
     * them the wrong key, which is worse than naming none.
     */
    const rebound: Keybindings = {
      ...DEFAULT_KEYBINDINGS,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'terminal.redraw': ['Ctrl+Shift+R', 'Ctrl+F5'] },
    };

    expect(headerRedraw({ keybindings: rebound }).shortcut).toBe('Ctrl+Shift+R');
  });
});

describe('the row actually invokes the redraw', () => {
  it('the title menu’s row calls its redraw action exactly once', () => {
    /*
     * The E2E clicked both rows, but a redraw is DEFINED as changing nothing visible — so a row
     * wired to nothing, or wired to `tryAgain`, produced an identical screen and an identical pass.
     * Here the action is observed.
     */
    const fromHeader = vi.fn();
    headerRedraw({ redraw: fromHeader }).onClick?.();
    expect(fromHeader).toHaveBeenCalledTimes(1);
  });
});
