import { describe, it, expect } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  buildShippedDefaults,
  planKeybindingsUpgrade,
  applyKeybindingsUpgrade,
} from '../../src/config/shipped-defaults.js';

/**
 * 062 FR-034a — the v30 keybindings upgrade, in the shape of `shipped-defaults-upgrade-v16-keybindings.test.ts`.
 *
 * `view.resourceMonitor` moves from `Ctrl+Shift+Alt+R` to `Ctrl+Shift+Alt+Y`, so the chord is the same on Windows and
 * Linux. Version 29 wrote the old value into every Windows install, so it is PRESENT and moves only through the guarded
 * rewrite. A customised row is byte-identical, and a binding the user put on Y refuses the move.
 */

type Doc = { version: number; bindings: Record<string, string[]> };

const MONITOR = 'view.resourceMonitor';
const OLD = ['Ctrl+Shift+Alt+R'];
const NEW = ['Ctrl+Shift+Alt+Y'];

function v29Document(overrides: Record<string, string[]> = {}): Doc {
  const live = structuredClone(buildShippedDefaults().keybindings.bindings) as Record<string, string[]>;
  return { version: 1, bindings: { ...live, [MONITOR]: [...OLD], ...overrides } };
}

const after = (doc: Doc): Doc => applyKeybindingsUpgrade(doc) as Doc;

describe('the v30 keybindings upgrade (062 FR-034a)', () => {
  it('is shipped-defaults version 30', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(30);
  });

  it('ships Y, or the cases below are vacuous', () => {
    expect(buildShippedDefaults().keybindings.bindings[MONITOR]).toEqual(NEW);
  });

  it('moves a saved version-29 default to Y', () => {
    expect(planKeybindingsUpgrade(v29Document())).toEqual([{ action: MONITOR, value: NEW }]);
    expect(after(v29Document()).bindings[MONITOR]).toEqual(NEW);
  });

  it('leaves a customised row byte-identical', () => {
    for (const custom of [['F9'], ['Ctrl+Shift+Alt+R', 'F9'], []]) {
      const doc = v29Document({ [MONITOR]: custom });
      expect(planKeybindingsUpgrade(doc).find((l) => l.action === MONITOR), custom.join('|')).toBeUndefined();
      expect(after(doc).bindings[MONITOR]).toEqual(custom);
    }
  });

  it('is refused when the user kept another command on Y', () => {
    const doc = v29Document({ 'editor.save': ['Ctrl+Shift+Alt+Y'] });
    expect(planKeybindingsUpgrade(doc).find((l) => l.action === MONITOR)).toBeUndefined();
    expect(after(doc).bindings[MONITOR]).toEqual(OLD);
  });

  it('is idempotent, and touches no other row', () => {
    const doc = v29Document();
    const moved = after(doc);
    for (const [action, value] of Object.entries(doc.bindings)) {
      if (action !== MONITOR) expect(moved.bindings[action], action).toEqual(value);
    }
    expect(planKeybindingsUpgrade(moved)).toEqual([]);
  });
});
