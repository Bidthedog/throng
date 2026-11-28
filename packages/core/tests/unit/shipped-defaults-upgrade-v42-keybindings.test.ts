import { describe, it, expect } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  buildShippedDefaults,
  planKeybindingsUpgrade,
  applyKeybindingsUpgrade,
} from '../../src/config/shipped-defaults.js';

/**
 * v1 review (#732) — the v42 keybindings upgrade, in the shape of `shipped-defaults-upgrade-v30-keybindings.test.ts`.
 *
 * Four outlining commands shipped unbound up to version 41 and now ship a chord. Every install saved their empty
 * arrays, so the chords reach it only through the guarded rewrite. A row the user bound keeps its value, and a chord
 * another editor or preview command already holds refuses the move.
 */

type Doc = { version: number; bindings: Record<string, string[]> };

const NEW: Record<string, string[]> = {
  'markdown.expandSection': ['Ctrl+M,E'],
  'markdown.expandAll': ['Ctrl+M,X'],
  'markdown.collapseAllInside': ['Ctrl+M,Shift+S'],
  'markdown.expandAllInside': ['Ctrl+M,Shift+E'],
};
const ACTIONS = Object.keys(NEW);

function v41Document(overrides: Record<string, string[]> = {}): Doc {
  const live = structuredClone(buildShippedDefaults().keybindings.bindings) as Record<string, string[]>;
  const unbound = Object.fromEntries(ACTIONS.map((a) => [a, [] as string[]]));
  return { version: 1, bindings: { ...live, ...unbound, ...overrides } };
}

const after = (doc: Doc): Doc => applyKeybindingsUpgrade(doc) as Doc;

describe('the v42 keybindings upgrade (#732, 047 FR-037b, 054 FR-013)', () => {
  it('is shipped-defaults version 42', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(42);
  });

  it('ships the four chords, or the cases below are vacuous', () => {
    for (const action of ACTIONS) expect(buildShippedDefaults().keybindings.bindings[action], action).toEqual(NEW[action]);
  });

  it('binds each row a version-41 install saved unbound', () => {
    expect(planKeybindingsUpgrade(v41Document())).toEqual(
      expect.arrayContaining(ACTIONS.map((action) => ({ action, value: NEW[action] }))),
    );
    const moved = after(v41Document());
    for (const action of ACTIONS) expect(moved.bindings[action], action).toEqual(NEW[action]);
  });

  it('leaves a row the user bound byte-identical', () => {
    const doc = v41Document({ 'markdown.expandAll': ['F9'] });
    expect(planKeybindingsUpgrade(doc).find((l) => l.action === 'markdown.expandAll')).toBeUndefined();
    expect(after(doc).bindings['markdown.expandAll']).toEqual(['F9']);
  });

  it('is refused for a chord the user put on another Markdown command', () => {
    const doc = v41Document({ 'markdown.toggleAll': ['Ctrl+M,X'] });
    expect(planKeybindingsUpgrade(doc).find((l) => l.action === 'markdown.expandAll')).toBeUndefined();
    expect(after(doc).bindings['markdown.expandAll']).toEqual([]);
    // The other three still move.
    expect(after(doc).bindings['markdown.expandSection']).toEqual(NEW['markdown.expandSection']);
  });

  it('is idempotent, and touches no other row', () => {
    const doc = v41Document();
    const moved = after(doc);
    for (const [action, value] of Object.entries(doc.bindings)) {
      if (!ACTIONS.includes(action)) expect(moved.bindings[action], action).toEqual(value);
    }
    expect(planKeybindingsUpgrade(moved)).toEqual([]);
  });
});
