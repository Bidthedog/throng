/**
 * Chord collisions are SCOPE-AWARE (016, FR-017b1).
 *
 * Two commands clash iff their scope sets INTERSECT on a chord. `editor.cutLine` ({editor}) and
 * `file.cut` ({explorer}) therefore share `Ctrl+X` legitimately — that coexistence is the headline
 * proof the design works, and a flat uniqueness rule would forbid it.
 *
 * The check is ENUMERATED FROM THE REGISTRY, never from a hand-listed set of features: a hand list
 * silently stops covering the command added after it was written.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  chordCollisions,
  sameBindingToken,
  type ActionId,
} from '../../src/config/keybindings.js';

describe('chordCollisions (FR-017b1)', () => {
  it('reports NOTHING for the shipped defaults — they are a legal set', () => {
    expect(chordCollisions(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });

  it('lets editor.cutLine and file.cut share Ctrl+X — disjoint scopes are not a clash', () => {
    const bindings = { 'editor.cutLine': ['Ctrl+X'], 'file.cut': ['Ctrl+X'] };
    const scopes = {
      'editor.cutLine': new Set(['editor'] as const),
      'file.cut': new Set(['explorer'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    expect(chordCollisions(bindings, scopes)).toEqual([]);
  });

  it('reports a clash when the scope sets INTERSECT', () => {
    const bindings = { 'editor.cutLine': ['Ctrl+X'], 'editor.indentLines': ['Ctrl+X'] };
    const scopes = {
      'editor.cutLine': new Set(['editor'] as const),
      'editor.indentLines': new Set(['editor'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    const clashes = chordCollisions(bindings, scopes);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].token).toBe('Ctrl+X');
    expect([...clashes[0].actions].sort()).toEqual(['editor.cutLine', 'editor.indentLines']);
  });

  it('reports a clash on a PARTIAL scope overlap — one shared context is enough', () => {
    const bindings = { 'search.find': ['Ctrl+F'], 'editor.cutLine': ['Ctrl+F'] };
    const scopes = {
      'search.find': new Set(['editor', 'terminal'] as const),
      'editor.cutLine': new Set(['editor'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    expect(chordCollisions(bindings, scopes)).toHaveLength(1);
  });

  it('compares chords case-insensitively, as resolution does', () => {
    const bindings = { 'editor.cutLine': ['Ctrl+x'], 'editor.indentLines': ['Ctrl+X'] };
    const scopes = {
      'editor.cutLine': new Set(['editor'] as const),
      'editor.indentLines': new Set(['editor'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    expect(chordCollisions(bindings, scopes)).toHaveLength(1);
  });

  it('enumerates from the registry — every shipped command is covered, not a chosen few', () => {
    const covered = new Set(Object.keys(COMMAND_SCOPES));
    for (const action of Object.keys(DEFAULT_KEYBINDINGS.bindings) as ActionId[]) {
      expect(covered.has(action), `"${action}" is not enumerated by the collision check`).toBe(true);
    }
  });
});

/**
 * 046 T030 (US2, FR-020/022). The four new side-pane commands are EVERYWHERE-scoped (data-model §4,
 * R3), the widest scope set that exists — so they are the ones most likely to clash with something
 * already EVERYWHERE (`zoom.*`, `view.*`, `tabs.openPicker`, `navigate.quickOpen`, …), and the
 * `projects` scope (046 R3) is exercised nowhere else in this suite.
 */
describe('the four 046 side-pane commands collide with nothing, in any scope, projects included (FR-020/022)', () => {
  const IDS = ['project.next', 'project.previous', 'focus.explorer', 'focus.projects'] as const;

  it('each ships a default chord', () => {
    for (const id of IDS) {
      const tokens = DEFAULT_KEYBINDINGS.bindings[id];
      expect(tokens, id).toBeDefined();
      expect(tokens?.length, id).toBeGreaterThan(0);
    }
  });

  it('the full shipped registry — with the four included — is still a legal, collision-free set', () => {
    expect(chordCollisions(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });

  it('the `projects` scope is actually exercised by the check above, not vacuously empty', () => {
    const projectsScoped = (Object.keys(COMMAND_SCOPES) as ActionId[]).filter((a) =>
      COMMAND_SCOPES[a]?.has('projects'),
    );
    for (const id of IDS) expect(projectsScoped, id).toContain(id);
  });
});

/**
 * 046 iterate round 1 (FR-109 bullet 2, FR-105). Chord comparison must fold the FR-105 same-binding
 * equivalences — `Ctrl+Alt+=` is the SAME binding as `Ctrl+Alt++` on a US/UK keyboard's `=` key,
 * and the keypad `+`/`-` are the same binding as the main-row key — before deciding two commands
 * clash. Without this, `chordCollisions` could pass a shipped set that silently double-binds a key on
 * the layouts where `+` needs Shift, because the two spellings never compare equal as plain strings.
 *
 * `0`/`Numpad0` is deliberately NOT one of these equivalences (046 iterate round 2, FR-114/FR-115):
 * the keypad zero is its OWN distinct binding now, carved out specifically so the main-row `0` would
 * stop firing `zoom.reset`/`panel.zoomReset` — see the describe block below.
 */
describe('sameBindingToken (FR-105) and its use inside chordCollisions (FR-109 bullet 2)', () => {
  it('folds the unshifted "=" key onto the "+" key, keeping the modifier prefix', () => {
    expect(sameBindingToken('Ctrl+Alt+=')).toBe('Ctrl+Alt++');
    expect(sameBindingToken('Ctrl+Shift+Alt++')).toBe('Ctrl+Shift+Alt++');
  });

  it('folds the keypad + and - onto the main-row key', () => {
    expect(sameBindingToken('Ctrl+NumpadAdd')).toBe('Ctrl++');
    expect(sameBindingToken('Ctrl+Alt+NumpadSubtract')).toBe('Ctrl+Alt+-');
  });

  /**
   * Branch-review finding (spec 046, FR-114/FR-115) — `Numpad0` is DISTINCT from the main-row `0`
   * for binding-identity purposes, unlike `+`/`-`. FR-114 moved `zoom.reset`/`panel.zoomReset` onto
   * their own literal `Numpad0` token specifically so the main-row `0` would NOT fire either reset —
   * "The main-row 0 key MUST NOT fire either reset, in any tier, in any scope." A `sameBindingToken`
   * that still folded `Numpad0` onto `'0'` would silently reintroduce that ambiguity everywhere the
   * fold is used for collision purposes (`chordCollisions`, the FR-108 shipped-defaults upgrade
   * guard), the exact bug this fix round closes: a v11 user with an unrelated command on
   * `Ctrl+Shift+Alt+0` was wrongly refused the `zoom.reset` upgrade to `Ctrl+Shift+Alt+Numpad0`.
   */
  it('does NOT fold Numpad0 onto the main-row 0 — they are distinct bindings (FR-114/FR-115)', () => {
    expect(sameBindingToken('Ctrl+Shift+Alt+Numpad0')).toBe('Ctrl+Shift+Alt+Numpad0');
    expect(sameBindingToken('Ctrl+Alt+Numpad0')).toBe('Ctrl+Alt+Numpad0');
  });

  it('leaves an already-canonical token, and a gesture, untouched', () => {
    expect(sameBindingToken('Ctrl+Alt++')).toBe('Ctrl+Alt++');
    expect(sameBindingToken('Ctrl+WheelUp')).toBe('Ctrl+WheelUp');
  });

  it('applies the fold to EACH stroke of a two-stroke token', () => {
    // Re-pinned for FR-124: a two-stroke token is written in its comma form `Mods+K1,K2`.
    expect(sameBindingToken('Ctrl+E,NumpadAdd')).toBe('Ctrl+E,+');
  });

  it('chordCollisions reports a clash between Ctrl+Alt+= and Ctrl+Alt++ once compared this way', () => {
    const bindings = { 'panel.zoomIn': ['Ctrl+Alt++'], 'editor.saveAs': ['Ctrl+Alt+='] };
    const scopes = {
      'panel.zoomIn': new Set(['editor'] as const),
      'editor.saveAs': new Set(['editor'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    const clashes = chordCollisions(bindings, scopes);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].token).toBe('Ctrl+Alt++');
    expect([...clashes[0].actions].sort()).toEqual(['editor.saveAs', 'panel.zoomIn']);
  });

  it('chordCollisions does NOT report a clash between the keypad Numpad0 and the main-row 0 (FR-114/FR-115)', () => {
    const bindings = { 'panel.zoomReset': ['Ctrl+Alt+0'], 'editor.saveAs': ['Ctrl+Alt+Numpad0'] };
    const scopes = {
      'panel.zoomReset': new Set(['editor'] as const),
      'editor.saveAs': new Set(['editor'] as const),
    } as unknown as typeof COMMAND_SCOPES;
    expect(chordCollisions(bindings, scopes)).toEqual([]);
  });

  it('the full shipped registry is still collision-free once FR-105 folding is applied', () => {
    // chordCollisions already applies the fold internally, so this is the same call the "reports
    // NOTHING for the shipped defaults" test above makes — restated here beside the FR-109 cases so a
    // reader can see the whole-registry guard sits next to the rule it now depends on.
    expect(chordCollisions(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });
});
