/**
 * Dispatch scope (016, FR-017b0/FR-017c/FR-024).
 *
 * Without this, `cut-line` provably never fires: `resolveAction` returns the FIRST match in map
 * order, `file.*` precedes `editor.*`, and both want `Ctrl+X` — so inside an editor the Explorer's
 * `file.cut` wins and the headline binding of US3 is dead on arrival.
 *
 * A command's scope set is DECLARED and NON-EMPTY. There is no default: a command with no scope
 * would be live everywhere, which is how a text-editing chord ends up cutting a file.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  resolveAction,
  type ActionId,
  type DispatchScope,
} from '../../src/config/keybindings.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';

const CTRL_X = { key: 'x', ctrl: true } as const;
const ACTION_IDS = Object.keys(DEFAULT_KEYBINDINGS.bindings) as ActionId[];

describe('scope-aware resolveAction (FR-017b0)', () => {
  it('resolves Ctrl+X to the editor cut-line inside an EDITOR', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, CTRL_X, 'editor')).toBe('editor.cutLine');
  });

  it('resolves the same Ctrl+X to file.cut inside the EXPLORER — the scopes are disjoint', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, CTRL_X, 'explorer')).toBe('file.cut');
  });

  it('resolves neither in a TERMINAL — Ctrl+X belongs to the shell (FR-017d)', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, CTRL_X, 'terminal')).toBeNull();
  });

  it('keeps a window-level chord live in every scope', () => {
    for (const scope of ['editor', 'terminal', 'explorer'] as DispatchScope[]) {
      expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'ArrowLeft', ctrl: true, alt: true }, scope)).toBe(
        'focus.left',
      );
    }
  });

  it('does not fire an editor command while a terminal is active', () => {
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Tab' }, 'terminal')).toBeNull();
    expect(resolveAction(DEFAULT_KEYBINDINGS, { key: 'Tab' }, 'editor')).toBe('editor.indentLines');
  });
});

describe('scope completeness (FR-017b0 — there is no default)', () => {
  it('declares a NON-EMPTY scope set for every registered command', () => {
    for (const action of ACTION_IDS) {
      const scopes = COMMAND_SCOPES[action as ActionId];
      expect(scopes, `no scope declared for "${action}"`).toBeDefined();
      expect(scopes.size, `empty scope set for "${action}"`).toBeGreaterThan(0);
    }
  });

  it('declares a scope for nothing that is not a registered command', () => {
    expect(Object.keys(COMMAND_SCOPES).sort()).toEqual([...ACTION_IDS].sort());
  });

  it('surfaces the scope in the Key Bindings editor metadata, so a user can see WHY Ctrl+X appears twice', () => {
    for (const d of KEYBINDINGS_METADATA) {
      expect(d.scope, `no scope on the descriptor for "${d.key}"`).toBeDefined();
      expect(d.scope?.length, d.key).toBeGreaterThan(0);
    }
  });
});

describe('registered commands (FR-017c — the absence is the requirement)', () => {
  const NEW_COMMANDS = [
    'editor.cutLine',
    'editor.indentLines',
    'editor.outdentLines',
    'editor.columnSelectUp',
    'editor.columnSelectDown',
    'editor.columnSelectLeft',
    'editor.columnSelectRight',
    // 024 US1 (#152): a genuine new editor command — NOT one of the banned clipboard/undo commands
    // FR-017c guards against (those still keep their native OS bindings; see the ABSENCE test below).
    'editor.toggleWordWrap',
  ];

  it('registers EXACTLY the expected editor commands (the seven from 016 + word-wrap), no more', () => {
    const editorCommands = ACTION_IDS.filter(
      (a) => a.startsWith('editor.') && !a.startsWith('editor.save'),
    );
    expect(editorCommands.sort()).toEqual([...NEW_COMMANDS].sort());
  });

  it('scopes each editor-only command to the editor alone', () => {
    for (const action of NEW_COMMANDS) {
      expect([...COMMAND_SCOPES[action as ActionId]], action).toEqual(['editor']);
    }
  });

  it('does NOT register Cut, Copy, Paste, Select All, Undo or Redo — they keep their native OS bindings', () => {
    // This is an assertion of ABSENCE, and it is the point of FR-017c: registering them would take
    // them out of the OS's hands and break interoperability with everything outside throng. They must
    // not exist as commands, and must not appear in the Key Bindings editor.
    const banned = [
      'editor.cut',
      'editor.copy',
      'editor.paste',
      'editor.selectAll',
      'editor.undo',
      'editor.redo',
    ];
    for (const id of banned) {
      expect(ACTION_IDS, `"${id}" must NOT be a registered command`).not.toContain(id);
      expect(
        KEYBINDINGS_METADATA.map((d) => d.key),
        `"${id}" must NOT appear in the Key Bindings editor`,
      ).not.toContain(id);
    }
  });
});
