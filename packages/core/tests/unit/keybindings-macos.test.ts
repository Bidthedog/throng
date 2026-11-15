/**
 * macOS shipped bindings (070 FR-029, contracts/keybindings-macos.md, research R21).
 *
 * `MACOS_BINDINGS` is derived, never hand-written: every Ctrl in the Windows table becomes Cmd (`Meta`), then the
 * actions whose Cmd form macOS keeps for itself take an override. These are the contract's six invariants.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  MACOS_BINDING_OVERRIDES,
  MACOS_BINDINGS,
  MACOS_RESERVED_CHORDS,
  RESERVED_TERMINAL_CHORDS,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
  chordCollisions,
  chordLabel,
  ctrlToMeta,
  eventToToken,
  normalizeToken,
  resolveAction,
  shippedBindingsFor,
  macosHostTraits,
  splitStrokes,
  type ActionId,
} from '../../src/index.js';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';
import { withHostTraits } from '../../src/testing/with-host-traits.js';

const MACOS = macosHostTraits('/tmp/throng', []);

const windows = shippedBindingsFor('windows');
const mac = shippedBindingsFor('macos');
const firstStroke = (token: string): string => splitStrokes(normalizeToken(token))?.[0] ?? token;

describe('macOS shipped bindings (070 FR-029)', () => {
  it('are their own table, keyed `macos`, with Option as the column-select modifier', () => {
    expect(SHIPPED_KEYBINDINGS_BY_PLATFORM.macos).toBe(MACOS_BINDINGS);
    expect(mac).not.toBe(windows);
    expect(mac.columnSelectModifier).toBe('Alt');
  });

  it('turns Ctrl into Cmd in every stroke and keeps every other modifier', () => {
    expect(ctrlToMeta('Ctrl+S')).toBe('Meta+S');
    expect(ctrlToMeta('Ctrl+Shift+Alt+ArrowUp')).toBe('Shift+Alt+Meta+ArrowUp');
    expect(ctrlToMeta('Ctrl+Alt++')).toBe('Alt+Meta++');
    expect(ctrlToMeta('Ctrl+E,W')).toBe('Meta+E,W');
    expect(ctrlToMeta('Ctrl+WheelUp')).toBe('Meta+WheelUp');
    expect(ctrlToMeta('Shift+Alt+Enter')).toBe('Shift+Alt+Enter');
    expect(ctrlToMeta('F2')).toBe('F2');
  });

  // Invariant 1.
  it('give every action in the key bindings list a macOS default, with the same action ids', () => {
    expect(Object.keys(mac.bindings).sort()).toEqual(Object.keys(windows.bindings).sort());
    for (const d of KEYBINDINGS_METADATA) {
      expect(mac.bindings[d.key], d.key).toBeDefined();
      // An action Windows leaves unbound stays unbound; one Windows binds is bound on macOS too.
      if ((windows.bindings[d.key] ?? []).length > 0) expect(mac.bindings[d.key]?.length, d.key).toBeGreaterThan(0);
    }
  });

  // Invariant 2.
  it('leave no default on a chord macOS reserves, nor a multi-key chord starting with one', () => {
    const reserved = new Set(MACOS_RESERVED_CHORDS.map(normalizeToken));
    const taken = Object.entries(mac.bindings).flatMap(([action, tokens]) =>
      tokens.filter((t) => reserved.has(firstStroke(t))).map((t) => `${action}: ${t}`),
    );
    expect(taken).toEqual([]);
  });

  it('name the reserved chords from research R21', () => {
    for (const chord of [
      'Meta+Tab',
      'Meta+Space',
      'Meta+H',
      'Alt+Meta+H',
      'Meta+M',
      'Meta+Q',
      'Meta+`',
      'Alt+Meta+Escape',
      'Shift+Meta+3',
      'Shift+Meta+4',
      'Shift+Meta+5',
      'Ctrl+Meta+Q',
      'Alt+Meta+D',
      'Ctrl+ArrowLeft',
      'Ctrl+ArrowRight',
      'Ctrl+ArrowUp',
      'Ctrl+ArrowDown',
      'Ctrl+Space',
    ]) {
      expect(MACOS_RESERVED_CHORDS, chord).toContain(chord);
    }
  });

  it('enter full screen with the system chord, Ctrl+Cmd+F, and leave F11 to Show Desktop', () => {
    expect(mac.bindings['view.fullscreen']).toEqual(['Ctrl+Meta+F']);
    // Reserved for this very action, so it is bound, not refused.
    expect(MACOS_RESERVED_CHORDS).not.toContain('Ctrl+Meta+F');
    expect(MACOS_RESERVED_CHORDS).toContain('F11');
    expect(windows.bindings['view.fullscreen']).toEqual(['F11']);
  });

  it('offer the app menu’s commands in the Key Bindings editor on macOS only, so Windows and Linux gain no row (FR-039)', () => {
    const appCommands = KEYBINDINGS_METADATA.filter((d) => d.key.startsWith('app.'));
    expect(appCommands.map((d) => d.key).sort()).toEqual(['app.installCommandLine', 'app.settings', 'app.uninstallCommandLine']);
    expect(appCommands.filter((d) => d.onlyOn !== 'macos').map((d) => d.key)).toEqual([]);
  });

  // Invariant 3.
  it('have no two defaults on one chord where both are live', () => {
    expect(chordCollisions(mac.bindings)).toEqual([]);
  });

  // Invariant 4.
  it('take no terminal-reserved chord in a scope live in a terminal, so the shell keeps its Ctrl keys', () => {
    const taken = Object.entries(mac.bindings).flatMap(([action, tokens]) =>
      COMMAND_SCOPES[action as ActionId]?.has('terminal')
        ? tokens.filter((t) => RESERVED_TERMINAL_CHORDS.has(firstStroke(t))).map((t) => `${action}: ${t}`)
        : [],
    );
    expect(taken).toEqual([]);
  });

  it('differ from the plain Ctrl-to-Cmd form only where an override says so', () => {
    for (const [action, tokens] of Object.entries(windows.bindings)) {
      const derived = tokens.map(ctrlToMeta);
      if (action in MACOS_BINDING_OVERRIDES) {
        expect(mac.bindings[action], action).toEqual([...(MACOS_BINDING_OVERRIDES[action] ?? [])]);
        expect(mac.bindings[action], `${action}'s override must differ from its derived chord`).not.toEqual(derived);
      } else {
        expect(mac.bindings[action], action).toEqual(derived);
      }
    }
  });

  it('override every action whose derived chord macOS reserves', () => {
    const reserved = new Set(MACOS_RESERVED_CHORDS.map(normalizeToken));
    for (const [action, tokens] of Object.entries(windows.bindings)) {
      if (tokens.map(ctrlToMeta).some((t) => reserved.has(firstStroke(t)))) {
        expect(Object.keys(MACOS_BINDING_OVERRIDES), action).toContain(action);
      }
    }
  });

  // Invariant 5.
  it('list every override in the key bindings docs, under the macOS section', () => {
    const doc = readFileSync(new URL('../../../../docs/key-bindings.md', import.meta.url), 'utf8');
    const start = doc.indexOf('## On macOS');
    expect(start, 'docs/key-bindings.md has no "## On macOS" section').toBeGreaterThanOrEqual(0);
    const next = doc.indexOf('\n## ', start + 1);
    const section = doc.slice(start, next < 0 ? undefined : next);
    for (const [action, tokens] of Object.entries(MACOS_BINDING_OVERRIDES)) {
      for (const token of tokens) {
        const label = chordLabel(token, 'macos');
        // A chord holding a backtick is written as a double-backtick code span, as the rest of the page does.
        const span = label.includes('`') ? `\`\` ${label} \`\`` : `\`${label}\``;
        expect(section, `${action}'s macOS default ${label}`).toContain(span);
      }
    }
  });

  // Invariant 6.
  it('leave the Windows and Linux tables free of Cmd', () => {
    for (const platform of ['windows', 'linux'] as const) {
      const meta = Object.entries(shippedBindingsFor(platform).bindings).flatMap(([action, tokens]) =>
        tokens.filter((t) => t.includes('Meta')).map((t) => `${action}: ${t}`),
      );
      expect(meta, platform).toEqual([]);
    }
    expect(windows.bindings['file.copy']).toEqual(['Ctrl+C']);
    expect(windows.bindings['search.replace']).toEqual(['Ctrl+H']);
    expect(windows.bindings['focus.cycle']).toEqual(['Ctrl+`']);
  });

  it('are what a macOS process resolves', () => {
    withHostTraits(MACOS, () => {
      expect(DEFAULT_KEYBINDINGS.bindings).toEqual(mac.bindings);
      expect(resolveAction(DEFAULT_KEYBINDINGS, { meta: true, key: 's' }, 'editor')).toBe('editor.save');
      expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, key: 's' }, 'editor')).toBeNull();
    });
    expect(resolveAction(DEFAULT_KEYBINDINGS, { ctrl: true, key: 's' }, 'editor')).toBe('editor.save');
  });
});

describe('Meta in a token (070 FR-029)', () => {
  it('is built by eventToToken last, after Alt, in canonical order', () => {
    expect(eventToToken({ meta: true, key: 's' })).toBe('Meta+s');
    expect(eventToToken({ ctrl: true, shift: true, alt: true, meta: true, key: 'k' })).toBe('Ctrl+Shift+Alt+Meta+k');
  });

  it('reads as Cmd and Alt as Option on macOS, in Apple’s modifier order, and unchanged elsewhere', () => {
    expect(chordLabel('Meta+S', 'macos')).toBe('Cmd+S');
    expect(chordLabel('Shift+Alt+Meta+K', 'macos')).toBe('Option+Shift+Cmd+K');
    expect(chordLabel('Ctrl+Shift+Alt+Meta+K', 'macos')).toBe('Ctrl+Option+Shift+Cmd+K');
    expect(chordLabel('Alt+Meta++', 'macos')).toBe('Option+Cmd++');
    expect(chordLabel('Ctrl+M,M', 'macos')).toBe('Ctrl+M,M');
    expect(chordLabel('Meta+E,Shift+W', 'macos')).toBe('Cmd+E,Shift+W');
    expect(chordLabel('Ctrl+Shift+Alt+K', 'windows')).toBe('Ctrl+Shift+Alt+K');
    expect(chordLabel('Ctrl+Shift+Alt+K', 'linux')).toBe('Ctrl+Shift+Alt+K');
  });
});
