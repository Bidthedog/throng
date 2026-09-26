import { describe, it, expect } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  buildShippedDefaults,
  planKeybindingsUpgrade,
  applyKeybindingsUpgrade,
} from '../../src/config/shipped-defaults.js';

/**
 * 046 iterate round 7 (FR-127) — the v16 keybindings upgrade, in the shape of
 * `shipped-defaults-upgrade-v15-keybindings.test.ts`.
 *
 * `panel.zoomReset` ALSO ships the main-row `Ctrl+Alt+0`, after `Ctrl+Alt+Numpad0` and before
 * `Ctrl+MiddleClick` (Constitution IV's second named exception to the one-chord rule). Version 15
 * wrote `['Ctrl+Alt+Numpad0', 'Ctrl+MiddleClick']` into every install, so the value is PRESENT and
 * the per-read fill never touches it: it moves only through FR-108's guarded rewrite, with a frozen
 * version-15 guard source. A customised row is byte-identical; a binding the user kept on
 * `Ctrl+Alt+0` in an intersecting scope refuses the row. Version 15 is not edited. `zoom.reset` is
 * unchanged.
 */

type Doc = { version: number; bindings: Record<string, string[]> };

const PANEL_RESET = 'panel.zoomReset';
const V15_PANEL_RESET = ['Ctrl+Alt+Numpad0', 'Ctrl+MiddleClick'];
const V16_PANEL_RESET = ['Ctrl+Alt+Numpad0', 'Ctrl+Alt+0', 'Ctrl+MiddleClick'];

/** An untouched version-15 document: every row at its live value, the panel reset at v15's. */
function v15Document(overrides: Record<string, string[]> = {}): Doc {
  const live = structuredClone(buildShippedDefaults().keybindings.bindings) as Record<string, string[]>;
  return { version: 1, bindings: { ...live, [PANEL_RESET]: [...V15_PANEL_RESET], ...overrides } };
}

function after(doc: Doc): Doc {
  return applyKeybindingsUpgrade(doc) as Doc;
}

describe('the v16 keybindings upgrade (FR-127)', () => {
  it('is shipped-defaults version 16', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(16);
  });

  it('panel.zoomReset ships Numpad0, then the main-row 0, then the gesture — or the cases below are vacuous', () => {
    expect(buildShippedDefaults().keybindings.bindings[PANEL_RESET]).toEqual(V16_PANEL_RESET);
  });

  it('zoom.reset is unchanged — the main-row 0 still resets no window zoom', () => {
    expect(buildShippedDefaults().keybindings.bindings['zoom.reset']).toEqual(['Ctrl+Shift+Alt+Numpad0']);
  });

  it('a saved version-15 default gains Ctrl+Alt+0', () => {
    expect(planKeybindingsUpgrade(v15Document())).toEqual([{ action: PANEL_RESET, value: V16_PANEL_RESET }]);
    expect(after(v15Document()).bindings[PANEL_RESET]).toEqual(V16_PANEL_RESET);
  });

  it('matches the version-15 default in any order — a binding array is a set', () => {
    const doc = v15Document({ [PANEL_RESET]: ['Ctrl+MiddleClick', 'Ctrl+Alt+Numpad0'] });
    expect(after(doc).bindings[PANEL_RESET]).toEqual(V16_PANEL_RESET);
  });

  it('a customised row is byte-identical', () => {
    for (const custom of [['Ctrl+Alt+Numpad0'], ['Ctrl+Alt+Numpad0', 'Ctrl+MiddleClick', 'F9'], ['Ctrl+Alt+R']]) {
      const doc = v15Document({ [PANEL_RESET]: custom });
      expect(planKeybindingsUpgrade(doc).find((l) => l.action === PANEL_RESET), custom.join('|')).toBeUndefined();
      expect(after(doc).bindings[PANEL_RESET]).toEqual(custom);
    }
  });

  it('a binding the user kept on Ctrl+Alt+0 in an intersecting scope refuses the row', () => {
    const doc = v15Document({ 'editor.save': ['Ctrl+Alt+0'] });
    expect(planKeybindingsUpgrade(doc).find((l) => l.action === PANEL_RESET)).toBeUndefined();
    expect(after(doc).bindings[PANEL_RESET]).toEqual(V15_PANEL_RESET);
  });

  it('every other row is untouched by the move', () => {
    const doc = v15Document();
    const moved = after(doc);
    for (const [action, value] of Object.entries(doc.bindings)) {
      if (action === PANEL_RESET) continue;
      expect(moved.bindings[action], action).toEqual(value);
    }
  });

  it('is idempotent — a second run plans nothing', () => {
    expect(planKeybindingsUpgrade(after(v15Document()))).toEqual([]);
  });
});
