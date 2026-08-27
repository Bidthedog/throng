/**
 * 041 US4 (#314) — THE KEYBOARD ROUTE TO A NOTICE.
 *
 * 030 FR-060a states the gap in its own words and defers it here by name: a notice's affected-panel
 * list IS a tab stop, but "no binding focuses a notice, nothing autofocuses one, and no cue indicates
 * the list is a tab stop." So reaching it means tabbing forward through the whole application until
 * focus happens to land there — an unbounded number of presses for something that exists to be read.
 *
 * ══ WHY THE SCOPE IS `EVERYWHERE` (FR-020a) ══
 *
 * A notice can be raised while any surface has focus, INCLUDING a terminal — and a terminal is where
 * it is most likely to appear, because that is where long-running things fail. A narrower scope would
 * leave the notice unreachable in exactly the case that motivates it. The whole `focus.*` family is
 * already scoped this way, so this needs no new concept.
 *
 * ══ AND WHY NOTICES ARE NOT IN THE CYCLE RING (FR-020c) ══
 *
 * `focus.cycle` is pressed constantly and a notice is transient. A notice that timed out mid-cycle
 * would change what the NEXT press does, which makes a navigation aid unpredictable in order to add
 * a destination the user did not ask for.
 */
import { describe, expect, it } from 'vitest';
import { COMMAND_SCOPES, DEFAULT_KEYBINDINGS } from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

describe('focus.notice (041 FR-020)', () => {
  it('is registered as a command', () => {
    expect(COMMAND_SCOPES['focus.notice']).toBeDefined();
  });

  it('is scoped EVERYWHERE, like the rest of the focus family (FR-020a)', () => {
    const scope = COMMAND_SCOPES['focus.notice'];
    expect([...scope].sort()).toEqual(['editor', 'explorer', 'terminal']);
    // Stated as an equality with a SIBLING rather than a literal list, so the two cannot drift: if
    // the family's scope ever widens, this widens with it or fails.
    expect([...scope].sort()).toEqual([...COMMAND_SCOPES['focus.cycle']].sort());
  });

  it('defaults to Ctrl+Alt+M (FR-020b)', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['focus.notice']).toEqual(['Ctrl+Alt+M']);
  });

  it('takes a chord nothing else claims', () => {
    // The reason `Ctrl+Alt+M` was chosen: unbound, and inside the `Ctrl+Alt` family throng already
    // owns — so it displaces no hosted line-editor binding and needs no constitutional exception.
    const taken = Object.entries(DEFAULT_KEYBINDINGS.bindings)
      .filter(([command]) => command !== 'focus.notice')
      .flatMap(([, chords]) => chords);
    expect(taken).not.toContain('Ctrl+Alt+M');
  });

  it('appears in the Preferences metadata, so it is discoverable and rebindable (FR-027)', () => {
    const entry = KEYBINDINGS_METADATA.find((m) => m.key === 'focus.notice');
    expect(entry, 'a binding absent from the metadata cannot be found or changed by a user').toBeDefined();
    expect(entry!.group).toBe('Focus & Zoom');
  });

  it('is NOT in the focus-cycle ring (FR-020c)', () => {
    // The ring is `focus.cycle`/`focus.cycleBack` over PANELS. This asserts the command set stays
    // disjoint from them — a notice joining the ring would make a constant navigation aid depend on
    // whether something transient happened to be on screen.
    expect(DEFAULT_KEYBINDINGS.bindings['focus.cycle']).not.toContain('Ctrl+Alt+M');
    expect(DEFAULT_KEYBINDINGS.bindings['focus.cycleBack']).not.toContain('Ctrl+Alt+M');
  });
});
