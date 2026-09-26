/**
 * 026 / #165 — the shipped pane toggles must not sit on chords a shell already owns.
 *
 * `view.toggleProjects` ships on `Ctrl+B` (tmux's prefix key) and `view.toggleExplorer` on
 * `Ctrl+N` (readline's next-history). Both are rebindable, but the shipped default is what
 * almost everyone runs, and both are in the RESERVED set — so even once a focused terminal
 * passes non-reserved chords through to the shell (#164), these two would still be stolen from
 * it. Moving them into the `Ctrl+Alt` family throng already uses for `panel.zoom*` / `focus.*`
 * is what lets them stay globally reachable without taking a chord the shell needs.
 *
 * RED until the defaults move. Deliberately asserted against the SHIPPED record rather than a
 * resolved user config: this is a claim about what throng ships, not about what a user chose.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
  resolveAction,
  shippedBindingsFor,
} from '../../src/config/keybindings.js';

/** Chords a terminal user presses constantly and that no global default may claim. */
const SHELL_OWNED = ['Ctrl+B', 'Ctrl+N'] as const;

/*
 * RE-PINNED by 046 iterate round 1 (T097, FR-102 *changes* row): the pane toggles move again, to
 * the Ctrl+Shift+Alt navigation tier — one modifier family up from the Ctrl+Alt family this file
 * used to pin, for the same "stay globally reachable, take nothing the shell needs" reason.
 *
 * RE-PINNED by 046 iterate round 3 (T172, FR-117): same tier, new letters — J and K toggle the left
 * and right panes, because B and N now focus Projects and the workspace. B and N here would name
 * the wrong command, so the owner assertions below pin J / K and the new owners of B / N.
 */
describe('pane toggle shipped defaults (026 / #165)', () => {
  it('ships the pane toggles on the Ctrl+Shift+Alt navigation tier', () => {
    const { bindings } = shippedBindingsFor('windows');
    expect(bindings['view.toggleProjects']).toEqual(['Ctrl+Shift+Alt+J']);
    expect(bindings['view.toggleExplorer']).toEqual(['Ctrl+Shift+Alt+K']);
  });

  it('leaves Ctrl+B and Ctrl+N unclaimed by EVERY shipped platform set', () => {
    // Stated over the whole record, not just Windows, so a macOS/Linux set added later
    // cannot quietly reintroduce the collision this issue exists to remove.
    for (const [platform, set] of Object.entries(SHIPPED_KEYBINDINGS_BY_PLATFORM)) {
      const claimed = Object.entries(set?.bindings ?? {}).flatMap(([action, chords]) =>
        chords.filter((c) => (SHELL_OWNED as readonly string[]).includes(c)).map((c) => `${platform}:${action}=${c}`),
      );
      expect(claimed).toEqual([]);
    }
  });

  it('resolves the new chords to the pane toggles, and the old ones to nothing', () => {
    const kb = DEFAULT_KEYBINDINGS;
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'j' }, 'editor')).toBe(
      'view.toggleProjects',
    );
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'k' }, 'editor')).toBe(
      'view.toggleExplorer',
    );
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'b' }, 'editor')).toBeNull();
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'n' }, 'editor')).toBeNull();
    expect(resolveAction(kb, { ctrl: true, key: 'b' }, 'editor')).toBeNull();
    expect(resolveAction(kb, { ctrl: true, key: 'n' }, 'editor')).toBeNull();
  });

  it('does not collide with an existing binding in any scope', () => {
    const { bindings } = shippedBindingsFor('windows');
    const owners = (chord: string): string[] =>
      Object.entries(bindings)
        .filter(([, chords]) => chords.includes(chord))
        .map(([action]) => action);
    expect(owners('Ctrl+Shift+Alt+J')).toEqual(['view.toggleProjects']);
    expect(owners('Ctrl+Shift+Alt+K')).toEqual(['view.toggleExplorer']);
    // B and N changed owner in the same change (FR-117), so neither is shared.
    expect(owners('Ctrl+Shift+Alt+B')).toEqual(['focus.projects']);
    expect(owners('Ctrl+Shift+Alt+N')).toEqual(['focus.workspace']);
  });
});
