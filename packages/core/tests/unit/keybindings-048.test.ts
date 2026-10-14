/**
 * 048 — the four split commands and the narrowed terminal-tier rule (research R4, data-model
 * "Keybinding actions").
 *
 * FR-020: each split command ships `Ctrl+Shift+Alt+End,<Arrow>`. FR-024 / Constitution IV: a
 * multi-stroke chord is refused on a terminal-live command only when its FIRST stroke is in the
 * reserved tier — `Ctrl+Shift+Alt+End` is tier 1, so the split chords are live in a terminal, while a
 * `Ctrl+E,W`-shaped chord stays refused there.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  chordCollisions,
  firstStrokeIsReserved,
  normalizeToken,
  parseKeybindings,
  resolveAction,
  terminalMultiStrokeAllowed,
  WINDOW_HANDLED_ACTIONS,
  WINDOW_MULTI_STROKE_ACTIONS,
  twoStrokeTerminalViolations,
  type ActionId,
  type CommandScopes,
} from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';
import { captureToken, isReservedChord } from '../../src/config/chord-capture.js';

const SPLITS: { action: ActionId; chord: string; label: string }[] = [
  { action: 'panel.splitDown', chord: 'Ctrl+Shift+Alt+End,ArrowDown', label: 'Split Down' },
  { action: 'panel.splitUp', chord: 'Ctrl+Shift+Alt+End,ArrowUp', label: 'Split Up' },
  { action: 'panel.splitRight', chord: 'Ctrl+Shift+Alt+End,ArrowRight', label: 'Split Right' },
  { action: 'panel.splitLeft', chord: 'Ctrl+Shift+Alt+End,ArrowLeft', label: 'Split Left' },
];

describe('the four split commands (FR-001, FR-020)', () => {
  it('each ships exactly its two-stroke Windows default', () => {
    for (const { action, chord } of SPLITS) {
      expect(DEFAULT_KEYBINDINGS.bindings[action], action).toEqual([chord]);
    }
  });

  it('each is live in every panel kind, a terminal, a placeholder and a preview included (FR-024)', () => {
    // A placeholder panel dispatches at the `explorer` scope (renderer `scopeFromKind`), and FR-021
    // has the first stroke pull focus to the active panel FROM the File Explorer — so the chord has
    // to be live wherever focus can be, the window-command set.
    for (const { action } of SPLITS) {
      const scopes = COMMAND_SCOPES[action];
      expect(scopes, action).toBeDefined();
      for (const scope of ['editor', 'terminal', 'findInFiles', 'preview', 'explorer'] as const) {
        expect(scopes.has(scope), `${action} in ${scope}`).toBe(true);
      }
    }
  });

  it('each has a Key Bindings editor row with its label and a description', () => {
    for (const { action, label } of SPLITS) {
      const row = KEYBINDINGS_METADATA.find((d) => d.key === action);
      expect(row, action).toBeDefined();
      expect(row?.label).toBe(label);
      expect(row?.description.length ?? 0).toBeGreaterThan(0);
      expect(row?.group).toBe(KEYBINDINGS_METADATA.find((d) => d.key === 'panel.zoomIn')?.group);
    }
  });

  it('no split default collides with another shipped chord', () => {
    const clashes = chordCollisions(DEFAULT_KEYBINDINGS.bindings).filter((c) =>
      c.actions.some((a) => SPLITS.some((s) => s.action === a)),
    );
    expect(clashes).toEqual([]);
  });

  it('the first stroke Ctrl+Shift+Alt+End is bound to nothing on its own', () => {
    const bound = Object.entries(DEFAULT_KEYBINDINGS.bindings).filter(([, tokens]) =>
      tokens.some((t) => normalizeToken(t) === 'Ctrl+Shift+Alt+End'),
    );
    expect(bound).toEqual([]);
  });
});

/*
 * FR-131 (#461) — Destroy Panel from the keyboard, in EVERY panel, a terminal included (Constitution
 * v5.8.0, Principle IV's recorded exception). Window-handled, so the dispatcher captures it ahead of
 * xterm; the dispatcher, not the scope, decides that a side pane destroys nothing.
 */
describe('panel.destroy (048 FR-131)', () => {
  const CHORD = 'Ctrl+Shift+Alt+F4';

  it('ships exactly Ctrl+Shift+Alt+F4', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['panel.destroy']).toEqual([CHORD]);
  });

  it('is live in every panel kind — editor, terminal, Find in Files, preview and the placeholder’s `explorer`', () => {
    const scopes = COMMAND_SCOPES['panel.destroy'];
    expect(scopes).toBeDefined();
    for (const scope of ['editor', 'terminal', 'findInFiles', 'preview', 'explorer'] as const) {
      expect(scopes.has(scope), scope).toBe(true);
    }
  });

  it('resolves in a terminal, so the window dispatcher can consume it before the program sees it', () => {
    const press = { key: 'F4', ctrl: true, shift: true, alt: true };
    for (const scope of ['editor', 'terminal', 'findInFiles', 'preview', 'explorer'] as const) {
      expect(resolveAction(DEFAULT_KEYBINDINGS, press, scope), scope).toBe('panel.destroy');
    }
    expect(WINDOW_HANDLED_ACTIONS.has('panel.destroy')).toBe(true);
  });

  it('has a Key Bindings editor row labelled "Destroy Panel", beside the other active-panel commands', () => {
    const row = KEYBINDINGS_METADATA.find((d) => d.key === 'panel.destroy');
    expect(row).toBeDefined();
    expect(row?.label).toBe('Destroy Panel');
    expect(row?.description.length ?? 0).toBeGreaterThan(0);
    expect(row?.description).not.toContain('F4');
    expect(row?.group).toBe(KEYBINDINGS_METADATA.find((d) => d.key === 'panel.splitDown')?.group);
  });

  it('no shipped binding collides with it, and no other shipped binding holds any F4 chord', () => {
    const clashes = chordCollisions(DEFAULT_KEYBINDINGS.bindings).filter((c) => c.actions.includes('panel.destroy'));
    expect(clashes).toEqual([]);
    const f4 = Object.entries(DEFAULT_KEYBINDINGS.bindings).filter(([, tokens]) =>
      tokens.some((t) => /(^|\+)F4$/.test(normalizeToken(t))),
    );
    expect(f4.map(([action]) => action)).toEqual(['panel.destroy']);
  });

  it('is not refused by the reserved Alt+F4 — that entry is matched exactly, so a rebind can capture the chord', () => {
    expect(isReservedChord('Alt+F4')).toBe(true);
    expect(isReservedChord(CHORD)).toBe(false);
    expect(captureToken({ key: 'F4', code: 'F4', ctrl: true, shift: true, alt: true, meta: false })).toBe(CHORD);
    expect(parseKeybindings({ bindings: { 'panel.destroy': [CHORD] } }).bindings['panel.destroy']).toEqual([CHORD]);
  });
});

describe('panel.rename is gone (048 FR-030, FR-037)', () => {
  it('is not a registered command: no scope, no default, no Key Bindings row', () => {
    expect(Object.keys(COMMAND_SCOPES)).not.toContain('panel.rename');
    expect(Object.keys(DEFAULT_KEYBINDINGS.bindings)).not.toContain('panel.rename');
    expect(KEYBINDINGS_METADATA.map((d) => d.key)).not.toContain('panel.rename');
  });

  it('a stale user override of it parses without error and blocks nothing (FR-037)', () => {
    const kb = parseKeybindings({ bindings: { 'panel.rename': ['F2'] } });
    const f2 = { key: 'F2' };
    // F2 still renames a file in the tree…
    expect(resolveAction(kb, f2, 'explorer')).toBe('file.rename');
    // …and in every panel scope resolves to nothing, so it reaches the terminal / editor untouched.
    for (const scope of ['editor', 'terminal', 'findInFiles', 'preview'] as const) {
      expect(resolveAction(kb, f2, scope), scope).toBeNull();
    }
  });
});

describe('the terminal-tier rule judges a multi-stroke chord by its first stroke (Constitution IV)', () => {
  it('firstStrokeIsReserved: true for a reserved first stroke, false for tier 1 and for a single stroke', () => {
    expect(firstStrokeIsReserved('Ctrl+E,W')).toBe(true);
    expect(firstStrokeIsReserved('Ctrl+k,x')).toBe(true);
    expect(firstStrokeIsReserved('Ctrl+Shift+Alt+End,ArrowDown')).toBe(false);
    expect(firstStrokeIsReserved('Ctrl+Shift+E,W')).toBe(false);
  });

  it('twoStrokeTerminalViolations accepts the shipped split chords', () => {
    const violations = twoStrokeTerminalViolations(DEFAULT_KEYBINDINGS.bindings).filter((v) =>
      SPLITS.some((s) => s.action === v.action),
    );
    expect(violations).toEqual([]);
    expect(twoStrokeTerminalViolations(DEFAULT_KEYBINDINGS.bindings)).toEqual([]);
  });

  it('twoStrokeTerminalViolations still rejects a terminal-live chord whose first stroke is reserved', () => {
    const bindings = { 'panel.splitDown': ['Ctrl+E,W'], 'panel.splitUp': ['Ctrl+Shift+Alt+End,ArrowUp'] };
    expect(twoStrokeTerminalViolations(bindings, COMMAND_SCOPES as CommandScopes)).toEqual([
      { action: 'panel.splitDown', token: 'Ctrl+E,W' },
    ]);
  });

  /*
   * Review R5, widened by T060 (FR-024) — a multi-stroke chord runs in a terminal only through the
   * window chord engine, which now serves every WINDOW-HANDLED command. Any other terminal-live
   * command given one would validate, never fire, and hand its first stroke to the shell — so it is
   * refused whatever its first stroke; and a reserved first stroke is refused for every command.
   */
  it('WINDOW_HANDLED_ACTIONS is the window dispatcher’s set, and WINDOW_MULTI_STROKE_ACTIONS is the same set', () => {
    expect([...WINDOW_HANDLED_ACTIONS].sort()).toEqual(
      [
        'zoom.in', 'zoom.out', 'zoom.reset', 'panel.zoomIn', 'panel.zoomOut', 'panel.zoomReset',
        'focus.left', 'focus.right', 'focus.up', 'focus.down', 'focus.cycle', 'focus.cycleBack',
        'focus.notice', 'view.fullscreen', 'view.toggleProjects', 'view.toggleExplorer', 'menu.open',
        'file.undo', 'file.redo', 'project.next', 'project.previous', 'focus.explorer', 'focus.projects',
        'focus.workspace', 'tabs.openPicker', 'navigate.quickOpen', 'navigate.gotoLine',
        'search.findInFiles', 'search.replaceInFiles', 'navigate.back', 'navigate.forward',
        'panel.splitDown', 'panel.splitUp', 'panel.splitRight', 'panel.splitLeft', 'panel.destroy',
        'panel.toggleMaximise',
      ].sort(),
    );
    expect(WINDOW_MULTI_STROKE_ACTIONS).toBe(WINDOW_HANDLED_ACTIONS);
  });

  it('terminalMultiStrokeAllowed: a window-handled command with a non-reserved first stroke only', () => {
    expect(terminalMultiStrokeAllowed('panel.zoomIn', 'Ctrl+Shift+Alt+Home,Z')).toBe(true);
    expect(terminalMultiStrokeAllowed('panel.zoomIn', 'Ctrl+E,Z')).toBe(false);
    expect(terminalMultiStrokeAllowed('panel.splitDown', 'Ctrl+K,H')).toBe(false);
    // terminal.redraw is live in a terminal but no window engine runs it.
    expect(terminalMultiStrokeAllowed('terminal.redraw', 'Ctrl+Alt+K,H')).toBe(false);
    // A command never live in a terminal is not this predicate's concern.
    expect(terminalMultiStrokeAllowed('editor.toggleWordWrap', 'Ctrl+E,W')).toBe(true);
  });

  it('parseKeybindings keeps a window command’s multi-stroke override and drops the refused ones', () => {
    const kb = parseKeybindings({ bindings: { 'panel.zoomIn': ['Ctrl+Shift+Alt+Home,Z', 'Ctrl+E,Z'] } });
    expect(kb.bindings['panel.zoomIn']).toEqual(['Ctrl+Shift+Alt+Home,Z']);
    const redraw = parseKeybindings({ bindings: { 'terminal.redraw': ['Ctrl+Alt+K,H', 'Ctrl+F5'] } });
    expect(redraw.bindings['terminal.redraw']).toEqual(['Ctrl+F5']);
    expect(twoStrokeTerminalViolations({ 'terminal.redraw': ['Ctrl+Alt+K,H'], 'panel.zoomIn': ['Ctrl+E,Z'] })).toEqual([
      { action: 'terminal.redraw', token: 'Ctrl+Alt+K,H' },
      { action: 'panel.zoomIn', token: 'Ctrl+E,Z' },
    ]);
  });

  it('parseKeybindings keeps a multi-stroke override of panel.splitDown and drops one with a reserved first stroke', () => {
    const kept = parseKeybindings({ bindings: { 'panel.splitDown': ['Ctrl+Shift+Alt+Home,J'] } });
    expect(kept.bindings['panel.splitDown']).toEqual(['Ctrl+Shift+Alt+Home,J']);
    const dropped = parseKeybindings({ bindings: { 'panel.splitDown': ['Ctrl+K,J', 'Ctrl+Alt+Home,J'] } });
    expect(dropped.bindings['panel.splitDown']).toEqual(['Ctrl+Alt+Home,J']);
  });
});
