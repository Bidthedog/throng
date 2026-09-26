import { describe, it, expect } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  V11_KEYBINDINGS,
  buildShippedDefaults,
  planKeybindingsUpgrade,
  applyKeybindingsUpgrade,
} from '../../src/config/shipped-defaults.js';

/**
 * 046 iterate round 5 (FR-124) — the v15 keybindings upgrade, in the shape of
 * `shipped-defaults-upgrade-v14-keybindings.test.ts`.
 *
 * Word wrap ships `Ctrl+E,W`, the `Mods+K1,K2` form. Versions 13 and 14 wrote `Ctrl+E W` into every
 * install's `keybindings.json`, so the value is PRESENT and the per-read fill never touches it: it
 * moves only through FR-108's guarded rewrite, with a frozen version-14 guard source. A customised
 * row is byte-identical. Version 14 is not edited.
 */

type Doc = { version: number; bindings: Record<string, string[]> };

const WORD_WRAP = 'editor.toggleWordWrap';

/** An untouched version-13 / 14 document: every row at its live value, word wrap at `Ctrl+E W`. */
function v14Document(overrides: Record<string, string[]> = {}): Doc {
  const live = structuredClone(buildShippedDefaults().keybindings.bindings) as Record<string, string[]>;
  return { version: 1, bindings: { ...live, [WORD_WRAP]: ['Ctrl+E W'], ...overrides } };
}

function after(doc: Doc): Doc {
  return applyKeybindingsUpgrade(doc) as Doc;
}

describe('the v15 keybindings upgrade (FR-124)', () => {
  it('is shipped-defaults version 15 or later (re-pinned: FR-127 bumps it to 16)', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(16);
  });

  it('word wrap ships Ctrl+E,W, or the cases below are vacuous', () => {
    expect(buildShippedDefaults().keybindings.bindings[WORD_WRAP]).toEqual(['Ctrl+E,W']);
  });

  it('a saved version-13/14 default Ctrl+E W moves to Ctrl+E,W', () => {
    const plan = planKeybindingsUpgrade(v14Document());
    expect(plan).toEqual([{ action: WORD_WRAP, value: ['Ctrl+E,W'] }]);
    expect(after(v14Document()).bindings[WORD_WRAP]).toEqual(['Ctrl+E,W']);
  });

  it('a customised row is byte-identical', () => {
    for (const custom of [['Ctrl+E W', 'Ctrl+Alt+Z'], ['Ctrl+Q W'], ['Ctrl+E,Shift+W'], ['Ctrl+E  W']]) {
      const doc = v14Document({ [WORD_WRAP]: custom });
      expect(planKeybindingsUpgrade(doc).find((l) => l.action === WORD_WRAP), custom.join('|')).toBeUndefined();
      expect(after(doc).bindings[WORD_WRAP]).toEqual(custom);
    }
  });

  it('every other row is untouched by the move', () => {
    const doc = v14Document();
    const moved = after(doc);
    for (const [action, value] of Object.entries(doc.bindings)) {
      if (action === WORD_WRAP) continue;
      expect(moved.bindings[action], action).toEqual(value);
    }
  });

  it('is idempotent — a second run plans nothing', () => {
    expect(planKeybindingsUpgrade(after(v14Document()))).toEqual([]);
  });

  it('refuses the move when the user already owns the bare first stroke Ctrl+E (FR-092)', () => {
    const doc = v14Document({ 'editor.save': ['Ctrl+E'] });
    expect(planKeybindingsUpgrade(doc).find((l) => l.action === WORD_WRAP)).toBeUndefined();
  });

  it('a version-11 install still at Ctrl+Alt+W lands on Ctrl+E,W in one pass', () => {
    const doc: Doc = { version: 1, bindings: structuredClone(V11_KEYBINDINGS) as Record<string, string[]> };
    expect(after(doc).bindings[WORD_WRAP]).toEqual(['Ctrl+E,W']);
  });
});
