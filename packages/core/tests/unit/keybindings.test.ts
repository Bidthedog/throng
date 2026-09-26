import { describe, it, expect } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  eventToToken,
  normalizeToken,
  parseKeybindings,
  resetBindingValue,
  resolveAction,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
  type ActionId,
} from '@throng/core';

describe('Keybindings resolver (FR-033)', () => {
  it('builds canonical tokens from events', () => {
    expect(eventToToken({ ctrl: true, key: '=' })).toBe('Ctrl+=');
    expect(eventToToken({ ctrl: true, key: '+' })).toBe('Ctrl++');
    expect(eventToToken({ key: 'F11' })).toBe('F11');
    expect(eventToToken({ ctrl: true, gesture: 'WheelUp' })).toBe('Ctrl+WheelUp');
    expect(eventToToken({})).toBeNull();
  });

  /*
   * RE-PINNED by 046 iterate round 1 (T097, FR-102 *changes* row): the window zoom trio and the
   * pane toggles both move to the Ctrl+Shift+Alt navigation tier, and the plain Ctrl+=/Ctrl+-/
   * Ctrl+0 zoom chords are retired (they resolve to NOTHING now, not to zoom.in/out/reset).
   */
  it('resolves the default keyboard shortcuts', () => {
    const kb = DEFAULT_KEYBINDINGS;
    // The FR-105 same-binding fold (an unshifted "=" press also firing the "+" chord) is a
    // RENDERER-level concern (`chordCandidates`, out of core's scope) — core ships and resolves
    // exactly the ONE canonical token, `Ctrl+Shift+Alt++`.
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: '+' }, 'editor')).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: '-' }, 'editor')).toBe('zoom.out');
    // 046 iterate round 2 (FR-114) — the maintainer's own words, mid-build: "The 'Zoom Reset' key
    // bindings need to use the numpad zero, NOT the 0 key." `core`'s `resolveAction` matches on the
    // event's literal `key`, with no physical-code awareness (that lives in the renderer's
    // `chordCandidates`), so the event handed here must itself carry the stored key segment.
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'Numpad0' }, 'editor')).toBe('zoom.reset');
    // The plain, pre-round chords are unbound now.
    expect(resolveAction(kb, { ctrl: true, key: '=' }, 'editor')).toBeNull();
    expect(resolveAction(kb, { ctrl: true, key: '-' }, 'editor')).toBeNull();
    expect(resolveAction(kb, { ctrl: true, key: '0' }, 'editor')).toBeNull();
    // The main-row 0 (Digit0's produced key) no longer resets either zoom — only Numpad0 does.
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: '0' }, 'editor')).not.toBe('zoom.reset');
    expect(resolveAction(kb, { key: 'F11' }, 'editor')).toBe('view.fullscreen');
    // Pane toggles — letters match case-insensitively (DOM keydown reports "b"/"n").
    // 046: these ship on Ctrl+SHIFT+ALT+J / Ctrl+SHIFT+ALT+K (iterate round 3, FR-117; B and N
    // now focus Projects and the workspace). Ctrl+B and Ctrl+N belong to the shell (tmux's
    // prefix, readline's next-history) and are deliberately left unclaimed.
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'j' }, 'editor')).toBe(
      'view.toggleProjects',
    );
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'J' }, 'editor')).toBe(
      'view.toggleProjects',
    );
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'k' }, 'editor')).toBe(
      'view.toggleExplorer',
    );
  });

  it('normalises only a lone-letter key segment', () => {
    expect(normalizeToken('Ctrl+b')).toBe('Ctrl+B');
    expect(normalizeToken('b')).toBe('B');
    expect(normalizeToken('Ctrl++')).toBe('Ctrl++'); // the "+" key is untouched
    expect(normalizeToken('Ctrl+0')).toBe('Ctrl+0'); // digits untouched
    expect(normalizeToken('F11')).toBe('F11'); // multi-char keys untouched
  });

  it('matches a custom binding whose letter is written in either case', () => {
    const custom = parseKeybindings({ bindings: { 'view.toggleProjects': ['Ctrl+x'] } });
    expect(resolveAction(custom, { ctrl: true, key: 'x' }, 'editor')).toBe('view.toggleProjects');
    expect(resolveAction(custom, { ctrl: true, key: 'X' }, 'editor')).toBe('view.toggleProjects');
  });

  // RE-PINNED by 046 iterate round 1 (T097, FR-102/FR-106): the mouse-zoom gestures move from the
  // window zoom to the per-panel zoom — the window zoom now carries no gesture at all.
  it('resolves the mouse-zoom gestures to the panel zoom, not the window zoom', () => {
    const kb = DEFAULT_KEYBINDINGS;
    expect(resolveAction(kb, { ctrl: true, gesture: 'WheelUp' }, 'editor')).toBe('panel.zoomIn');
    expect(resolveAction(kb, { ctrl: true, gesture: 'WheelDown' }, 'editor')).toBe('panel.zoomOut');
    expect(resolveAction(kb, { ctrl: true, gesture: 'MiddleClick' }, 'editor')).toBe('panel.zoomReset');
  });

  it('returns null for an unbound event', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'a' }, 'editor')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, key: 'q' }, 'editor')).toBeNull();
  });

  /*
   * RE-PINNED by 046 iterate round 1 (T097, FR-102 *changes* row): the per-type (panel) zoom stays
   * on the Ctrl+Alt family unchanged, but the GLOBAL zoom and the directional focus moves both
   * move up to Ctrl+Shift+Alt, so they no longer share a modifier prefix with the panel zoom the
   * way "distinct" used to mean here.
   */
  it('resolves the 012 per-type zoom + move-focus chords the KeybindingsHandler dispatches', () => {
    const kb = DEFAULT_KEYBINDINGS;
    // Per-type zoom (Ctrl+Alt family) — unchanged, still distinct from the global zoom. FR-105
    // ships exactly ONE keyboard chord now (the "=" same-binding fold is a renderer concern).
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '+' }, 'editor')).toBe('panel.zoomIn');
    expect(resolveAction(kb, { ctrl: true, alt: true, key: '-' }, 'editor')).toBe('panel.zoomOut');
    // 046 iterate round 2 (FR-114) — panel.zoomReset's key segment is Numpad0 now, not the main-row 0.
    expect(resolveAction(kb, { ctrl: true, alt: true, key: 'Numpad0' }, 'editor')).toBe('panel.zoomReset');
    // …and the global zoom chords now resolve to the global actions on the Ctrl+Shift+Alt tier.
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: '+' }, 'editor')).toBe('zoom.in');
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'Numpad0' }, 'editor')).toBe('zoom.reset');

    // Directional move-focus — arrow keys report `Arrow*`, matching the defaults.
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'ArrowLeft' }, 'editor')).toBe(
      'focus.left',
    );
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'ArrowRight' }, 'editor')).toBe(
      'focus.right',
    );
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'ArrowUp' }, 'editor')).toBe(
      'focus.up',
    );
    expect(resolveAction(kb, { ctrl: true, shift: true, alt: true, key: 'ArrowDown' }, 'editor')).toBe(
      'focus.down',
    );

    // Cycle: unchanged — the backtick key is normalised (renderer `chordKey`) so Shift is what
    // distinguishes forward from back — portable across layouts (UK Shift+backtick is
    // ¬, not ~), unlike a produced-character token.
    expect(resolveAction(kb, { ctrl: true, key: '`' }, 'editor')).toBe('focus.cycle');
    expect(resolveAction(kb, { ctrl: true, shift: true, key: '`' }, 'editor')).toBe('focus.cycleBack');
  });

  it('ROUND-TRIPS every shipped chord through normalizeToken(eventToToken(...)) — F2', () => {
    // The bug this catches, and it is not hypothetical: a chord written `Alt+Shift+ArrowUp`
    // never matches, because `eventToToken` emits modifiers in the canonical order
    // Ctrl+Shift+Alt+key. The command would be shipped, listed in the editor, rebindable —
    // and simply dead. Every shipped chord must be writable as an event and come back
    // identical, which is exactly what dispatch requires of it.
    const parseToken = (token: string): { ev: Parameters<typeof eventToToken>[0] } | null => {
      const parts = token.split('+');
      // A trailing "+" key ("Ctrl++") splits into an empty tail — put it back.
      const key = parts[parts.length - 1] === '' ? '+' : parts[parts.length - 1];
      const mods = new Set(parts.slice(0, parts[parts.length - 1] === '' ? -2 : -1));
      const gesture = ['WheelUp', 'WheelDown', 'MiddleClick'].includes(key)
        ? (key as 'WheelUp' | 'WheelDown' | 'MiddleClick')
        : undefined;
      return {
        ev: {
          ...(gesture ? { gesture } : { key }),
          ctrl: mods.has('Ctrl'),
          shift: mods.has('Shift'),
          alt: mods.has('Alt'),
        },
      };
    };

    for (const [action, tokens] of Object.entries(DEFAULT_KEYBINDINGS.bindings)) {
      for (const token of tokens) {
        // A two-stroke token (FR-091/FR-092) is not a single `eventToToken` event by construction —
        // it round-trips through `parseTwoStroke`/`isValidTwoStrokeToken` instead
        // (keybindings-two-stroke.test.ts), never through this single-event helper.
        if (token.includes(' ')) continue;
        const parsed = parseToken(token);
        const rebuilt = eventToToken(parsed!.ev);
        expect(
          normalizeToken(rebuilt ?? ''),
          `"${action}" ships "${token}", which an event can never produce — the chord is dead`,
        ).toBe(normalizeToken(token));
      }
    }
  });

  /**
   * 031 / FR-032a–c (T064, T043a).
   *
   * FR-032c *claims* `Ctrl+Alt+T` is Principle IV-clean. A claim in prose cannot fail, so a later
   * rebinding could quietly move the tab picker onto `Ctrl+R` or `Ctrl+S` and nothing would object.
   * This asserts it instead: the shipped chord, and its distance from both constitutional tiers.
   */
  describe('tabs.openPicker (031, FR-032a–c)', () => {
    /** Constitution IV, reserved tier — no command may take these in a terminal-live scope. */
    const RESERVED = ['C', 'D', 'Z', 'A', 'E', 'W', 'U', 'K', 'R', 'L', 'Q'].map((k) => `Ctrl+${k}`);
    /** Constitution IV as of v4.4.0 — the exhaustive list of recorded shadowable exceptions. */
    const SHADOWABLE_EXCEPTIONS = ['Ctrl+F', 'Ctrl+H', 'Ctrl+S', 'Ctrl+F5'];

    // RE-PINNED by 046 iterate round 1 (T097, FR-102 *changes* row): the tab picker moves from
    // Ctrl+Alt+T to the Ctrl+Shift+Alt navigation tier, alongside every other window command.
    it('ships bound to Ctrl+Shift+Alt+T', () => {
      expect(DEFAULT_KEYBINDINGS.bindings['tabs.openPicker']).toEqual(['Ctrl+Shift+Alt+T']);
    });

    it('is live in every scope, so the picker opens from anywhere (FR-032a)', () => {
      const ev = { ctrl: true, shift: true, alt: true, key: 't' };
      expect(COMMAND_SCOPES['tabs.openPicker']).toBeDefined();
      for (const scope of ['editor', 'terminal', 'explorer'] as const) {
        expect(resolveAction(DEFAULT_KEYBINDINGS, ev, scope), scope).toBe('tabs.openPicker');
      }
    });

    it('takes no reserved key and no recorded shadowable exception (FR-032c)', () => {
      const tokens = DEFAULT_KEYBINDINGS.bindings['tabs.openPicker'] ?? [];
      // Without this the loop below is vacuous, and an UNBOUND command would pass the tier check.
      expect(tokens.length, 'tabs.openPicker ships no chord at all').toBeGreaterThan(0);
      for (const token of tokens) {
        const chord = normalizeToken(token);
        expect(RESERVED, `${chord} is in the RESERVED tier — Principle IV forbids it outright`)
          .not.toContain(chord);
        expect(
          SHADOWABLE_EXCEPTIONS,
          `${chord} is a recorded shadowable exception — taking it needs its own justification`,
        ).not.toContain(chord);
      }
    });
  });

  /**
   * 046 T030 (US2, FR-020/021/022/023). The four side-pane commands each ship a Windows default
   * chord, live EVERYWHERE (data-model §4, R3), and — per FR-020 — take neither a RESERVED nor a
   * SHADOWABLE chord, so the recorded-exception list stays at exactly four entries.
   */
  describe('project & focus pane commands (US2, FR-020/021/022/023)', () => {
    /** Constitution IV, reserved tier — no command may take these in a terminal-live scope. */
    const RESERVED = ['C', 'D', 'Z', 'A', 'E', 'W', 'U', 'K', 'R', 'L', 'Q'].map((k) => `Ctrl+${k}`);
    /** Constitution IV's shadowable tier, plus Ctrl+F5 (a function key, in neither tier) — the
     *  chords a terminal-live command may only take as a RECORDED exception. */
    const SHADOWABLE_TIER = ['Ctrl+B', 'Ctrl+F', 'Ctrl+N', 'Ctrl+P', 'Ctrl+H', 'Ctrl+S'];

    const IDS: ActionId[] = ['project.next', 'project.previous', 'focus.explorer', 'focus.projects'];
    // RE-PINNED by 046 iterate round 1 (T097, FR-102 *changes* row): all four move from the
    // Ctrl+Alt family to the Ctrl+Shift+Alt navigation tier. RE-PINNED again by 046 iterate
    // round 3 (T172, FR-117): the two focus commands move to M and B, the left-to-right B / N / M row.
    const DEFAULT_CHORD: Partial<Record<ActionId, string>> = {
      'project.next': 'Ctrl+Shift+Alt+PageDown',
      'project.previous': 'Ctrl+Shift+Alt+PageUp',
      'focus.explorer': 'Ctrl+Shift+Alt+M',
      'focus.projects': 'Ctrl+Shift+Alt+B',
    };

    it('each ships its Windows default chord', () => {
      for (const [action, chord] of Object.entries(DEFAULT_CHORD)) {
        expect(DEFAULT_KEYBINDINGS.bindings[action], action).toEqual([chord]);
      }
    });

    it('each is scoped EVERYWHERE — live in every DispatchScope, including projects', () => {
      const scopes = ['editor', 'terminal', 'explorer', 'findInFiles', 'preview', 'projects'] as const;
      for (const action of IDS) {
        const set = COMMAND_SCOPES[action];
        expect(set, action).toBeDefined();
        for (const scope of scopes) expect(set!.has(scope), `${action} in ${scope}`).toBe(true);
      }
    });

    it('takes no reserved key and no recorded shadowable exception (FR-020)', () => {
      // Read the LIVE chord off DEFAULT_KEYBINDINGS rather than the DEFAULT_CHORD literal above: a
      // rebind of a shipped default that drifted onto a reserved chord must fail HERE, not only at
      // "ships its Windows default chord" — which pins the value, not its tier membership.
      for (const action of IDS) {
        for (const token of DEFAULT_KEYBINDINGS.bindings[action] ?? []) {
          const normalised = normalizeToken(token);
          expect(RESERVED, `${action}'s ${normalised} is in the RESERVED tier`).not.toContain(normalised);
          expect(
            SHADOWABLE_TIER,
            `${action}'s ${normalised} is in the shadowable tier and needs a recorded exception`,
          ).not.toContain(normalised);
        }
      }
    });

    it('the recorded-exception list stays at exactly four entries (FR-020)', () => {
      // The REAL exception source: every terminal-live chord, across the WHOLE shipped record (not
      // just these four ids), that falls in the shadowable tier or is Ctrl+F5 (terminal.redraw's
      // function-key exception, in neither tier). A literal array of length 4 asserted against
      // itself can never fail; this discovers the set from the registry, so a fifth chord landing
      // there — from any command — fails the assertion below.
      const discovered = new Set<string>();
      for (const set of Object.values(SHIPPED_KEYBINDINGS_BY_PLATFORM)) {
        for (const [action, tokens] of Object.entries(set?.bindings ?? {})) {
          if (!COMMAND_SCOPES[action as ActionId]?.has('terminal')) continue;
          for (const token of tokens) {
            const chord = normalizeToken(token);
            if (SHADOWABLE_TIER.includes(chord) || chord === 'Ctrl+F5') discovered.add(chord);
          }
        }
      }
      expect([...discovered].sort()).toEqual(['Ctrl+F', 'Ctrl+F5', 'Ctrl+H', 'Ctrl+S']);
    });
  });

  /**
   * RE-PINNED by 046 iterate round 1 (T097, FR-102/FR-107): #390's `Ctrl+Shift+0` is RETIRED, not
   * kept — the whole window zoom trio, `zoom.reset` included, moves to a single Ctrl+Shift+Alt
   * chord and drops its gesture (the gesture moves to `panel.zoomReset`, FR-106). `panel.zoomReset`
   * (the per-PANEL zoom, Ctrl+Alt family) keeps its own chord and now ALSO carries the
   * middle-click gesture.
   *
   * RE-PINNED AGAIN by 046 iterate round 2 (FR-114) — the maintainer's own words, mid-build: "The
   * 'Zoom Reset' key bindings need to use the numpad zero, NOT the 0 key." Both chords' key segment
   * moves from the main-row `0` to `Numpad0`; the main-row `0` key no longer resets either zoom.
   */
  describe('zoom.reset — a single Ctrl+Shift+Alt+Numpad0 chord, no gesture (FR-102, FR-107, FR-114)', () => {
    // Re-pinned for 046 FR-127 (iterate round 7): panel.zoomReset also ships the main-row Ctrl+Alt+0.
    it('ships exactly Ctrl+Shift+Alt+Numpad0, and panel.zoomReset ships Ctrl+Alt+Numpad0, Ctrl+Alt+0 and the middle-click gesture', () => {
      expect(DEFAULT_KEYBINDINGS.bindings['zoom.reset']).toEqual(['Ctrl+Shift+Alt+Numpad0']);
      expect(DEFAULT_KEYBINDINGS.bindings['panel.zoomReset']).toEqual([
        'Ctrl+Alt+Numpad0',
        'Ctrl+Alt+0',
        'Ctrl+MiddleClick',
      ]);
    });

    it('the retired Ctrl+Shift+0 and Ctrl+0 chords resolve to nothing', () => {
      expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, shift: true, key: '0' }, 'editor')).toBeNull();
      expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, key: '0' }, 'editor')).toBeNull();
    });

    // Re-pinned for 046 FR-127: the main-row 0 still resets no WINDOW zoom (FR-114 stands for
    // zoom.reset), but Ctrl+Alt+0 now resets the panel.
    it('the main-row Ctrl+Shift+Alt+0 (Digit0) resets no window zoom; Ctrl+Alt+0 resets the panel (FR-114, FR-127)', () => {
      expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, shift: true, alt: true, key: '0' }, 'editor')).not.toBe('zoom.reset');
      expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, alt: true, key: '0' }, 'editor')).toBe('panel.zoomReset');
    });

    it('a user override of zoom.reset resolves to exactly the user’s chord (026 FR-030)', () => {
      const custom = parseKeybindings({ bindings: { 'zoom.reset': ['Ctrl+9'] } });
      expect(custom.bindings['zoom.reset']).toEqual(['Ctrl+9']);
      expect(
        resolveAction(custom, { ctrl: true, shift: true, alt: true, key: '0' }, 'editor'),
      ).not.toBe('zoom.reset');
      expect(resolveAction(custom, { ctrl: true, key: '9' }, 'editor')).toBe('zoom.reset');
    });

    it('resetting the binding restores the single default chord', () => {
      const overridden = parseKeybindings({ bindings: { 'zoom.reset': ['Ctrl+9'] } });
      const restored = resetBindingValue(overridden, 'zoom.reset');
      expect(restored?.bindings['zoom.reset']).toEqual(['Ctrl+Shift+Alt+Numpad0']);
    });
  });

  it('parses defaults and merges custom bindings', () => {
    expect(parseKeybindings(undefined)).toEqual(DEFAULT_KEYBINDINGS);
    const custom = parseKeybindings({ bindings: { 'zoom.in': ['Ctrl+Shift+='] } });
    expect(custom.bindings['zoom.in']).toEqual(['Ctrl+Shift+=']);
    // other actions retained from defaults
    expect(custom.bindings['view.fullscreen']).toEqual(['F11']);
    expect(resolveAction(custom, { ctrl: true, shift: true, key: '=' }, 'editor')).toBe('zoom.in');
  });
});
