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
