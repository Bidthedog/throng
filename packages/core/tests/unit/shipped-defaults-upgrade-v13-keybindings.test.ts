import { describe, it, expect } from 'vitest';
import {
  V11_ZOOM_RESET_BINDING,
  buildShippedDefaults,
  planKeybindingsUpgrade,
  applyKeybindingsUpgrade,
} from '../../src/config/shipped-defaults.js';

/**
 * 046 iterate round 1 (FR-108) — the v13 keybindings upgrade, in the shape of
 * `shipped-defaults-upgrade-v12-keybindings.test.ts`.
 *
 * FR-108 names every row: twelve actions move from their VERSION-11 value
 * (`zoom.in`, `zoom.out`, `zoom.reset`, `focus.left/right/up/down`, `focus.notice`,
 * `view.toggleProjects`/`toggleExplorer`, `tabs.openPicker`, `panel.zoomIn/Out/Reset`,
 * `editor.toggleWordWrap`), and five move from their VERSION-12 value (`zoom.reset` again —
 * it has TWO possible guard sources, since v12 already touched it — `project.next`/`previous`,
 * `focus.explorer`/`projects`). Version 12 never shipped to a released install (unreleased, 046),
 * so its own guarded rewrite (`shipped-defaults-upgrade-v12-keybindings.test.ts`) is untouched: an
 * install still on the v11 pair jumps straight to the v13 value, and only a hand-tested build that
 * genuinely reached v12 needs the second guard source.
 */
describe('the v13 keybindings upgrade (FR-108)', () => {
  const V13 = buildShippedDefaults().keybindings.bindings;

  it('the v13 shipped set differs from every v11 row named by FR-108, or the cases below are vacuous', () => {
    const V11_ROWS: Record<string, string[]> = {
      'zoom.in': ['Ctrl+=', 'Ctrl++', 'Ctrl+WheelUp'],
      'zoom.out': ['Ctrl+-', 'Ctrl+WheelDown'],
      'zoom.reset': [...V11_ZOOM_RESET_BINDING],
      'focus.left': ['Ctrl+Alt+ArrowLeft'],
      'focus.right': ['Ctrl+Alt+ArrowRight'],
      'focus.up': ['Ctrl+Alt+ArrowUp'],
      'focus.down': ['Ctrl+Alt+ArrowDown'],
      'focus.notice': ['Ctrl+Alt+M'],
      'view.toggleProjects': ['Ctrl+Alt+B'],
      'view.toggleExplorer': ['Ctrl+Alt+N'],
      'tabs.openPicker': ['Ctrl+Alt+T'],
      'panel.zoomIn': ['Ctrl+Alt+=', 'Ctrl+Alt++'],
      'panel.zoomOut': ['Ctrl+Alt+-'],
      'panel.zoomReset': ['Ctrl+Alt+0'],
      'editor.toggleWordWrap': ['Ctrl+Alt+W'],
    };
    for (const [action, v11] of Object.entries(V11_ROWS)) {
      expect([...(V13[action] ?? [])].sort(), action).not.toEqual([...v11].sort());
    }
  });

  /** A document shaped like an install still on the version-11 shipped set for these rows. */
  function v11Document(overrides: Record<string, string[]> = {}): { version: number; bindings: Record<string, string[]> } {
    return {
      version: 1,
      bindings: {
        'zoom.in': ['Ctrl+=', 'Ctrl++', 'Ctrl+WheelUp'],
        'zoom.out': ['Ctrl+-', 'Ctrl+WheelDown'],
        'zoom.reset': [...V11_ZOOM_RESET_BINDING],
        'focus.left': ['Ctrl+Alt+ArrowLeft'],
        'focus.right': ['Ctrl+Alt+ArrowRight'],
        'focus.up': ['Ctrl+Alt+ArrowUp'],
        'focus.down': ['Ctrl+Alt+ArrowDown'],
        'focus.notice': ['Ctrl+Alt+M'],
        'view.toggleProjects': ['Ctrl+Alt+B'],
        'view.toggleExplorer': ['Ctrl+Alt+N'],
        'tabs.openPicker': ['Ctrl+Alt+T'],
        'panel.zoomIn': ['Ctrl+Alt+=', 'Ctrl+Alt++'],
        'panel.zoomOut': ['Ctrl+Alt+-'],
        'panel.zoomReset': ['Ctrl+Alt+0'],
        'editor.toggleWordWrap': ['Ctrl+Alt+W'],
        ...overrides,
      },
    };
  }

  it('rewrites every v11-sourced row to its v13 shipped value', () => {
    const plan = planKeybindingsUpgrade(v11Document());
    const byAction = Object.fromEntries(plan.map((leaf) => [leaf.action, leaf.value]));
    for (const action of [
      'zoom.in',
      'zoom.out',
      'zoom.reset',
      'focus.left',
      'focus.right',
      'focus.up',
      'focus.down',
      'focus.notice',
      'view.toggleProjects',
      'view.toggleExplorer',
      'tabs.openPicker',
      'panel.zoomIn',
      'panel.zoomOut',
      'panel.zoomReset',
      'editor.toggleWordWrap',
    ]) {
      expect(byAction[action], action).toEqual(V13[action]);
    }
  });

  it('zoom.reset ALSO moves from its version-12 value — the second guard source', () => {
    const doc = v11Document({ 'zoom.reset': ['Ctrl+0', 'Ctrl+Shift+0', 'Ctrl+MiddleClick'] });
    const plan = planKeybindingsUpgrade(doc);
    const leaf = plan.find((l) => l.action === 'zoom.reset');
    expect(leaf?.value).toEqual(V13['zoom.reset']);
  });

  it('the four new 046 commands move from their version-12 value when an install already has one', () => {
    const doc = v11Document({
      'project.next': ['Ctrl+Alt+PageDown'],
      'project.previous': ['Ctrl+Alt+PageUp'],
      'focus.explorer': ['Ctrl+Alt+F'],
      'focus.projects': ['Ctrl+Alt+P'],
    });
    const plan = planKeybindingsUpgrade(doc);
    const byAction = Object.fromEntries(plan.map((leaf) => [leaf.action, leaf.value]));
    expect(byAction['project.next']).toEqual(V13['project.next']);
    expect(byAction['project.previous']).toEqual(V13['project.previous']);
    expect(byAction['focus.explorer']).toEqual(V13['focus.explorer']);
    expect(byAction['focus.projects']).toEqual(V13['focus.projects']);
  });

  it('a customised array is left byte-identical, for every one of the guarded rows', () => {
    const doc = v11Document({
      'focus.notice': ['Ctrl+Alt+Z'],
      'view.toggleProjects': ['Ctrl+Shift+Q'],
    });
    const plan = planKeybindingsUpgrade(doc);
    const actions = plan.map((l) => l.action);
    expect(actions).not.toContain('focus.notice');
    expect(actions).not.toContain('view.toggleProjects');
  });

  it('refuses a rewrite that would collide, on normalised tokens, with an action whose array is not being rewritten', () => {
    // `focus.notice`'s shipped chord is `Ctrl+Shift+Alt+V` (046 iterate round 3, FR-117; it was
    // `Ctrl+Shift+Alt+M` at v13) — put it on an untouched action first.
    const doc = v11Document({ 'search.replaceAll': ['Ctrl+Shift+Alt+V'] });
    const plan = planKeybindingsUpgrade(doc);
    expect(plan.find((l) => l.action === 'focus.notice')).toBeUndefined();
    // Every OTHER guarded row with no such collision still moves.
    expect(plan.find((l) => l.action === 'view.toggleProjects')).toBeDefined();
  });

  it('the gesture case: a customised zoom.in that kept Ctrl+WheelUp keeps it, and panel.zoomIn is not given it', () => {
    // The user customised zoom.in (a real chord, Ctrl+Shift+9, plus the gesture it shipped with) —
    // that whole array is theirs, gesture included, and the guard leaves it byte-identical.
    //
    // panel.zoomIn's OWN v13 value carries Ctrl+WheelUp too (FR-106 moves the gesture family to the
    // panel zoom) — but the user's zoom.in customisation already claims that exact gesture, so
    // applying panel.zoomIn's new default WOULD collide with a binding the user set on purpose.
    // Per the same rule the v12 zoom.reset guard already applies (one collision refuses the WHOLE
    // row, not just the colliding part), panel.zoomIn is left at its OLD v11 value entirely — it is
    // not given the new chord either, only a correct chord with the wrong gesture attached would be
    // a silent half-migration.
    const doc = v11Document({ 'zoom.in': ['Ctrl+Shift+9', 'Ctrl+WheelUp'] });
    const before = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const after = applyKeybindingsUpgrade(doc) as { bindings: Record<string, string[]> };
    expect(after.bindings['zoom.in']).toEqual(before.bindings['zoom.in']);
    expect(after.bindings['panel.zoomIn']).toEqual(before.bindings['panel.zoomIn']);
  });

  it('is idempotent — a second run plans nothing', () => {
    const once = applyKeybindingsUpgrade(v11Document());
    expect(planKeybindingsUpgrade(once)).toEqual([]);
  });

  it('editor.toggleWordWrap moves from [Ctrl+Alt+W] to the live shipped [Ctrl+E,W] (re-pinned for FR-124)', () => {
    const plan = planKeybindingsUpgrade(v11Document());
    const leaf = plan.find((l) => l.action === 'editor.toggleWordWrap');
    expect(leaf?.value).toEqual(['Ctrl+E,W']);
  });

  it('an install still on the v11 zoom.reset pair jumps straight to the v13 chord', () => {
    // zoom.reset now goes through the SAME generic FR-108 path as every other row (review finding
    // CRITICAL 1) rather than a hand-rolled block, so this proves the v11 source still fires and
    // lands on v13's real value with no intermediate v12 value ever appearing on disk.
    const doc = { version: 1, bindings: { 'zoom.reset': ['Ctrl+MiddleClick', 'Ctrl+0'] } };
    const plan = planKeybindingsUpgrade(doc);
    expect(plan).toEqual([{ action: 'zoom.reset', value: V13['zoom.reset'] }]);
  });

  /**
   * Review finding CRITICAL 1: `zoom.reset`'s collision guard used to check for the RETIRED tokens
   * `Ctrl+Shift+0` / `Ctrl+Shift+)` — the right check when the intended target was `Ctrl+Shift+0`,
   * silently wrong once FR-102/FR-107 moved the real v13 target to `Ctrl+Shift+Alt+0`. Routing it
   * through `planFR108Rows` like every other row means the ACTUAL shipped value is what gets
   * checked, and a token that stopped being the target stops being a reason to refuse.
   *
   * 046 iterate round 2 (FR-114, T160) moved the REAL v13 target again — `Ctrl+Shift+Alt+Numpad0`,
   * not `…+0` — so the fixture below moves with it. The `planFR108Rows` guard is unchanged; only the
   * shipped value it compares against has.
   */
  describe('zoom.reset is collision-checked against its REAL v13 target, not a retired token (CRITICAL 1, FR-114)', () => {
    it('refuses the move when another action already binds the real v13 target Ctrl+Shift+Alt+Numpad0', () => {
      const doc = v11Document({ 'search.replaceAll': ['Ctrl+Shift+Alt+Numpad0'] });
      const plan = planKeybindingsUpgrade(doc);
      expect(plan.find((l) => l.action === 'zoom.reset')).toBeUndefined();
    });

    it('no longer refuses the move over the RETIRED token Ctrl+Shift+0, which is not the v13 target', () => {
      const doc = v11Document({ 'search.replaceAll': ['Ctrl+Shift+0'] });
      const plan = planKeybindingsUpgrade(doc);
      expect(plan.find((l) => l.action === 'zoom.reset')?.value).toEqual(V13['zoom.reset']);
    });

    it('no longer refuses the move over the RETIRED produced token Ctrl+Shift+), for the same reason', () => {
      const doc = v11Document({ 'search.replaceAll': ['Ctrl+Shift+)'] });
      const plan = planKeybindingsUpgrade(doc);
      expect(plan.find((l) => l.action === 'zoom.reset')?.value).toEqual(V13['zoom.reset']);
    });

    /**
     * Branch-review finding (spec 046, FR-114/FR-115) — this test used to assert the OPPOSITE: that
     * `Ctrl+Shift+Alt+0` (main-row) still refused the move because the collision guard's fold
     * treated it as the SAME chord as the real `Ctrl+Shift+Alt+Numpad0` target. That fold was itself
     * the bug: FR-114 moved `zoom.reset` onto the physical `Numpad0` key SPECIFICALLY so the
     * main-row `0` would stop firing it — "The main-row 0 key MUST NOT fire either reset, in any
     * tier, in any scope" — so a saved `Ctrl+Shift+Alt+0` on some OTHER, unrelated command is not a
     * real collision with `zoom.reset`'s new target at all, and must not block the move. A v11 user
     * who happened to have any command on the main-row `Ctrl+Shift+Alt+0` was wrongly refused the
     * `zoom.reset` upgrade before this fix. `sameBindingToken` (keybindings.ts) no longer folds
     * `Numpad0` onto `'0'`, which is what makes the two compare as genuinely different chords here.
     */
    it('no longer refuses the move over Ctrl+Shift+Alt+0 (main-row) — it is a DIFFERENT chord from the real Numpad0 target', () => {
      const doc = v11Document({ 'search.replaceAll': ['Ctrl+Shift+Alt+0'] });
      const plan = planKeybindingsUpgrade(doc);
      expect(plan.find((l) => l.action === 'zoom.reset')?.value).toEqual(V13['zoom.reset']);
    });

    it('also fires from the v12 source against the real v13 target', () => {
      const doc = v11Document({
        'zoom.reset': ['Ctrl+0', 'Ctrl+Shift+0', 'Ctrl+MiddleClick'],
        'search.replaceAll': ['Ctrl+Shift+Alt+Numpad0'],
      });
      const plan = planKeybindingsUpgrade(doc);
      expect(plan.find((l) => l.action === 'zoom.reset')).toBeUndefined();
    });
  });

  /**
   * Review finding CRITICAL 2: `moving` used to be computed from "saved array matches a guard
   * source" alone, so a row that matched a source but was ITSELF refused (by colliding with
   * something else) was still wrongly treated as vacating its old tokens — letting a DIFFERENT row
   * move onto them and land two commands on the same chord.
   */
  it('a row refused by its own collision does NOT exempt its old tokens from another row’s check (CRITICAL 2)', () => {
    // zoom.reset (v11 source, old value includes Ctrl+MiddleClick) is blocked from moving because
    // some fixed, untouched action already owns its real v13 target.
    // panel.zoomReset (v11 source too) would gain Ctrl+MiddleClick in ITS v13 value — but zoom.reset
    // never actually let go of it, so panel.zoomReset's move must ALSO be refused.
    const doc = v11Document({ 'search.replaceAll': ['Ctrl+Shift+Alt+Numpad0'] });
    const plan = planKeybindingsUpgrade(doc);
    expect(plan.find((l) => l.action === 'zoom.reset'), 'zoom.reset must be blocked').toBeUndefined();
    expect(
      plan.find((l) => l.action === 'panel.zoomReset'),
      'panel.zoomReset must be blocked too — zoom.reset never vacated Ctrl+MiddleClick',
    ).toBeUndefined();
  });

  /**
   * Review finding IMPORTANT 3 (FR-092, contract §4): a user's bare `Ctrl+E` and the new two-stroke
   * `Ctrl+E W` can never coexist — pressing `Ctrl+E` would be ambiguous between "fire the user's
   * command now" and "wait for the second stroke". The row must be refused, not applied half-broken.
   */
  it('refuses editor.toggleWordWrap’s move when a user already owns the bare first stroke Ctrl+E (IMPORTANT 3)', () => {
    const doc = v11Document({ 'editor.save': ['Ctrl+E'] }); // editor.save is live in the editor
    const plan = planKeybindingsUpgrade(doc);
    expect(plan.find((l) => l.action === 'editor.toggleWordWrap')).toBeUndefined();
  });

  /**
   * Review finding IMPORTANT 10 (FR-108): the collision check must be SCOPE-AWARE, the same rule
   * `chordCollisions` already applies to the live resolver. `editor.toggleWordWrap` is EDITOR_ONLY;
   * a terminal-only action rebound onto its first stroke shares no scope with it, so it must not
   * block the move.
   */
  it('does not refuse a row over a chord bound in a DISJOINT scope (IMPORTANT 10)', () => {
    // `terminal.redraw` is TERMINAL_ONLY; `editor.toggleWordWrap` is EDITOR_ONLY. No overlap.
    const doc = v11Document({ 'terminal.redraw': ['Ctrl+E'] });
    const plan = planKeybindingsUpgrade(doc);
    expect(plan.find((l) => l.action === 'editor.toggleWordWrap')?.value).toEqual(['Ctrl+E,W']); // FR-124
  });
});
