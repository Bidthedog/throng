import { describe, it, expect } from 'vitest';
import {
  SHIPPED_DEFAULTS_VERSION,
  V11_KEYBINDINGS,
  V12_KEYBINDINGS,
  buildShippedDefaults,
  planKeybindingsUpgrade,
  applyKeybindingsUpgrade,
} from '../../src/config/shipped-defaults.js';
import { parseKeybindings } from '../../src/config/keybindings.js';

/**
 * 046 iterate round 3 (FR-118, T174) — the v14 keybindings upgrade, in the shape of
 * `shipped-defaults-upgrade-v13-keybindings.test.ts`.
 *
 * FR-117 moves five rows that version 13 already wrote into every install's `keybindings.json`
 * (`focus.notice`, `view.toggleProjects`, `view.toggleExplorer`, `focus.explorer`,
 * `focus.projects`) and adds one command, `focus.workspace`, that no saved file contains. Version 13
 * is not edited: the maintainer's config already holds a 13 marker, and `main.ts` runs the upgrade
 * only when the saved marker differs from the shipped one.
 */

/** FR-117's shipped values — what every moved row must land on. */
const FR117: Record<string, string[]> = {
  'focus.projects': ['Ctrl+Shift+Alt+B'],
  'focus.workspace': ['Ctrl+Shift+Alt+N'],
  'focus.explorer': ['Ctrl+Shift+Alt+M'],
  'view.toggleProjects': ['Ctrl+Shift+Alt+J'],
  'view.toggleExplorer': ['Ctrl+Shift+Alt+K'],
  'focus.notice': ['Ctrl+Shift+Alt+V'],
};

/** What version 13 wrote for the five moved rows (FR-102's tier-1 values). A frozen copy. */
const V13_ROWS: Record<string, string[]> = {
  'focus.notice': ['Ctrl+Shift+Alt+M'],
  'view.toggleProjects': ['Ctrl+Shift+Alt+B'],
  'view.toggleExplorer': ['Ctrl+Shift+Alt+N'],
  'focus.explorer': ['Ctrl+Shift+Alt+F'],
  'focus.projects': ['Ctrl+Shift+Alt+P'],
};

const FIVE = Object.keys(V13_ROWS);

type Doc = { version: number; bindings: Record<string, string[]> };

/**
 * An untouched version-13 document: every shipped row at its live value, except the five, which
 * hold what version 13 wrote. `focus.workspace` is absent, as it is in every real saved file.
 */
function v13Document(overrides: Record<string, string[]> = {}): Doc {
  const live = structuredClone(buildShippedDefaults().keybindings.bindings) as Record<string, string[]>;
  delete live['focus.workspace'];
  return { version: 1, bindings: { ...live, ...V13_ROWS, ...overrides } };
}

/** An untouched version-11 document for FR-108's rows (the four 046 commands did not exist yet). */
function v11Document(): Doc {
  return { version: 1, bindings: structuredClone(V11_KEYBINDINGS) as Record<string, string[]> };
}

/** An untouched version-12 document: v11's rows, with v12's five on top. */
function v12Document(): Doc {
  return {
    version: 1,
    bindings: { ...structuredClone(V11_KEYBINDINGS), ...structuredClone(V12_KEYBINDINGS) } as Record<string, string[]>,
  };
}

function after(doc: Doc): Doc {
  return applyKeybindingsUpgrade(doc) as Doc;
}

describe('the v14 keybindings upgrade (FR-118)', () => {
  it('is shipped-defaults version 14 or later (re-pinned: FR-124 bumps it to 15, FR-127 to 16)', () => {
    expect(SHIPPED_DEFAULTS_VERSION).toBe(16);
  });

  it('the shipped set carries FR-117s six values, or the cases below are vacuous', () => {
    const live = buildShippedDefaults().keybindings.bindings;
    for (const [action, chord] of Object.entries(FR117)) expect(live[action], action).toEqual(chord);
  });

  it('an untouched version-13 document moves all five rows to FR-117, and every other row is byte-identical', () => {
    const doc = v13Document();
    const before = structuredClone(doc);
    const result = after(doc);
    for (const action of FIVE) expect(result.bindings[action], action).toEqual(FR117[action]);
    for (const [action, value] of Object.entries(before.bindings)) {
      if (FIVE.includes(action)) continue;
      expect(result.bindings[action], action).toEqual(value);
    }
    // No binding on N stays behind, so focus.workspace is left for the per-read fill.
    expect('focus.workspace' in result.bindings).toBe(false);
  });

  it('an untouched version-11 document moves its three rows straight to FR-117 — no version-13 chord appears', () => {
    const result = after(v11Document());
    for (const action of ['focus.notice', 'view.toggleProjects', 'view.toggleExplorer']) {
      expect(result.bindings[action], action).toEqual(FR117[action]);
    }
    expect(result.bindings['focus.notice']).not.toEqual(V13_ROWS['focus.notice']);
    expect(result.bindings['view.toggleProjects']).not.toEqual(V13_ROWS['view.toggleProjects']);
    expect(result.bindings['view.toggleExplorer']).not.toEqual(V13_ROWS['view.toggleExplorer']);
  });

  it('an untouched version-12 document moves all five straight to FR-117 — no version-13 chord appears', () => {
    const result = after(v12Document());
    for (const action of FIVE) {
      expect(result.bindings[action], action).toEqual(FR117[action]);
      expect(result.bindings[action], action).not.toEqual(V13_ROWS[action]);
    }
  });

  it('a customised view.toggleProjects that still holds B is left alone, and focus.projects keeps its saved chord', () => {
    const doc = v13Document({ 'view.toggleProjects': ['Ctrl+Shift+Alt+B', 'F7'] });
    const result = after(doc);
    expect(result.bindings['view.toggleProjects']).toEqual(['Ctrl+Shift+Alt+B', 'F7']);
    // Refused by the fixed-point collision guard: B is still the user's.
    expect(result.bindings['focus.projects']).toEqual(['Ctrl+Shift+Alt+P']);
    // The rows with no collision still move.
    expect(result.bindings['focus.explorer']).toEqual(FR117['focus.explorer']);
    expect(result.bindings['focus.notice']).toEqual(FR117['focus.notice']);
  });

  it('a customised focus.projects is left alone', () => {
    const result = after(v13Document({ 'focus.projects': ['F8'] }));
    expect(result.bindings['focus.projects']).toEqual(['F8']);
  });

  it('writes focus.workspace: [] when a customised view.toggleExplorer still holds N', () => {
    const doc = v13Document({ 'view.toggleExplorer': ['Ctrl+Shift+Alt+N', 'F9'] });
    const result = after(doc);
    expect(result.bindings['view.toggleExplorer']).toEqual(['Ctrl+Shift+Alt+N', 'F9']);
    expect(result.bindings['focus.workspace']).toEqual([]);
    // Visibly unbound after a parse, not silently sharing the user's chord.
    expect(parseKeybindings(result).bindings['focus.workspace']).toEqual([]);
  });

  it('writes focus.workspace: [] when view.toggleExplorer is refused its move and so keeps N', () => {
    // K is taken by a row that is not moving, so view.toggleExplorer stays on N.
    const doc = v13Document({ 'search.replaceAll': ['Ctrl+Shift+Alt+K'] });
    const result = after(doc);
    expect(result.bindings['view.toggleExplorer']).toEqual(['Ctrl+Shift+Alt+N']);
    expect(result.bindings['focus.workspace']).toEqual([]);
  });

  it('leaves focus.workspace absent where nothing binds N, and the per-read fill supplies N', () => {
    const result = after(v13Document());
    expect('focus.workspace' in result.bindings).toBe(false);
    expect(parseKeybindings(result).bindings['focus.workspace']).toEqual(['Ctrl+Shift+Alt+N']);
  });

  it('never touches a focus.workspace the saved file already holds', () => {
    const doc = v13Document({
      'view.toggleExplorer': ['Ctrl+Shift+Alt+N', 'F9'],
      'focus.workspace': ['F10'],
    });
    expect(planKeybindingsUpgrade(doc).find((l) => l.action === 'focus.workspace')).toBeUndefined();
  });

  it('is idempotent — a second run plans nothing, for every document above, including the one given focus.workspace: []', () => {
    const documents: Doc[] = [
      v13Document(),
      v11Document(),
      v12Document(),
      v13Document({ 'view.toggleProjects': ['Ctrl+Shift+Alt+B', 'F7'] }),
      v13Document({ 'focus.projects': ['F8'] }),
      v13Document({ 'view.toggleExplorer': ['Ctrl+Shift+Alt+N', 'F9'] }),
      v13Document({ 'search.replaceAll': ['Ctrl+Shift+Alt+K'] }),
    ];
    for (const doc of documents) {
      const once = applyKeybindingsUpgrade(doc);
      expect(planKeybindingsUpgrade(once)).toEqual([]);
    }
  });
});
