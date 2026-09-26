/**
 * The dispatch scope provider (016, FR-017b0/FR-017d/FR-017f/FR-024b · T093/T094/T109).
 *
 * Scope is what makes `Ctrl+X` unambiguous. The SAME chord means "cut this file" in the explorer
 * and "cut this line" in an editor, and a resolver that could not tell them apart would either
 * delete a file when the user meant a line or refuse to cut a line at all. So the question "where
 * are we?" gets exactly one answer, from here.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { COMMAND_SCOPES, DEFAULT_KEYBINDINGS, type ActionId, type Keybindings, type Tab } from '@throng/core';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import {
  currentScope,
  DELIBERATELY_PANEL_SCOPED,
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

  /**
   * 046 FR-015, data-model.md §5 — `ActivePane` gains a THIRD member, `projects`, beside `files` and
   * `workspace`. With the Projects pane focused, `Ctrl+X` must resolve in the `projects` scope (where
   * only `EVERYWHERE` commands are live) rather than falling through to `explorer` and reaching the
   * File Explorer's `file.cut` while the user's attention and selection are in the Projects list.
   */
  it('is the PROJECTS scope whenever the Projects pane holds the focus, whatever panel is active', () => {
    setActivePane('projects');
    expect(currentScope({ tabs: [tabWith('editor')], activeTabId: 't1' })).toBe('projects');
  });

  it('falls back to explorer — the one scope where no text-editing command is live', () => {
    // A workspace pane showing a placeholder panel is not a text surface, and the safe answer to
    // "is Ctrl+X cut-line here?" is no. Window commands are live in every scope regardless.
    expect(currentScope({ tabs: [], activeTabId: null })).toBe('explorer');
    expect(scopeFromKind(undefined)).toBe('explorer');
    expect(scopeFromKind('placeholder')).toBe('explorer');
  });

  it('scopes a Find in Files panel to findInFiles, NOT to the fallback (043 R14)', () => {
    expect(scopeFromKind('findInFiles')).toBe('findInFiles');
    expect(currentScope({ tabs: [tabWith('findInFiles')], activeTabId: 't1' })).toBe('findInFiles');
  });
});

/**
 * 043 R14 — the fallback is SAFE for a placeholder and ACTIVELY DANGEROUS for a results panel.
 *
 * `scopeFromKind` answers `explorer` for any kind it does not know, and for a placeholder that is
 * the right answer: nothing is live there that could do damage. A Find in Files panel is a
 * different proposition, because it is a list the user drives with the arrow keys and Delete. Left
 * on the fallback, `file.delete` / `file.cut` / `file.copy` / `file.undo` and `file.rename` are all
 * live over THE FILE TREE'S SELECTION while the user's eyes and hands are on the results list — so
 * pressing Delete in a results panel deletes a file somewhere else on screen.
 *
 * That is the whole reason the fourth scope exists, so it is asserted here rather than inferred
 * from the mapping above.
 */
describe('the file-tree chords are NOT live over a Find in Files panel (043 R14)', () => {
  const quiet = { transientFocus: false, overlayOpen: false };
  const over = (kind: string): { tabs: Tab[]; activeTabId: string } => ({
    tabs: [tabWith(kind)],
    activeTabId: 't1',
  });

  type Ev = Parameters<typeof resolveScoped>[1];
  const DESTRUCTIVE: Array<{ chord: string; ev: Ev; action: string }> = [
    { chord: 'Delete', ev: { key: 'Delete' }, action: 'file.delete' },
    { chord: 'Ctrl+X', ev: { key: 'x', ctrl: true }, action: 'file.cut' },
    { chord: 'Ctrl+C', ev: { key: 'c', ctrl: true }, action: 'file.copy' },
    { chord: 'Ctrl+Z', ev: { key: 'z', ctrl: true }, action: 'file.undo' },
    { chord: 'F2', ev: { key: 'F2' }, action: 'file.rename' },
  ];

  for (const { chord, ev, action } of DESTRUCTIVE) {
    it(`${chord} does not resolve to ${action} over a results panel`, () => {
      // The positive half first, so the negative below cannot pass because the chord is unbound.
      expect(resolveScoped(DEFAULT_KEYBINDINGS, ev, over('placeholder'), quiet)).toBe(action);
      expect(
        resolveScoped(DEFAULT_KEYBINDINGS, ev, over('findInFiles'), quiet),
        `${action} is live over a Find in Files panel — it acts on the FILE TREE’s selection`,
      ).not.toBe(action);
    });
  }

  it('renaming the PANEL is what F2 means there instead (panel.rename)', () => {
    expect(resolveScoped(DEFAULT_KEYBINDINGS, { key: 'F2' }, over('findInFiles'), quiet)).toBe(
      'panel.rename',
    );
  });

  it('window-level chords are unaffected — a user must still be able to leave the panel', () => {
    // 046 iterate round 1 (FR-102): focus.left's shipped chord moved to tier 1.
    expect(
      resolveScoped(
        DEFAULT_KEYBINDINGS,
        { key: 'ArrowLeft', ctrl: true, alt: true, shift: true },
        over('findInFiles'),
        quiet,
      ),
    ).toBe('focus.left');
    expect(
      resolveScoped(
        DEFAULT_KEYBINDINGS,
        { key: 'T', ctrl: true, shift: true },
        over('findInFiles'),
        quiet,
      ),
    ).toBe('navigate.quickOpen');
  });
});

/**
 * 044 FR-021 — a preview panel is its OWN scope, for 043 R14's reason.
 *
 * A preview is a document the user reads and scrolls, and the fallback would put it in the
 * EXPLORER's scope: Delete, F2, Ctrl+X and Ctrl+C would all act on the file tree's selection while
 * the user's attention is on the rendered page. FR-021 also makes save and find inert there — a
 * preview has no document of its own to save and no find bar — and both are editor/panel commands,
 * so the `preview` scope gives them nothing to resolve to.
 */
describe('the file, save and find chords resolve to nothing over a preview (044 FR-021)', () => {
  const quiet = { transientFocus: false, overlayOpen: false };
  const over = (kind: string): { tabs: Tab[]; activeTabId: string } => ({
    tabs: [tabWith(kind)],
    activeTabId: 't1',
  });

  it('scopes a preview panel to preview, NOT to the explorer fallback', () => {
    expect(scopeFromKind('preview')).toBe('preview');
    expect(currentScope({ tabs: [tabWith('preview')], activeTabId: 't1' })).toBe('preview');
  });

  type Ev = Parameters<typeof resolveScoped>[1];
  const INERT: Array<{ chord: string; ev: Ev; action: string; live: string }> = [
    { chord: 'Delete', ev: { key: 'Delete' }, action: 'file.delete', live: 'placeholder' },
    { chord: 'F2', ev: { key: 'F2' }, action: 'file.rename', live: 'placeholder' },
    { chord: 'Ctrl+X', ev: { key: 'x', ctrl: true }, action: 'file.cut', live: 'placeholder' },
    { chord: 'Ctrl+C', ev: { key: 'c', ctrl: true }, action: 'file.copy', live: 'placeholder' },
    { chord: 'Ctrl+S', ev: { key: 's', ctrl: true }, action: 'editor.save', live: 'editor' },
    { chord: 'Ctrl+F', ev: { key: 'f', ctrl: true }, action: 'search.find', live: 'editor' },
  ];

  for (const { chord, ev, action, live } of INERT) {
    it(`${chord} resolves to ${action} over ${live}, and to NOTHING over a preview`, () => {
      // The positive half first, so the negative cannot pass because the chord is unbound.
      expect(resolveScoped(DEFAULT_KEYBINDINGS, ev, over(live), quiet)).toBe(action);
      expect(
        resolveScoped(DEFAULT_KEYBINDINGS, ev, over('preview'), quiet),
        `${chord} resolved over a preview panel`,
      ).toBeNull();
    });
  }

  it('keeps window-level chords live, so the user can still leave the panel', () => {
    // 046 iterate round 1 (FR-102): focus.left's shipped chord moved to tier 1.
    expect(
      resolveScoped(
        DEFAULT_KEYBINDINGS,
        { key: 'ArrowLeft', ctrl: true, alt: true, shift: true },
        over('preview'),
        quiet,
      ),
    ).toBe('focus.left');
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
    // 046 iterate round 1 (FR-102): zoom.in's shipped chord moved to tier 1, Ctrl+Shift+Alt++.
    const tab = { tabs: [tabWith('editor')], activeTabId: 't1' };
    const zoomIn = { key: '+', ctrl: true, shift: true, alt: true };

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
    expect(isPanelScoped('tabs.openPicker')).toBe(false);

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

    /*
     * 043 (#220, #153) — the SAME pairing one namespace along, and the same trap.
     *
     * Find in files and replace in files open a panel in the current tab and act on no panel's
     * content, so a focused transient surface must not suppress them: a terminal's focused element
     * IS a textarea, and swallowing `Ctrl+Shift+F` there would make the chord dead in the context a
     * user is likeliest to press it — silently, which is what makes this worth pinning.
     *
     * `search.find` above is the counter-case that stops this becoming a `search.` prefix: the find
     * BAR acts on one panel's content and must keep yielding (FR-017f).
     */
    expect(isPanelScoped('search.findInFiles')).toBe(false);
    expect(isPanelScoped('search.replaceInFiles')).toBe(false);
    expect(isPanelScoped('search.findNext')).toBe(true);

    /*
     * 046 US2 (data-model §4) — `project.next` / `project.previous` are WINDOW commands, like
     * `zoom.*` and `navigate.quickOpen`: stepping the active project means the same thing from a
     * terminal's find bar as from anywhere else, so a focused transient surface must not suppress
     * them. Exact matches, not a `project.` prefix — a future `project.`-prefixed command that acts
     * on ONE project's content (a rename box, say) must not be silently swept into the window tier by
     * a broad prefix the way `navigate.gotoLine` is deliberately excluded from `navigate.quickOpen`'s.
     */
    expect(isPanelScoped('project.next')).toBe(false);
    expect(isPanelScoped('project.previous')).toBe(false);
    // The prefix trap, stated directly: an unrelated `project.`-prefixed id must still default to
    // panel-scoped (`true`) unless it is one of the two exact ids above.
    expect(isPanelScoped('project.rename' as never)).toBe(true);
  });
});

describe('012’s window chords outrank editor commands (FR-024b · T109)', () => {
  /** Rebind one action, leaving the rest of the shipped bindings as they are. */
  const rebind = (action: string, chords: string[]): Keybindings => ({
    ...DEFAULT_KEYBINDINGS,
    bindings: { ...DEFAULT_KEYBINDINGS.bindings, [action]: chords },
  });

  it('leaves the shipped defaults alone — they do not collide', () => {
    // focus.left is tier 1 (Ctrl+Shift+Alt+Arrow, FR-102); this feature's column-select is a
    // recorded exception at Shift+Alt+Arrow (FR-103). Nothing is withheld today, which is exactly
    // why this rule needs a test: nothing in the shipped app would ever exercise it.
    const chords = editorChordsFor(DEFAULT_KEYBINDINGS, 'editor.columnSelectLeft');
    expect(chords).toEqual(['Shift+Alt+ArrowLeft']);
  });

  it('WITHHOLDS a chord that a rebind has made collide with a window command', () => {
    // The collision the shipped defaults avoid, and a rebind can create. The keybinding editor
    // permits it — the two commands live in different scopes, so it is not a conflict there — and
    // the editor is the one context that could silently overrule the window: its commands sit at
    // `Prec.highest` INSIDE CodeMirror, which is exactly how an editor swallows a chord.
    // 046 iterate round 1 (FR-102): focus.left's shipped chord moved to tier 1.
    expect(DEFAULT_KEYBINDINGS.bindings['focus.left']).toContain('Ctrl+Shift+Alt+ArrowLeft');
    const rebound = rebind('editor.columnSelectLeft', ['Ctrl+Shift+Alt+ArrowLeft']);

    // The editor never binds it, so the keypress is not handled there, is not preventDefault'ed,
    // and reaches the window-level listener exactly as it would with no editor focused.
    expect(editorChordsFor(rebound, 'editor.columnSelectLeft')).toEqual([]);
  });

  it('withholds ONLY the colliding chord, not the command’s other bindings', () => {
    const rebound = rebind('editor.cutLine', ['Ctrl+Shift+Alt+ArrowLeft', 'Ctrl+X']);
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
  // 046 iterate round 1 (FR-102): tabs.openPicker's shipped chord moved to tier 1.
  const openPicker = { key: 't', ctrl: true, shift: true, alt: true };
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
    // The tab picker is a WINDOW command (like Quick Open), not a panel one, so a find bar does not
    // suppress it — see the terminal case at the end of this file (046 iterate).
    expect(resolveScoped(DEFAULT_KEYBINDINGS, openPicker, input, opts)).toBe('tabs.openPicker');
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

/**
 * 046 iterate — `Ctrl+Alt+T` did nothing while a terminal held the focus, and worked from every other
 * element. A terminal's focused element IS xterm's helper textarea, so the transient-input guard reads
 * it as a busy input surface; `tabs.openPicker` is scoped EVERYWHERE (031 FR-032a) and must survive
 * it exactly as `navigate.quickOpen` does.
 */
describe('the tab picker chord from a focused terminal', () => {
  it('resolves Ctrl+Shift+Alt+T to tabs.openPicker while xterm’s textarea holds the caret', () => {
    // 046 iterate round 1 (FR-102): tabs.openPicker's shipped chord moved to tier 1.
    const input = { tabs: [tabWith('terminal')], activeTabId: 't1' };
    const xtermFocused = transientInputFocused(docWith({ tag: 'TEXTAREA' }));
    const opts = { transientFocus: xtermFocused, overlayOpen: false };
    expect(
      resolveScoped(DEFAULT_KEYBINDINGS, { key: 't', ctrl: true, shift: true, alt: true }, input, opts),
    ).toBe('tabs.openPicker');
  });
});

/**
 * 046 iterate round 1 (T109, FR-110) — the audit: every `ActionId` whose `COMMAND_SCOPES` entry is
 * EVERYWHERE (all six dispatch scopes — a window command, per `isPanelScoped`'s own doc comment)
 * MUST be either exempt in `isPanelScoped` or named on an explicit **deliberately panel-scoped**
 * list, with a reason. A new EVERYWHERE command on neither fails.
 *
 * `DELIBERATELY_PANEL_SCOPED` does not exist yet (`scope.ts` has no such export) — RED until T113
 * adds it. Once it does, R22's own finding stands: every EVERYWHERE command is exempt except
 * `menu.open`, which this file settles below rather than assumes.
 */
describe('FR-110 audit: every EVERYWHERE command is exempt or deliberately panel-scoped', () => {
  // The six scopes `isPanelScoped`'s doc comment and `keybindings.ts`'s own (unexported) EVERYWHERE
  // constant enumerate — restated here because EVERYWHERE itself is module-private to keybindings.ts.
  const ALL_SCOPES = ['editor', 'terminal', 'explorer', 'findInFiles', 'preview', 'projects'] as const;

  const everywhereActions = (Object.keys(COMMAND_SCOPES) as ActionId[]).filter((action) =>
    ALL_SCOPES.every((scope) => COMMAND_SCOPES[action].has(scope)),
  );

  it('finds EVERYWHERE commands to audit — the discovery is not vacuous', () => {
    expect(everywhereActions.length, 'no EVERYWHERE-scoped ActionId found — COMMAND_SCOPES read wrong').
      toBeGreaterThan(10);
    // The chord the widening was made for, by name (033 US1) — if this one stops being found, the
    // discovery itself is broken.
    expect(everywhereActions).toContain('navigate.quickOpen');
  });

  it('every EVERYWHERE command is exempt in isPanelScoped, or named on the deliberately-panel-scoped list', () => {
    const unaccounted = everywhereActions.filter(
      (action) => isPanelScoped(action) && !(action in DELIBERATELY_PANEL_SCOPED),
    );
    expect(
      unaccounted,
      'an EVERYWHERE command is neither exempt in isPanelScoped nor named on ' +
        'DELIBERATELY_PANEL_SCOPED with a reason — a new one added here is silently dead from a ' +
        'focused terminal or find bar (data-model §2)',
    ).toEqual([]);
  });

  it('DELIBERATELY_PANEL_SCOPED names only EVERYWHERE actions, each with a non-empty reason', () => {
    for (const [action, reason] of Object.entries(DELIBERATELY_PANEL_SCOPED)) {
      expect(everywhereActions, `${action} is on the list but is not EVERYWHERE-scoped`).toContain(action);
      expect(reason.length, `${action}'s reason is empty`).toBeGreaterThan(0);
    }
  });

  /*
   * menu.open (Shift+F10 / ContextMenu) is the one EVERYWHERE command R22 found unclassified.
   * Settled here, not assumed: `isPanelScoped('menu.open')` is already `true` today (it falls
   * through every exemption in `isPanelScoped` — none of the `zoom.`/`panel.`/`focus.`/`view.`
   * prefixes or exact matches names it), so a focused terminal's transient-input guard ALREADY
   * suppresses the app's OWN "rebuild a contextmenu at the focused element" dispatch
   * (`app.tsx`'s `case 'menu.open'`) there. That is deliberate, not a regression FR-110 need fix:
   * a terminal panel already has its own native right-click `contextmenu` handler
   * (`terminal-content-menu.ts`), and Shift+F10 is the browser's own native gesture for
   * "open a context menu" — throng's synthetic re-dispatch would be redundant over a terminal,
   * where a context menu is already reachable the same gesture opens elsewhere. So `menu.open`
   * joins `DELIBERATELY_PANEL_SCOPED`, not `isPanelScoped`'s exemption list.
   */
  /*
   * 046 iterate round 3 (T178, FR-116) — `focus.workspace` is the way BACK from a side pane or a
   * notice, so it has to work from exactly where focus is likeliest to be stranded: a terminal's
   * helper textarea or a find bar. It is a WINDOW command: audited as EVERYWHERE, exempt in
   * `isPanelScoped` by the `focus.` prefix, and resolved while a transient surface holds the caret.
   */
  it('ANSWER: focus.workspace is a window command — EVERYWHERE, exempt, and live from a focused terminal', () => {
    expect(everywhereActions).toContain('focus.workspace');
    expect(isPanelScoped('focus.workspace')).toBe(false);
    expect('focus.workspace' in DELIBERATELY_PANEL_SCOPED).toBe(false);

    const input = { tabs: [tabWith('terminal')], activeTabId: 't1' };
    const xtermFocused = transientInputFocused(docWith({ tag: 'TEXTAREA' }));
    const chord = { key: 'N', ctrl: true, shift: true, alt: true };
    expect(
      resolveScoped(DEFAULT_KEYBINDINGS, chord, input, { transientFocus: xtermFocused, overlayOpen: false }),
      'focus.workspace must still resolve while xterm’s helper textarea holds the caret',
    ).toBe('focus.workspace');
  });

  it('ANSWER: menu.open is SILENCED from a focused terminal — it is deliberately panel-scoped, not exempt', () => {
    expect(isPanelScoped('menu.open')).toBe(true);
    expect(DELIBERATELY_PANEL_SCOPED['menu.open' as ActionId]?.length).toBeGreaterThan(0);

    const input = { tabs: [tabWith('terminal')], activeTabId: 't1' };
    const xtermFocused = transientInputFocused(docWith({ tag: 'TEXTAREA' }));
    const shiftF10 = { key: 'F10', shift: true };
    expect(
      resolveScoped(DEFAULT_KEYBINDINGS, shiftF10, input, { transientFocus: xtermFocused, overlayOpen: false }),
      'menu.open must resolve to nothing while xterm’s helper textarea holds the caret',
    ).toBeNull();
    // Away from any transient surface, Shift+F10 still opens the app's own contextmenu dispatch.
    expect(
      resolveScoped(DEFAULT_KEYBINDINGS, shiftF10, input, { transientFocus: false, overlayOpen: false }),
    ).toBe('menu.open');
  });
});
