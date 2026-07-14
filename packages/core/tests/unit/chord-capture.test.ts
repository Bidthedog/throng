import { describe, it, expect } from 'vitest';
import {
  captureToken,
  isBindableChord,
  isReservedChord,
  findConflict,
  applyReplace,
  applyReassign,
  applyAdd,
  applyRemove,
  RESERVED_CHORDS,
  EXCLUDED_KEYS,
} from '../../src/config/chord-capture.js';

describe('captureToken', () => {
  const ev = (over: Partial<Parameters<typeof captureToken>[0]>) => ({
    key: '',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    ...over,
  });

  it('builds a canonical Ctrl+Shift+Alt+Meta+<key> token, upper-casing a lone letter', () => {
    expect(captureToken(ev({ ctrl: true, key: 'b' }))).toBe('Ctrl+B');
    expect(captureToken(ev({ ctrl: true, shift: true, alt: true, key: 's' }))).toBe('Ctrl+Shift+Alt+S');
    expect(captureToken(ev({ meta: true, key: 'l' }))).toBe('Meta+L');
    expect(captureToken(ev({ ctrl: true, meta: true, key: 'd' }))).toBe('Ctrl+Meta+D');
    expect(captureToken(ev({ key: 'F2' }))).toBe('F2');
  });

  it('canonicalises the spacebar so Alt+Space matches the reserved denylist (FR-032a)', () => {
    expect(captureToken(ev({ alt: true, key: ' ' }))).toBe('Alt+Space');
    expect(isReservedChord(captureToken(ev({ alt: true, key: ' ' })))).toBe(true);
  });

  it('never treats a held modifier key as the chord key', () => {
    expect(captureToken(ev({ ctrl: true, key: 'Control' }))).toBe('Ctrl');
    expect(captureToken(ev({ meta: true, key: 'Meta' }))).toBe('Meta');
    expect(captureToken(ev({ shift: true, key: 'Shift' }))).toBe('Shift');
  });
});

describe('isBindableChord (FR-033a: any single non-excluded key)', () => {
  it('accepts modifier chords AND bare single keys', () => {
    expect(isBindableChord('Ctrl+B')).toBe(true);
    expect(isBindableChord('Ctrl+Shift+Alt+S')).toBe(true);
    expect(isBindableChord('Ctrl++')).toBe(true);
    // single keys are now bindable (reverses the old modifier-minimum)
    expect(isBindableChord('A')).toBe(true);
    expect(isBindableChord('F2')).toBe(true);
  });

  it('rejects lone modifiers and the excluded keys', () => {
    expect(isBindableChord('Ctrl')).toBe(false);
    expect(isBindableChord('Meta')).toBe(false);
    expect(isBindableChord('Ctrl+Shift')).toBe(false);
    // excluded single keys (FR-033a): Esc/Space/Shift/Ctrl/Enter/CapsLock/NumLock
    for (const k of EXCLUDED_KEYS) expect(isBindableChord(k), k).toBe(false);
    expect(isBindableChord('Escape')).toBe(false);
    expect(isBindableChord('Space')).toBe(false);
    expect(isBindableChord('Enter')).toBe(false);
    expect(isBindableChord('CapsLock')).toBe(false);
    expect(isBindableChord('NumLock')).toBe(false);
  });

  it('BINDS Tab and Shift+Tab — 016 freed them, because indent/outdent need them (F1)', () => {
    // They left EXCLUDED_KEYS deliberately. `Tab` is `editor.indentLines`' default and every code
    // editor uses it; while it was excluded, two of the seven commands were unrebindable and the
    // shipped default was itself uncapturable. The exclusion existed to protect focus traversal,
    // and FR-017f's focus guard now protects that directly — while a find bar or any other
    // transient input has focus, Tab moves within it and never reaches the document.
    expect(EXCLUDED_KEYS.has('Tab')).toBe(false);
    expect(isBindableChord('Tab')).toBe(true);
    expect(isBindableChord('Shift+Tab')).toBe(true);
  });

  it('an excluded key IS bindable when combined with a modifier (modifier combos allowed)', () => {
    // The exclusion is for a key bound ALONE; with a modifier it's a normal combo.
    expect(isBindableChord('Ctrl+Space')).toBe(true);
    expect(isBindableChord('Ctrl+Enter')).toBe(true);
    expect(isBindableChord('Shift+Space')).toBe(true);
  });
});

describe('isReservedChord (FR-032a: OS/window-control denylist)', () => {
  it('flags the curated reserved combinations', () => {
    for (const t of RESERVED_CHORDS) expect(isReservedChord(t), t).toBe(true);
    expect(isReservedChord('Ctrl+Alt+Delete')).toBe(true);
    expect(isReservedChord('Alt+F4')).toBe(true);
    expect(isReservedChord('Alt+Tab')).toBe(true);
    expect(isReservedChord('Alt+Space')).toBe(true);
    expect(isReservedChord('Ctrl+Shift+Escape')).toBe(true);
  });

  it('flags any chord whose only modifier is Meta/Super', () => {
    expect(isReservedChord('Meta+L')).toBe(true);
    expect(isReservedChord('Meta+D')).toBe(true);
    expect(isReservedChord('Meta+Tab')).toBe(true);
  });

  it('passes ordinary bindable chords, incl. Meta combined with another modifier', () => {
    expect(isReservedChord('Ctrl+S')).toBe(false);
    expect(isReservedChord('Ctrl+B')).toBe(false);
    expect(isReservedChord('Ctrl+Meta+L')).toBe(false);
    expect(isReservedChord('Ctrl+Shift+P')).toBe(false);
  });
});

describe('findConflict is SCOPE-AWARE (016, FR-017b1)', () => {
  const bindings = {
    'editor.cutLine': ['Ctrl+X'], // {editor}
    'file.cut': ['Ctrl+X'], // {explorer}
    'editor.indentLines': ['Tab'], // {editor}
  };

  it('does NOT flag a chord shared by commands whose scopes are DISJOINT', () => {
    // The headline coexistence: Ctrl+X cuts a LINE in an editor and a FILE in the tree. Warning
    // about this would train the user to dismiss the warning that matters.
    expect(findConflict(bindings, 'Ctrl+X', 'editor.cutLine')).toBeNull();
    expect(findConflict(bindings, 'Ctrl+X', 'file.cut')).toBeNull();
  });

  it('DOES flag a chord whose commands are live in a common context', () => {
    // Rebinding indent to Ctrl+X would put two commands on one chord inside the editor — a real
    // clash, and 007's warn → Reassign/Cancel flow must still fire. A scope-aware check that
    // wrongly said "no conflict" here would silently reintroduce last-writer-wins.
    expect(findConflict(bindings, 'Ctrl+X', 'editor.indentLines')).toBe('editor.cutLine');
  });
});

describe('findConflict (FR-034)', () => {
  const bindings = { 'editor.save': ['Ctrl+S'], 'editor.saveAll': ['Ctrl+Shift+S'] };

  it('finds another action bound to the token', () => {
    expect(findConflict(bindings, 'Ctrl+S', 'editor.saveAs')).toBe('editor.save');
  });

  it('excludes the action being edited (rebinding to its own chord is no conflict)', () => {
    expect(findConflict(bindings, 'Ctrl+S', 'editor.save')).toBeNull();
  });

  it('returns null when the token is unbound', () => {
    expect(findConflict(bindings, 'Ctrl+K', 'editor.saveAs')).toBeNull();
  });

  it('matches case-insensitively via normalisation', () => {
    expect(findConflict(bindings, 'Ctrl+s', 'editor.saveAs')).toBe('editor.save');
  });
});

describe('applyReplace / applyReassign (FR-033/034)', () => {
  it('applyReplace sets the action to exactly the captured token, others untouched, original unmutated', () => {
    const bindings = { 'editor.save': ['Ctrl+S', 'Ctrl+K'], 'file.copy': ['Ctrl+C'] };
    const next = applyReplace(bindings, 'editor.save', 'Ctrl+W');
    expect(next['editor.save']).toEqual(['Ctrl+W']);
    expect(next['file.copy']).toEqual(['Ctrl+C']);
    expect(bindings['editor.save']).toEqual(['Ctrl+S', 'Ctrl+K']); // original intact
  });

  it('applyReassign removes the token from the other action then ADDS it here (keeps existing)', () => {
    const bindings = { 'editor.save': ['Ctrl+S'], 'file.copy': ['Ctrl+C'] };
    const next = applyReassign(bindings, 'editor.save', 'file.copy', 'Ctrl+S');
    expect(next['editor.save']).toEqual([]); // removed from the previous owner
    expect(next['file.copy']).toEqual(['Ctrl+C', 'Ctrl+S']); // appended, existing kept
  });
});

describe('applyAdd / applyRemove (FR-033/033b: multiple chords per action)', () => {
  it('applyAdd appends a chord, leaving existing ones in place', () => {
    const bindings = { 'view.toggleProjects': ['Ctrl+B'] };
    const next = applyAdd(bindings, 'view.toggleProjects', 'Ctrl+K');
    expect(next['view.toggleProjects']).toEqual(['Ctrl+B', 'Ctrl+K']);
    expect(bindings['view.toggleProjects']).toEqual(['Ctrl+B']); // original intact
  });

  it('applyAdd is a no-op when the identical chord already exists (dedup)', () => {
    const bindings = { 'view.toggleProjects': ['Ctrl+B'] };
    const next = applyAdd(bindings, 'view.toggleProjects', 'Ctrl+b'); // case-insensitive
    expect(next['view.toggleProjects']).toEqual(['Ctrl+B']);
  });

  it('applyAdd seeds an action that had no bindings', () => {
    const next = applyAdd({ 'file.rename': [] }, 'file.rename', 'F2');
    expect(next['file.rename']).toEqual(['F2']);
  });

  it('applyRemove removes just the given chord, keeping the rest', () => {
    const bindings = { 'view.toggleProjects': ['Ctrl+B', 'Ctrl+K'] };
    const next = applyRemove(bindings, 'view.toggleProjects', 'Ctrl+B');
    expect(next['view.toggleProjects']).toEqual(['Ctrl+K']);
    expect(bindings['view.toggleProjects']).toEqual(['Ctrl+B', 'Ctrl+K']); // original intact
  });
});
