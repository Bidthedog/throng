import { describe, it, expect } from 'vitest';
import {
  V11_ZOOM_RESET_BINDING,
  buildShippedDefaults,
  planKeybindingsUpgrade,
  applyKeybindingsUpgrade,
} from '../../src/config/shipped-defaults.js';

/**
 * 046 US3 (FR-025) — an EXISTING install's `zoom.reset` never receives Ctrl+Shift+0.
 *
 * ══ THE BUG, PROVEN AT THE CHEAPEST LAYER ══
 *
 * `ShippedDefaultsService.upgrade()` (packages/ui/src/main/shipped-defaults-service.ts) rewrites
 * theme files and a small enumerated set of guarded SETTINGS leaves on every version bump. It never
 * touches `keybindings.json` — there is no `planKeybindingsUpgrade` counterpart to
 * `planSettingsUpgrade`/`planThemeUpgrade` for it to call. And `parseKeybindings`'s per-read fill
 * only helps an action MISSING from the saved file; `zoom.reset` was seeded at first run (`seed()`
 * writes every shipped binding, including it) and is emphatically not missing, so an existing
 * install's saved `['Ctrl+0', 'Ctrl+MiddleClick']` is preserved forever, byte for byte, and the
 * user who upgrades and presses Ctrl+Shift+0 gets nothing.
 *
 * ══ THE FIX, AND WHERE IT DIFFERS FROM 026 FR-030's PRECEDENT ══
 *
 * The spec's own Edge Case ("A user who rebound `zoom.reset` keeps exactly their binding.
 * Ctrl+Shift+0 is added only to the shipped defaults (026 FR-030)") cites the pane-toggle chord
 * MOVE (`Ctrl+B` → `Ctrl+Alt+B`), which deliberately never rewrites an existing install's file at
 * all — a saved `Ctrl+B` is indistinguishable from "never touched" and "chose it on purpose", so
 * throng left it alone permanently and only fresh installs get the new default.
 *
 * `zoom.reset` is not that shape: it is an ADDITION to an existing action's chord LIST, not a
 * single value moving, so the ambiguity 026 accepted does not apply here in the same way. This
 * follows 043's LATER, narrower precedent instead — {@link V6_SEARCH_IN_FILES_SETTINGS}'s guarded
 * settings-leaf rewrite (`planSettingsUpgrade`): a saved value that is still BYTE/SET-IDENTICAL to
 * exactly what an earlier version shipped is strong evidence of "never customised", so — and only
 * then — the upgrade rewrites it. Order-insensitive because a binding array is a SET of alternative
 * chords, not an ordered list like `explorer.excludeGlobs`.
 */

describe('the guarded `zoom.reset` keybinding upgrade (FR-025, R28-style precedent)', () => {
  it('the v11 binding and the v12 shipped one differ, or every case below is vacuous', () => {
    const shipped = buildShippedDefaults().keybindings.bindings['zoom.reset'];
    expect([...shipped].sort()).not.toEqual([...V11_ZOOM_RESET_BINDING].sort());
  });

  it('rewrites zoom.reset when the saved value still exactly equals what v11 shipped (order-insensitive)', () => {
    // Reversed order on purpose — the guard is a SET comparison, not a list comparison.
    const doc = { version: 1, bindings: { 'zoom.reset': ['Ctrl+MiddleClick', 'Ctrl+0'] } };
    const plan = planKeybindingsUpgrade(doc);
    expect(plan).toEqual([
      { action: 'zoom.reset', value: buildShippedDefaults().keybindings.bindings['zoom.reset'] },
    ]);
  });

  it('plans nothing when the user rebound zoom.reset to something else entirely', () => {
    const doc = { version: 1, bindings: { 'zoom.reset': ['Ctrl+Shift+R'] } };
    expect(planKeybindingsUpgrade(doc)).toEqual([]);
  });

  it('plans nothing when the saved array has an extra chord beyond the v11 pair', () => {
    // A superset is still a customisation: the user added something, even if they kept both v11
    // chords too. Matching it anyway would fold their addition into whatever v12 ships.
    const doc = { version: 1, bindings: { 'zoom.reset': ['Ctrl+0', 'Ctrl+MiddleClick', 'F9'] } };
    expect(planKeybindingsUpgrade(doc)).toEqual([]);
  });

  it('plans nothing when the saved array is missing one of the v11 pair', () => {
    const doc = { version: 1, bindings: { 'zoom.reset': ['Ctrl+0'] } };
    expect(planKeybindingsUpgrade(doc)).toEqual([]);
  });

  it('plans nothing when zoom.reset is absent — the ordinary per-read fill already covers that', () => {
    expect(planKeybindingsUpgrade({ version: 1, bindings: {} })).toEqual([]);
    expect(planKeybindingsUpgrade({ version: 1 })).toEqual([]);
    expect(planKeybindingsUpgrade({})).toEqual([]);
    expect(planKeybindingsUpgrade(null)).toEqual([]);
  });

  it('is idempotent — a second run plans nothing, because the rewritten value no longer equals v11', () => {
    const before = { version: 1, bindings: { 'zoom.reset': ['Ctrl+0', 'Ctrl+MiddleClick'] } };
    const after = applyKeybindingsUpgrade(before);
    expect(planKeybindingsUpgrade(after)).toEqual([]);
  });

  it('leaves every sibling binding, and the version, exactly as it found them', () => {
    const before = {
      version: 3,
      bindings: {
        'zoom.reset': ['Ctrl+0', 'Ctrl+MiddleClick'],
        'file.rename': ['F6'], // the user's own rebind of something unrelated
      },
    };
    const after = applyKeybindingsUpgrade(before) as {
      version: number;
      bindings: Record<string, string[]>;
    };
    expect(after.version).toBe(3);
    expect(after.bindings['file.rename']).toEqual(['F6']);
    expect(after.bindings['zoom.reset']).toEqual(
      buildShippedDefaults().keybindings.bindings['zoom.reset'],
    );
    // `applyKeybindingsUpgrade` is handed the RAW document and must not mutate it.
    expect(before.bindings['zoom.reset']).toEqual(['Ctrl+0', 'Ctrl+MiddleClick']);
  });

  it('returns the input unchanged (by value) when nothing is owed', () => {
    const doc = { version: 1, bindings: { 'zoom.reset': ['Ctrl+Shift+R'] } };
    expect(applyKeybindingsUpgrade(doc)).toEqual(doc);
  });

  /**
   * Review finding on 32fd53ed, RE-PINNED by 046 iterate round 1's fix round (CRITICAL 1): this
   * described the collision guard while `zoom.reset`'s intended v12 target was `Ctrl+Shift+0` —
   * `resolveKeydown` tries the physical candidate first, so adding `Ctrl+Shift+0` while another
   * action already held it (or its pre-046 produced spelling `Ctrl+Shift+)`) would silently steal
   * the key. FR-102/FR-107 then moved the round's REAL v13 target to `Ctrl+Shift+Alt+0`, and 046
   * iterate round 2 (FR-114) moved it AGAIN to `Ctrl+Shift+Alt+Numpad0` — a chord none of those
   * three tokens can ever produce a physical collision with — so `zoom.reset` now goes through the
   * SAME generic, real-target, scope-aware collision check as every other FR-108 row
   * (`shipped-defaults-upgrade-v13-keybindings.test.ts` covers that check directly, including the
   * "refuses when the REAL target is already bound" case this block used to approximate with the
   * wrong tokens). What survives here is the negative: the retired tokens no longer have anything to
   * do with what `zoom.reset` is moving to, so they must not block it.
   */
  describe('the retired Ctrl+Shift+0 / Ctrl+Shift+) tokens no longer block the move (they are not the v13 target)', () => {
    it('still adds the v13 chord when another action holds the token Ctrl+Shift+0 (retired, not the target)', () => {
      const doc = {
        version: 1,
        bindings: {
          'zoom.reset': ['Ctrl+0', 'Ctrl+MiddleClick'],
          'editor.saveAs': ['Ctrl+Shift+0'],
        },
      };
      expect(planKeybindingsUpgrade(doc)).toEqual([
        { action: 'zoom.reset', value: buildShippedDefaults().keybindings.bindings['zoom.reset'] },
      ]);
    });

    it('still adds the v13 chord when another action holds the pre-046 produced token Ctrl+Shift+)', () => {
      const doc = {
        version: 1,
        bindings: {
          'zoom.reset': ['Ctrl+0', 'Ctrl+MiddleClick'],
          'editor.saveAs': ['Ctrl+Shift+)'],
        },
      };
      expect(planKeybindingsUpgrade(doc)).toEqual([
        { action: 'zoom.reset', value: buildShippedDefaults().keybindings.bindings['zoom.reset'] },
      ]);
    });

    it('still adds it when no other action claims anything relevant — the guard is not vacuous', () => {
      const doc = {
        version: 1,
        bindings: {
          'zoom.reset': ['Ctrl+0', 'Ctrl+MiddleClick'],
          'editor.saveAs': ['Ctrl+Alt+S'],
        },
      };
      expect(planKeybindingsUpgrade(doc)).toEqual([
        { action: 'zoom.reset', value: buildShippedDefaults().keybindings.bindings['zoom.reset'] },
      ]);
    });

    it('genuinely blocks the move when another action holds the REAL v13 target Ctrl+Shift+Alt+Numpad0', () => {
      const before = {
        version: 1,
        bindings: {
          'zoom.reset': ['Ctrl+0', 'Ctrl+MiddleClick'],
          'editor.saveAs': ['Ctrl+Shift+Alt+Numpad0'],
        },
      };
      const after = applyKeybindingsUpgrade(before) as { bindings: Record<string, string[]> };
      expect(after.bindings['zoom.reset']).toEqual(['Ctrl+0', 'Ctrl+MiddleClick']);
      expect(after.bindings['editor.saveAs']).toEqual(['Ctrl+Shift+Alt+Numpad0']);
    });
  });
});
