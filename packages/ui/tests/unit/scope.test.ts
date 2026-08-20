/**
 * The dispatch scope provider (016, FR-017b0/FR-017d/FR-017f/FR-024b · T093/T094/T109).
 *
 * Scope is what makes `Ctrl+X` unambiguous. The SAME chord means "cut this file" in the explorer
 * and "cut this line" in an editor, and a resolver that could not tell them apart would either
 * delete a file when the user meant a line or refuse to cut a line at all. So the question "where
 * are we?" gets exactly one answer, from here.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_KEYBINDINGS, type Keybindings, type Tab } from '@throng/core';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import {
  currentScope,
  editorChordsFor,
  isPanelScoped,
  opensTransientOverlay,
  resolveScoped,
  scopeFromKind,
  transientInputFocused,
  windowChords,
} from '../../src/renderer/keybindings/scope.js';

/** A tab holding one panel of the given kind, active. */
const tabWith = (kind: string): Tab =>
  ({
    id: 't1',
    title: 'T',
    activePanelId: 'p1',
    root: { type: 'panel', id: 'p1', kind, title: 'P' },
  }) as unknown as Tab;

/** A fake DOM just deep enough for the focus guard — the unit project has no document. */
const docWith = (
  active: { tag?: string; within?: string; contentEditable?: boolean } | null,
): Document =>
  ({
    activeElement: active
      ? {
          tagName: active.tag ?? 'DIV',
          isContentEditable: active.contentEditable ?? false,
          closest: (sel: string) => (active.within === sel ? {} : null),
        }
      : null,
  }) as unknown as Document;

beforeEach(() => setActivePane('workspace'));

describe('which scope are we in', () => {
  it('scopes a panel by its TYPE', () => {
    expect(currentScope({ tabs: [tabWith('editor')], activeTabId: 't1' })).toBe('editor');
    expect(currentScope({ tabs: [tabWith('terminal')], activeTabId: 't1' })).toBe('terminal');
  });

  it('is the EXPLORER scope whenever the file tree holds the focus, whatever panel is active', () => {
    setActivePane('files');
    expect(currentScope({ tabs: [tabWith('editor')], activeTabId: 't1' })).toBe('explorer');
  });

  it('falls back to explorer — the one scope where no text-editing command is live', () => {
    // A workspace pane showing a placeholder panel is not a text surface, and the safe answer to
    // "is Ctrl+X cut-line here?" is no. Window commands are live in every scope regardless.
    expect(currentScope({ tabs: [], activeTabId: null })).toBe('explorer');
    expect(scopeFromKind(undefined)).toBe('explorer');
    expect(scopeFromKind('placeholder')).toBe('explorer');
  });
});

/**
 * 033 AS-9 / A4 — Go To Line is dead without an editor, and alive with one.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/goto-line.e2e.ts:601` (035 T055) — `test('with no editor
 * active the chord does nothing — and the same chord opens the modal once one is')`.
 *
 * The E2E's shape is worth keeping, because a negative on its own proves very little. It pressed the
 * chord over an untyped placeholder panel, saw no modal, and then made the SAME panel an editor and
 * pressed the SAME chord in the SAME window and saw one — so "nothing happened" was the scope gate
 * refusing rather than a chord that had never been bound (#244's shape). Both halves are below, and
 * the positive one is the reason to trust the negative.
 */
describe('a panel-scoped chord resolves only in the scope it belongs to (AS-9, A4)', () => {
  const gotoLine = { key: 'g', ctrl: true };
  const quiet = { transientFocus: false, overlayOpen: false };
  const over = (kind: string): { tabs: Tab[]; activeTabId: string } => ({
    tabs: [tabWith(kind)],
    activeTabId: 't1',
  });

  it('does NOT resolve over an untyped placeholder panel', () => {
    // The panel a new tab starts with, before the user picks a type. It is not a text surface.
    expect(resolveScoped(DEFAULT_KEYBINDINGS, gotoLine, over('placeholder'), quiet)).toBeNull();
  });

  it('does NOT resolve over a terminal', () => {
    expect(resolveScoped(DEFAULT_KEYBINDINGS, gotoLine, over('terminal'), quiet)).toBeNull();
  });

  it('DOES resolve over an editor — so the two negatives above are not vacuous', () => {
    expect(resolveScoped(DEFAULT_KEYBINDINGS, gotoLine, over('editor'), quiet)).toBe(
      'navigate.gotoLine',
    );
  });

  it('does not resolve when there is no tab at all', () => {
    expect(
      resolveScoped(DEFAULT_KEYBINDINGS, gotoLine, { tabs: [], activeTabId: null }, quiet),
    ).toBeNull();
  });

  it('and a WINDOW command is unaffected by any of it — Quick Open stays live', () => {
    /*
     * The distinction AS-9 rests on. Both live under `navigate.`, and only one is panel-scoped: Go
     * To Line acts on a document, Quick Open acts on the window. A gate that took the namespace
     * rather than the exact id would kill Quick Open over a terminal, where it is one of the two
     * places the story is about.
     */
    // Ctrl+Shift+T, not Ctrl+P: scoped EVERYWHERE, it had to pick a chord no line editor wanted.
    const quickOpen = { key: 'T', ctrl: true, shift: true };
    for (const kind of ['placeholder', 'terminal', 'editor']) {
      expect(resolveScoped(DEFAULT_KEYBINDINGS, quickOpen, over(kind), quiet)).toBe(
        'navigate.quickOpen',
      );
    }
  });
});

describe('the focus guard (FR-017f)', () => {
  it('holds while a TRANSIENT input surface has focus — 013’s find bar above all', () => {
    expect(transientInputFocused(docWith({ within: '[data-find-bar]' }))).toBe(true);
    expect(transientInputFocused(docWith({ tag: 'INPUT' }))).toBe(true);
    expect(transientInputFocused(docWith({ tag: 'TEXTAREA' }))).toBe(true);
    expect(transientInputFocused(docWith({ contentEditable: true }))).toBe(true);
  });

  it('does NOT hold for the document itself — CodeMirror’s content IS the editor', () => {
    expect(transientInputFocused(docWith({ within: '.cm-content' }))).toBe(false);
    expect(transientInputFocused(docWith(null))).toBe(false);
  });

  it('stops an editor command firing from inside the find bar — Tab must not indent the file', () => {
    // THE case this guard exists for. `Tab` is `editor.indentLines`' default chord, so without it a
    // user typing a search term would silently re-indent the document behind the bar: an editing
    // command mutating the file from a surface that was never editing it.
    const tab = { tabs: [tabWith('editor')], activeTabId: 't1' };
    const tabKey = { key: 'Tab', ctrl: false, shift: false, alt: false };

    expect(resolveScoped(DEFAULT_KEYBINDINGS, tabKey, tab, { transientFocus: false })).toBe(
      'editor.indentLines',
    );
    expect(resolveScoped(DEFAULT_KEYBINDINGS, tabKey, tab, { transientFocus: true })).toBeNull();
  });

  it('never suppresses a WINDOW command — the user must be able to leave the bar (FR-024b)', () => {
    // Focus movement and zoom outrank everything. Trapping a user inside a find bar because the
    // guard was too eager would be a worse bug than the one it prevents.
    const tab = { tabs: [tabWith('editor')], activeTabId: 't1' };
    const zoomIn = { key: '=', ctrl: true, shift: false, alt: false };

    expect(resolveScoped(DEFAULT_KEYBINDINGS, zoomIn, tab, { transientFocus: true })).toBe(
      'zoom.in',
    );
  });

  it('classifies window-level commands, and nothing else, as outranking a focused surface', () => {
    expect(isPanelScoped('zoom.in')).toBe(false);
    expect(isPanelScoped('focus.left')).toBe(false);
    expect(isPanelScoped('panel.zoomIn')).toBe(false);
    expect(isPanelScoped('view.fullscreen')).toBe(false);

    /*
     * 033 US1 — Quick Open is a WINDOW command, like `zoom.*`, `view.*` and `tabs.openPicker`.
     *
     * It acts on the window, not on the content of whatever panel is active, so a focused transient
     * surface must not suppress it: the chord has to work from inside a find bar and from inside a
     * terminal's textarea alike (FR-003). Returning `true` here would leave the chord dead in
     * exactly the two surfaces the story is about, with nothing at compile time to say so —
     * data-model.md §2 records this as a SILENT failure.
     */
    expect(isPanelScoped('navigate.quickOpen')).toBe(false);

    /*
     * 033 US2 — and its NAMESPACE SIBLING is the opposite, which is why the line above is an exact
     * match rather than a `navigate.` prefix.
     *
     * Go To Line acts on the content of one editor's document, so a focused transient surface must
     * suppress it exactly as it suppresses `search.find` and `editor.indentLines`. Widening the
     * clause above to the prefix would silently make this false, and the symptom would be the find
     * bar's own keys losing to a modal that took the caret out from under the user mid-search.
     */
    expect(isPanelScoped('navigate.gotoLine')).toBe(true);

    expect(isPanelScoped('editor.cutLine')).toBe(true);
    expect(isPanelScoped('editor.indentLines')).toBe(true);
    expect(isPanelScoped('search.find')).toBe(true);
  });
});

describe('012’s window chords outrank editor commands (FR-024b · T109)', () => {
  /** Rebind one action, leaving the rest of the shipped bindings as they are. */
  const rebind = (action: string, chords: string[]): Keybindings => ({
    ...DEFAULT_KEYBINDINGS,
    bindings: { ...DEFAULT_KEYBINDINGS.bindings, [action]: chords },
  });

  it('leaves the shipped defaults alone — they do not collide', () => {
    // 012 uses Ctrl+Alt+Arrow; this feature uses Shift+Alt+Arrow. Nothing is withheld today, which
    // is exactly why this rule needs a test: nothing in the shipped app would ever exercise it.
    const chords = editorChordsFor(DEFAULT_KEYBINDINGS, 'editor.columnSelectLeft');
    expect(chords).toEqual(['Shift+Alt+ArrowLeft']);
  });

  it('WITHHOLDS a chord that a rebind has made collide with a window command', () => {
    // The collision the shipped defaults avoid, and a rebind can create. The keybinding editor
    // permits it — the two commands live in different scopes, so it is not a conflict there — and
    // the editor is the one context that could silently overrule the window: its commands sit at
    // `Prec.highest` INSIDE CodeMirror, which is exactly how an editor swallows a chord.
    expect(DEFAULT_KEYBINDINGS.bindings['focus.left']).toContain('Ctrl+Alt+ArrowLeft');
    const rebound = rebind('editor.columnSelectLeft', ['Ctrl+Alt+ArrowLeft']);

    // The editor never binds it, so the keypress is not handled there, is not preventDefault'ed,
    // and reaches the window-level listener exactly as it would with no editor focused.
    expect(editorChordsFor(rebound, 'editor.columnSelectLeft')).toEqual([]);
  });

  it('withholds ONLY the colliding chord, not the command’s other bindings', () => {
    const rebound = rebind('editor.cutLine', ['Ctrl+Alt+ArrowLeft', 'Ctrl+X']);
    expect(editorChordsFor(rebound, 'editor.cutLine')).toEqual(['Ctrl+X']);
  });

  it('claims every window-level chord, and no panel-scoped one', () => {
    const claimed = windowChords(DEFAULT_KEYBINDINGS);
    const focusLeft = DEFAULT_KEYBINDINGS.bindings['focus.left'] ?? [];
    const zoomIn = DEFAULT_KEYBINDINGS.bindings['zoom.in'] ?? [];
    expect(focusLeft.length).toBeGreaterThan(0); // …the loops below must not pass vacuously
    expect(zoomIn.length).toBeGreaterThan(0);

    for (const chord of focusLeft) expect(claimed.has(chord)).toBe(true);
    for (const chord of zoomIn) expect(claimed.has(chord)).toBe(true);
    // …and Ctrl+X (cut-line / cut-file) is emphatically not the window's to claim.
    expect(claimed.has('Ctrl+X')).toBe(false);
    expect(claimed.has('Tab')).toBe(false);
  });
});

/**
 * 033 Phase 11 / FR-071 — one overlay hands over to the next, through the focus guard.
 *
 * The guard (FR-017f) suppresses panel-scoped commands while a transient input surface has focus,
 * and an overlay's own filter box IS an `<input>` — so with Quick Open or the tab picker up,
 * `Ctrl+G` and `Ctrl+Alt+T` resolved to null and the chord appeared to be ignored. Four of
 * SC-017's six orderings could not be driven by hand at all, which is a different bug wearing the
 * same clothes as the one FR-071 is about.
 *
 * Both conditions of the exemption are asserted independently below, because each one alone would
 * be a regression: without `overlayOpen` the chord fires from a find bar, and without
 * `opensTransientOverlay` every editor command comes back to life while the user types a query.
 */
describe('one transient overlay may open another (033 FR-071)', () => {
  const tabs = [tabWith('editor')];
  const input = { tabs, activeTabId: 't1' };
  const gotoLine = { key: 'g', ctrl: true };
  const openPicker = { key: 't', ctrl: true, alt: true };
  const cutLine = { key: 'x', ctrl: true };

  it('names the commands whose whole effect is to open an overlay, and nothing else', () => {
    expect(opensTransientOverlay('navigate.quickOpen')).toBe(true);
    expect(opensTransientOverlay('navigate.gotoLine')).toBe(true);
    expect(opensTransientOverlay('tabs.openPicker')).toBe(true);
    expect(opensTransientOverlay('editor.cutLine')).toBe(false);
    expect(opensTransientOverlay('search.find')).toBe(false);
  });

  it('lets an overlay chord through while another overlay holds the caret', () => {
    const opts = { transientFocus: true, overlayOpen: true };
    expect(resolveScoped(DEFAULT_KEYBINDINGS, gotoLine, input, opts)).toBe('navigate.gotoLine');
    expect(resolveScoped(DEFAULT_KEYBINDINGS, openPicker, input, opts)).toBe('tabs.openPicker');
  });

  it('still suppresses it in a panel’s OWN transient surface — a find bar is not an overlay', () => {
    const opts = { transientFocus: true, overlayOpen: false };
    expect(resolveScoped(DEFAULT_KEYBINDINGS, gotoLine, input, opts)).toBeNull();
    expect(resolveScoped(DEFAULT_KEYBINDINGS, openPicker, input, opts)).toBeNull();
  });

  it('never widens to a command that edits the panel underneath', () => {
    // Ctrl+X while typing a Quick Open query must cut the QUERY, not a line of the document below.
    expect(
      resolveScoped(DEFAULT_KEYBINDINGS, cutLine, input, {
        transientFocus: true,
        overlayOpen: true,
      }),
    ).toBeNull();
  });

  it('changes nothing when no transient surface has focus', () => {
    const opts = { transientFocus: false, overlayOpen: false };
    expect(resolveScoped(DEFAULT_KEYBINDINGS, gotoLine, input, opts)).toBe('navigate.gotoLine');
    expect(resolveScoped(DEFAULT_KEYBINDINGS, cutLine, input, opts)).toBe('editor.cutLine');
  });
});
