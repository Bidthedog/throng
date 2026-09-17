/**
 * The four preview and navigation commands, and the fifth dispatch scope they need (044, FR-005,
 * FR-021, FR-096c, FR-105; contracts/settings-bindings-tokens.md "Key bindings").
 *
 * ══ THE CHORD TOKENS ARE `Alt+ArrowLeft`, NOT `Alt+Left` ══
 *
 * The spec and the contract write the chord as a person says it. A binding TOKEN has to equal what
 * `eventToToken` builds from a real keydown, and the DOM reports the arrow as `ArrowLeft` — which is
 * why every shipped arrow chord in `keybindings.ts` is spelled `…ArrowLeft`. A token of `Alt+Left`
 * would compile, ship, show in the Key Bindings editor, and never match a keypress. So the tests
 * below resolve a real event rather than only reading the stored string.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  chordCollisions,
  resolveAction,
  scopeNames,
  type ActionId,
  type DispatchScope,
} from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

const PREVIEW_ACTIONS = ['preview.open', 'navigate.back', 'navigate.forward', 'preview.followLink'] as const;

const scopesOf = (action: string): string[] => [...(COMMAND_SCOPES[action as ActionId] ?? [])].sort();

describe('the four commands, their scopes and chords (FR-005, FR-096c, FR-105)', () => {
  it('registers preview.open unbound, live in an editor and the file tree', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['preview.open']).toEqual([]);
    expect(scopesOf('preview.open')).toEqual(['editor', 'explorer']);
  });

  it('binds Back to Alt+Left and Forward to Alt+Right, live in an editor and a preview', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['navigate.back']).toEqual(['Alt+ArrowLeft']);
    expect(DEFAULT_KEYBINDINGS.bindings['navigate.forward']).toEqual(['Alt+ArrowRight']);
    expect(scopesOf('navigate.back')).toEqual(['editor', 'preview']);
    expect(scopesOf('navigate.forward')).toEqual(['editor', 'preview']);
  });

  it('binds Open Link to Ctrl+Enter, live in a preview only', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['preview.followLink']).toEqual(['Ctrl+Enter']);
    expect(scopesOf('preview.followLink')).toEqual(['preview']);
  });

  it('resolves a REAL Alt+ArrowLeft / Alt+ArrowRight keydown in both scopes', () => {
    for (const scope of ['editor', 'preview'] as DispatchScope[]) {
      expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'ArrowLeft', alt: true }, scope), scope).toBe('navigate.back');
      expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'ArrowRight', alt: true }, scope), scope).toBe(
        'navigate.forward',
      );
    }
  });

  it('resolves a real Ctrl+Enter to Open Link in a preview, and to nothing in an editor', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', ctrl: true }, 'preview')).toBe('preview.followLink');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', ctrl: true }, 'editor')).toBeNull();
  });

  it('scopes none of the four to a terminal — a shell keeps Alt+Arrow and Ctrl+Enter', () => {
    for (const action of PREVIEW_ACTIONS) {
      expect(COMMAND_SCOPES[action as ActionId]?.has('terminal'), action).toBe(false);
    }
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'ArrowLeft', alt: true }, 'terminal')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', ctrl: true }, 'terminal')).toBeNull();
  });
});

/*
 * 2026-09-16 iteration (FR-122d; contracts/settings-bindings-tokens.md "Key binding — one new"). One
 * command flips the one global scroll-sync setting from wherever an editor or a preview has focus. It
 * ships unbound, so no chord is taken from anyone; its scope is exactly the two panel kinds that can
 * show the toggle, so no terminal or tree ever resolves it (Principle IV).
 */
describe('preview.toggleSyncScroll (FR-122d)', () => {
  it('exists and ships unbound', () => {
    expect(Object.keys(DEFAULT_KEYBINDINGS.bindings)).toContain('preview.toggleSyncScroll');
    expect(DEFAULT_KEYBINDINGS.bindings['preview.toggleSyncScroll']).toEqual([]);
  });

  it('is live in an editor and a preview, and nowhere else', () => {
    expect(scopesOf('preview.toggleSyncScroll')).toEqual(['editor', 'preview']);
    const scopes = COMMAND_SCOPES['preview.toggleSyncScroll' as ActionId];
    expect(scopes?.has('terminal')).toBe(false);
    expect(scopes?.has('explorer')).toBe(false);
  });

  it('resolves a user-bound chord in an editor and a preview, and not in a terminal or the tree', () => {
    const bound = { ...DEFAULT_KEYBINDINGS, bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'preview.toggleSyncScroll': ['Ctrl+Alt+F8'] } };
    const chord = { key: 'F8', ctrl: true, alt: true };
    expect(resolveAction(bound, chord, 'editor')).toBe('preview.toggleSyncScroll');
    expect(resolveAction(bound, chord, 'preview')).toBe('preview.toggleSyncScroll');
    expect(resolveAction(bound, chord, 'terminal')).toBeNull();
    expect(resolveAction(bound, chord, 'explorer')).toBeNull();
  });

  it('is described once, as "Synchronise Scrolling" under Editor', () => {
    const matches = KEYBINDINGS_METADATA.filter((d) => d.key === 'preview.toggleSyncScroll');
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe('Synchronise Scrolling');
    expect(matches[0].group).toBe('Editor');
    expect(matches[0].control).toBe('chord');
    expect(matches[0].scope).toEqual(['editor', 'preview']);
  });
});

describe("'preview' is a dispatch scope", () => {
  it('is in EVERYWHERE — every window-level command stays live in a preview', () => {
    for (const action of ['zoom.in', 'panel.zoomIn', 'focus.left', 'view.fullscreen', 'navigate.quickOpen']) {
      expect(COMMAND_SCOPES[action as ActionId].has('preview'), action).toBe(true);
    }
    // …and a full set still collapses to ONE pill, so SCOPE_ORDER carries the new scope too.
    expect(scopeNames(COMMAND_SCOPES['zoom.in'])).toEqual(['Everywhere']);
  });

  it('has a name of its own in the Key Bindings editor', () => {
    expect(scopeNames(COMMAND_SCOPES['navigate.back'])).toEqual(['Editor', 'Preview']);
    expect(scopeNames(COMMAND_SCOPES['preview.followLink'])).toEqual(['Preview']);
  });

  it('leaves the file, save, find and rename commands dead in a preview (FR-021, FR-030)', () => {
    for (const action of ['file.delete', 'file.rename', 'file.cut', 'file.copy', 'editor.save', 'search.find', 'panel.rename']) {
      expect(COMMAND_SCOPES[action as ActionId].has('preview'), action).toBe(false);
    }
  });
});

describe('no collision in an overlapping scope', () => {
  it('leaves the shipped set collision-free', () => {
    expect(chordCollisions(DEFAULT_KEYBINDINGS.bindings, COMMAND_SCOPES)).toEqual([]);
  });

  it('keeps Alt+Enter and Ctrl+Alt+Enter on the replace commands, out of the preview scope', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', alt: true }, 'editor')).toBe('search.replaceCurrent');
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', alt: true }, 'preview')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Enter', ctrl: true, alt: true }, 'preview')).toBeNull();
  });
});

describe('one Key Bindings descriptor each, under Navigate', () => {
  const LABELS: Record<(typeof PREVIEW_ACTIONS)[number], string> = {
    'preview.open': 'Open Preview',
    'navigate.back': 'Back',
    'navigate.forward': 'Forward',
    'preview.followLink': 'Open Link',
  };

  for (const action of PREVIEW_ACTIONS) {
    it(`describes ${action} as "${LABELS[action]}" in Navigate`, () => {
      const matches = KEYBINDINGS_METADATA.filter((d) => d.key === action);
      expect(matches).toHaveLength(1);
      expect(matches[0].group).toBe('Navigate');
      expect(matches[0].label).toBe(LABELS[action]);
      expect(matches[0].control).toBe('chord');
      expect(matches[0].scope).toEqual(scopesOf(action));
    });
  }
});
