/**
 * 046 iterate round 1 — the FR-101 tier guard.
 *
 * Constitution v5.6.0 Principle IV states three tiers for a shipped default: tier 1 (navigation and
 * the application) is `Ctrl+Shift+Alt+<key>`, tier 2 (the active panel or pane) is `Ctrl+Alt+<key>`
 * or `Ctrl+Shift+<key>`, and tier 3 (content) takes at most one modifier. FR-101 requires a unit test
 * that gives every `ActionId` a tier and fails a shipped default outside its tier's pattern, unless
 * that default is on FR-103's exhaustive, maintainer-agreed exception list — held here as DATA, so a
 * new violation fails loudly rather than silently joining an ever-growing list.
 *
 * This EXTENDS the FR-094 guard in place (FR-101 says so): the FR-094 guard was never built, so this
 * is the file that exists now.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  isTwoStrokeToken,
  normalizeToken,
  parseChordStrokes,
  type ActionId,
} from '../../src/config/keybindings.js';

type Tier = 'tier1' | 'tier2' | 'tier3' | 'outside';

/**
 * Every `ActionId`'s tier (FR-101, FR-102's group tables). A `Partial` record, deliberately: the
 * completeness test below iterates the REAL registry and fails on anything missing here, rather than
 * trusting a `Record<ActionId, Tier>` the TypeScript compiler (not vitest, which transpiles only) would
 * enforce silently at a layer this file cannot observe failing.
 */
const ACTION_TIER: Partial<Record<ActionId, Tier>> = {
  // Global and navigation — tier 1.
  'zoom.in': 'tier1',
  'zoom.out': 'tier1',
  'zoom.reset': 'tier1',
  'focus.left': 'tier1',
  'focus.right': 'tier1',
  'focus.up': 'tier1',
  'focus.down': 'tier1',
  'focus.notice': 'tier1',
  'view.toggleProjects': 'tier1',
  'view.toggleExplorer': 'tier1',
  'project.next': 'tier1',
  'project.previous': 'tier1',
  'focus.explorer': 'tier1',
  'focus.projects': 'tier1',
  // 046 iterate round 3 (FR-116) — the route back to the centre, beside its two side-pane siblings.
  'focus.workspace': 'tier1',
  'tabs.openPicker': 'tier1',
  'focus.cycle': 'tier1', // recorded exception (Shift reverses direction)
  'focus.cycleBack': 'tier1', // recorded exception
  'navigate.quickOpen': 'tier1', // recorded exception
  'search.findInFiles': 'tier1', // recorded exception
  'search.replaceInFiles': 'tier1', // recorded exception
  'editor.saveAll': 'tier1', // recorded exception (the Save pair)
  'view.fullscreen': 'tier1', // recorded exception (function key)

  // Panel and pane — tier 2.
  'panel.zoomIn': 'tier2',
  'panel.zoomOut': 'tier2',
  'panel.zoomReset': 'tier2',
  // 048 FR-020 — the split chords: tier-1 first stroke (Ctrl+Shift+Alt+End), multi-stroke.
  'panel.splitDown': 'tier1', // multi-stroke
  'panel.splitUp': 'tier1', // multi-stroke
  'panel.splitRight': 'tier1', // multi-stroke
  'panel.splitLeft': 'tier1', // multi-stroke
  // 048 FR-131 — Destroy Panel: tier-1 shape, and a recorded exception (function key, live in a terminal).
  'panel.destroy': 'tier1', // recorded exception (function key)
  'editor.toggleWordWrap': 'tier2', // recorded exception (multi-stroke, FR-091/FR-092)
  // 047 (research R5) — the six Markdown fold commands, the same multi-stroke exception as word wrap.
  'markdown.toggleSection': 'tier2', // recorded exception (multi-stroke)
  'markdown.toggleAll': 'tier2', // recorded exception (multi-stroke)
  'markdown.collapseSection': 'tier2', // recorded exception (multi-stroke)
  'markdown.expandSection': 'tier2', // recorded exception (multi-stroke)
  'markdown.collapseAll': 'tier2', // recorded exception (multi-stroke)
  'markdown.expandAll': 'tier2', // recorded exception (multi-stroke)
  'terminal.scrollLineUp': 'tier2',
  'terminal.scrollLineDown': 'tier2',
  'editor.saveAs': 'tier2', // recorded exception (the Save pair)
  'search.replaceAll': 'tier2', // recorded exception
  'menu.open': 'tier2', // recorded exception (the Menu key is not a second chord)

  // Content — tier 3.
  'editor.save': 'tier3',
  'editor.cutLine': 'tier3',
  'editor.indentLines': 'tier3',
  'editor.outdentLines': 'tier3',
  'search.find': 'tier3',
  'search.replace': 'tier3',
  'search.replaceCurrent': 'tier3',
  'navigate.gotoLine': 'tier3',
  'preview.goToHeading': 'tier3', // 047 research R7 — shares Ctrl+G with navigate.gotoLine on a disjoint scope
  'navigate.back': 'tier3',
  'navigate.forward': 'tier3',
  'preview.followLink': 'tier3',
  'file.cut': 'tier3',
  'file.copy': 'tier3',
  'file.paste': 'tier3',
  'file.undo': 'tier3',
  'file.redo': 'tier3',
  'terminal.scrollPageUp': 'tier3',
  'terminal.scrollPageDown': 'tier3',
  'terminal.scrollToTop': 'tier3',
  'terminal.scrollToBottom': 'tier3',
  'terminal.redraw': 'tier3',
  'file.delete': 'tier3',
  'search.close': 'tier3',
  'file.rename': 'tier3',
  'search.findNext': 'tier3',
  'search.findPrevious': 'tier3',
  'editor.columnSelectUp': 'tier3', // recorded exception (Shift+Alt)
  'editor.columnSelectDown': 'tier3', // recorded exception
  'editor.columnSelectLeft': 'tier3', // recorded exception
  'editor.columnSelectRight': 'tier3', // recorded exception

  // Outside the tiers — unbound by default.
  'preview.open': 'outside',
  'preview.toggleSyncScroll': 'outside',
};

/**
 * FR-103's exhaustive, maintainer-agreed exception list — every (action, chord) PAIR a tier check
 * must not judge. Review finding MINOR 6: keyed by pair, not by chord alone — a flat chord list
 * would exempt any FUTURE action that happens to ship the same literal token (e.g. some other
 * command shipping `F2`), which is not what FR-103 names. `editor.toggleWordWrap`'s two-stroke
 * chord is handled separately, by action, in the main loop below — it is not listed here.
 */
const TIER_EXCEPTIONS: ReadonlySet<string> = new Set([
  'search.find|Ctrl+F',
  'search.replace|Ctrl+H',
  'editor.save|Ctrl+S',
  'terminal.redraw|Ctrl+F5',
  'navigate.quickOpen|Ctrl+Shift+T',
  'search.findInFiles|Ctrl+Shift+F',
  'search.replaceInFiles|Ctrl+Shift+H',
  'editor.saveAll|Ctrl+Shift+S',
  'editor.saveAs|Ctrl+Alt+S',
  'search.replaceAll|Ctrl+Alt+Enter',
  'file.rename|F2',
  'search.findNext|F3',
  'search.findPrevious|Shift+F3',
  'view.fullscreen|F11',
  'menu.open|Shift+F10',
  'menu.open|ContextMenu',
  'focus.cycle|Ctrl+`',
  'focus.cycleBack|Ctrl+Shift+`',
  'editor.columnSelectUp|Shift+Alt+ArrowUp',
  'editor.columnSelectDown|Shift+Alt+ArrowDown',
  'editor.columnSelectLeft|Shift+Alt+ArrowLeft',
  'editor.columnSelectRight|Shift+Alt+ArrowRight',
]);

/**
 * Every action whose shipped default is a genuinely two-stroke chord (046 FR-091/FR-092; 047
 * research R5) — named rather than inferred from the token's shape, so a FUTURE two-stroke default
 * shipped on some OTHER action outside its tier still fails the tier check (review finding MINOR 6's
 * reasoning, widened from the single-action check this replaces).
 */
const TWO_STROKE_EXEMPT_ACTIONS: ReadonlySet<string> = new Set([
  'editor.toggleWordWrap',
  'markdown.toggleSection',
  'markdown.toggleAll',
  'markdown.collapseSection',
  'markdown.expandSection',
  'markdown.collapseAll',
  'markdown.expandAll',
]);

const GESTURE_NAMES = new Set(['WheelUp', 'WheelDown', 'MiddleClick']);

function isGestureToken(token: string): boolean {
  return GESTURE_NAMES.has(token.split('+').pop() ?? '');
}

// Re-pinned for FR-124: a two-stroke token is `Mods+K1,K2`, so the shape check is core's own
// comma-aware `isTwoStrokeToken` (imported above) — a space test would miss it, a comma test would
// misread `Ctrl+,`.

/** The modifier set a token carries, honouring the "+" key's own literal `+`. */
function modsOf(token: string): Set<string> {
  if (token.endsWith('++')) return new Set(token.slice(0, -2).split('+').filter(Boolean));
  const parts = token.split('+');
  return new Set(parts.slice(0, -1).filter(Boolean));
}

function matchesTier(tier: Tier, token: string): boolean {
  const mods = modsOf(token);
  if (tier === 'tier1') return mods.size === 3 && mods.has('Ctrl') && mods.has('Shift') && mods.has('Alt');
  if (tier === 'tier2') {
    // Exactly {Ctrl, Alt} or {Ctrl, Shift} — a set of size 2 containing Ctrl and one of the other
    // two can never also contain the third, so no separate exclusion of Ctrl+Shift+Alt is needed.
    return mods.size === 2 && mods.has('Ctrl') && (mods.has('Alt') || mods.has('Shift'));
  }
  if (tier === 'tier3') return mods.size <= 1;
  return true; // outside the tiers — no pattern requirement
}

describe('the FR-101 tier guard', () => {
  it('gives every ActionId a tier — no ActionId is missing from ACTION_TIER', () => {
    const missing = (Object.keys(COMMAND_SCOPES) as ActionId[]).filter((a) => !ACTION_TIER[a]);
    expect(missing).toEqual([]);
  });

  it('the shipped set covers every entry in ACTION_TIER, so the mapping is not stale', () => {
    const stale = (Object.keys(ACTION_TIER) as ActionId[]).filter((a) => !(a in COMMAND_SCOPES));
    expect(stale).toEqual([]);
  });

  it('fails a Windows default whose chord is outside its tier pattern, unless FR-103 excepts it', () => {
    const violations: string[] = [];
    for (const [action, tier] of Object.entries(ACTION_TIER) as [ActionId, Tier][]) {
      if (tier === 'outside') continue;
      for (const token of DEFAULT_KEYBINDINGS.bindings[action] ?? []) {
        if (isGestureToken(token)) continue;
        // The two-stroke exception is scoped to the NAMED actions FR-103 (and 047 research R5)
        // actually list — not a blanket "any two-stroke token is fine" that would hide a future
        // two-stroke default shipped on some OTHER action outside its tier (review finding MINOR 6).
        if (isTwoStrokeToken(token) && TWO_STROKE_EXEMPT_ACTIONS.has(action)) continue;
        const normalised = normalizeToken(token);
        if (TIER_EXCEPTIONS.has(`${action}|${normalised}`)) continue;
        if (!matchesTier(tier, normalised)) {
          violations.push(`${action}: ${normalised} does not fit ${tier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  /**
   * 048 FR-020 / Constitution IV — a multi-stroke chord's FIRST stroke is judged as though it were the
   * whole chord. The split commands are tier 1, so their first stroke must be exactly Ctrl+Shift+Alt
   * plus a key, judged on the stroke itself rather than on the whole token's `+`-split.
   */
  it('judges each split chord by its first stroke, which is tier 1 (048 FR-020)', () => {
    const SPLITS: ActionId[] = ['panel.splitDown', 'panel.splitUp', 'panel.splitRight', 'panel.splitLeft'];
    for (const action of SPLITS) {
      const tokens = DEFAULT_KEYBINDINGS.bindings[action] ?? [];
      expect(tokens.length, action).toBe(1);
      const strokes = parseChordStrokes(tokens[0]);
      expect(strokes?.length, action).toBe(2);
      expect(ACTION_TIER[action]).toBe('tier1');
      expect(matchesTier('tier1', strokes?.[0] ?? ''), `${action} first stroke ${strokes?.[0]}`).toBe(true);
    }
  });

  /**
   * The one-chord rule's NAMED exceptions (Constitution IV): `menu.open` (the Menu key is not a second
   * chord), and — 046 iterate round 7, FR-127, maintainer-approved in bfe106d5 — `panel.zoomReset`,
   * which ALSO ships the main-row `Ctrl+Alt+0` beside `Ctrl+Alt+Numpad0`. Each is pinned to its EXACT
   * keyboard chords, so the exception can never widen into "this action may ship anything".
   */
  const MULTI_CHORD_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
    'menu.open': ['Shift+F10', 'ContextMenu'],
    'panel.zoomReset': ['Ctrl+Alt+Numpad0', 'Ctrl+Alt+0'],
  };

  it('ships at most one keyboard chord and one gesture per command (FR-105) — menu.open and panel.zoomReset excepted (FR-127)', () => {
    const violations: string[] = [];
    for (const [action, tokens] of Object.entries(DEFAULT_KEYBINDINGS.bindings)) {
      const chords = tokens.filter((t) => !isGestureToken(t));
      const gestures = tokens.filter(isGestureToken);
      const excepted = MULTI_CHORD_EXCEPTIONS[action];
      if (chords.length > 1 && !(excepted && chords.every((c, i) => c === excepted[i]) && chords.length === excepted.length)) {
        violations.push(`${action}: ${chords.length} keyboard chords`);
      }
      if (gestures.length > 1) violations.push(`${action}: ${gestures.length} gestures`);
    }
    expect(violations).toEqual([]);
  });

  it('each multi-chord exception is genuinely shipped as named — neither is vacuous (FR-127)', () => {
    for (const [action, chords] of Object.entries(MULTI_CHORD_EXCEPTIONS)) {
      expect(DEFAULT_KEYBINDINGS.bindings[action as ActionId].filter((t) => !isGestureToken(t)), action).toEqual(chords);
    }
  });

  /**
   * 046 iterate round 2 (FR-114) — the maintainer's own words, mid-build: "The 'Zoom Reset' key
   * bindings need to use the numpad zero, NOT the 0 key." `zoom.reset` and `panel.zoomReset` are
   * therefore a NAMED, exhaustive two-command exception to FR-105's "no shipped Numpad… token" rule
   * — every OTHER action's shipped chord must still carry none.
   */
  it('ships no Numpad… token, except zoom.reset / panel.zoomReset’s named Numpad0 (FR-105, FR-114)', () => {
    const NUMPAD_EXCEPTIONS: ReadonlySet<string> = new Set(['zoom.reset', 'panel.zoomReset']);
    const violations: string[] = [];
    for (const [action, tokens] of Object.entries(DEFAULT_KEYBINDINGS.bindings)) {
      if (NUMPAD_EXCEPTIONS.has(action)) continue;
      for (const token of tokens) {
        if (/Numpad/.test(token)) violations.push(`${action}: ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('zoom.reset / panel.zoomReset genuinely DO ship Numpad0 — the exception above is not vacuous (FR-114)', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['zoom.reset']).toEqual(['Ctrl+Shift+Alt+Numpad0']);
    expect(DEFAULT_KEYBINDINGS.bindings['panel.zoomReset']).toContain('Ctrl+Alt+Numpad0');
  });

  /**
   * 046 iterate round 3 (FR-117) re-pins six rows of FR-102's table: B / N / M focus the three
   * surfaces left to right, J / K toggle the two side panes left to right, and the notice moves to V.
   * Every other row keeps its FR-102 / FR-114 value.
   */
  it('asserts FR-102s table as FR-117 amends it — every *changes* row holds its new value, every other row its value at 3b04ec33', () => {
    const EXPECTED: Record<ActionId, string[]> = {
      'zoom.in': ['Ctrl+Shift+Alt++'],
      'zoom.out': ['Ctrl+Shift+Alt+-'],
      'zoom.reset': ['Ctrl+Shift+Alt+Numpad0'],
      'panel.zoomIn': ['Ctrl+Alt++', 'Ctrl+WheelUp'],
      'panel.zoomOut': ['Ctrl+Alt+-', 'Ctrl+WheelDown'],
      'panel.zoomReset': ['Ctrl+Alt+Numpad0', 'Ctrl+Alt+0', 'Ctrl+MiddleClick'], // re-pinned for FR-127
      'focus.left': ['Ctrl+Shift+Alt+ArrowLeft'],
      'focus.right': ['Ctrl+Shift+Alt+ArrowRight'],
      'focus.up': ['Ctrl+Shift+Alt+ArrowUp'],
      'focus.down': ['Ctrl+Shift+Alt+ArrowDown'],
      'focus.cycle': ['Ctrl+`'],
      'focus.cycleBack': ['Ctrl+Shift+`'],
      'focus.notice': ['Ctrl+Shift+Alt+V'],
      'view.fullscreen': ['F11'],
      'view.toggleProjects': ['Ctrl+Shift+Alt+J'],
      'view.toggleExplorer': ['Ctrl+Shift+Alt+K'],
      'project.next': ['Ctrl+Shift+Alt+PageDown'],
      'project.previous': ['Ctrl+Shift+Alt+PageUp'],
      'focus.explorer': ['Ctrl+Shift+Alt+M'],
      'focus.projects': ['Ctrl+Shift+Alt+B'],
      'focus.workspace': ['Ctrl+Shift+Alt+N'],
      'menu.open': ['Shift+F10', 'ContextMenu'],
      'tabs.openPicker': ['Ctrl+Shift+Alt+T'],
      'navigate.quickOpen': ['Ctrl+Shift+T'],
      'navigate.gotoLine': ['Ctrl+G'],
      'preview.open': [],
      'navigate.back': ['Alt+ArrowLeft'],
      'navigate.forward': ['Alt+ArrowRight'],
      'preview.followLink': ['Ctrl+Enter'],
      'preview.toggleSyncScroll': [],
      'file.rename': ['F2'],
      'file.cut': ['Ctrl+X'],
      'file.copy': ['Ctrl+C'],
      'file.paste': ['Ctrl+V'],
      'file.delete': ['Delete'],
      'file.undo': ['Ctrl+Z'],
      'file.redo': ['Ctrl+Y'],
      'editor.save': ['Ctrl+S'],
      'editor.saveAll': ['Ctrl+Shift+S'],
      'editor.saveAs': ['Ctrl+Alt+S'],
      'search.find': ['Ctrl+F'],
      'search.findNext': ['F3'],
      'search.findPrevious': ['Shift+F3'],
      'search.close': ['Escape'],
      'search.replace': ['Ctrl+H'],
      'search.replaceCurrent': ['Alt+Enter'],
      'search.replaceAll': ['Ctrl+Alt+Enter'],
      'search.findInFiles': ['Ctrl+Shift+F'],
      'search.replaceInFiles': ['Ctrl+Shift+H'],
      'terminal.scrollLineUp': ['Ctrl+Shift+ArrowUp'],
      'terminal.scrollLineDown': ['Ctrl+Shift+ArrowDown'],
      'terminal.scrollPageUp': ['Shift+PageUp'],
      'terminal.scrollPageDown': ['Shift+PageDown'],
      'terminal.scrollToTop': ['Ctrl+Home'],
      'terminal.scrollToBottom': ['Ctrl+End'],
      'terminal.redraw': ['Ctrl+F5'],
      'editor.cutLine': ['Ctrl+X'],
      'editor.indentLines': ['Tab'],
      'editor.outdentLines': ['Shift+Tab'],
      'editor.columnSelectUp': ['Shift+Alt+ArrowUp'],
      'editor.columnSelectDown': ['Shift+Alt+ArrowDown'],
      'editor.columnSelectLeft': ['Shift+Alt+ArrowLeft'],
      'editor.columnSelectRight': ['Shift+Alt+ArrowRight'],
      'editor.toggleWordWrap': ['Ctrl+E,W'], // re-pinned for FR-124 (Mods+K1,K2)
      // 048 FR-020 — the four split commands.
      'panel.splitDown': ['Ctrl+Shift+Alt+End,ArrowDown'],
      'panel.splitUp': ['Ctrl+Shift+Alt+End,ArrowUp'],
      'panel.splitRight': ['Ctrl+Shift+Alt+End,ArrowRight'],
      'panel.splitLeft': ['Ctrl+Shift+Alt+End,ArrowLeft'],
      // 048 FR-131 — Destroy Panel.
      'panel.destroy': ['Ctrl+Shift+Alt+F4'],
      // 047 (research R5, R7) — Markdown section folding and Go to Heading.
      'markdown.toggleSection': ['Ctrl+M,M'],
      'markdown.toggleAll': ['Ctrl+M,L'],
      'markdown.collapseSection': ['Ctrl+M,S'],
      'markdown.expandSection': [], // unbound by review, 2026-09-28
      'markdown.collapseAll': ['Ctrl+M,A'],
      'markdown.expandAll': [], // unbound by review, 2026-09-28
      'preview.goToHeading': ['Ctrl+G'],
    };
    expect(DEFAULT_KEYBINDINGS.bindings).toEqual(EXPECTED);
  });

  it('Ctrl+Shift+Alt+F and Ctrl+Shift+Alt+P are bound to nothing — FR-117 gives neither an owner', () => {
    const UNBOUND = ['Ctrl+Shift+Alt+F', 'Ctrl+Shift+Alt+P'];
    const stillBound = Object.entries(DEFAULT_KEYBINDINGS.bindings).filter(([, tokens]) =>
      tokens.some((t) => UNBOUND.includes(normalizeToken(t))),
    );
    expect(stillBound).toEqual([]);
  });

  it('plain Ctrl++, Ctrl+-, Ctrl+=, Ctrl+0 and Ctrl+Shift+0 are bound to nothing', () => {
    const RETIRED = ['Ctrl++', 'Ctrl+-', 'Ctrl+=', 'Ctrl+0', 'Ctrl+Shift+0'];
    const stillBound = Object.entries(DEFAULT_KEYBINDINGS.bindings).filter(([, tokens]) =>
      tokens.some((t) => RETIRED.includes(normalizeToken(t))),
    );
    expect(stillBound).toEqual([]);
  });
});
