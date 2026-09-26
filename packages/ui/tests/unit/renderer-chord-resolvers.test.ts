/**
 * 046 FR-026 — every renderer site that resolves a chord from a keydown goes through the ONE helper
 * that matches a digit physically (`resolveKeydown` in `renderer/config/chord-key.ts`).
 *
 * US3 first taught only the window dispatcher to match `Ctrl+Shift+0` on `Digit0`, while the capture
 * modal records the physical digit for EVERY command — so the editor's save chords, the terminal's
 * find reservation, the in-menu shortcuts and five other resolvers could be handed a chord they had
 * no way to match (review, fix round item 1). A resolver added later that builds its token from
 * `e.key` again would reopen exactly that hole without a single test noticing, so this guard does
 * not list the resolvers: it DISCOVERS every call to the three resolving functions across the
 * renderer, and fails for any whose argument is read straight off a keyboard event.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, shippedBindingsFor } from '@throng/core';
import { resolveKeydown } from '../../src/renderer/config/chord-key.js';
import { resolveScoped } from '../../src/renderer/keybindings/scope.js';
import { codeOnly } from '../shared/window-chords.js';
import { chordEvent, chordEventOnLayout, type Layout } from '../shared/chord-event.js';

const RENDERER = fileURLToPath(new URL('../../src/renderer/', import.meta.url));

/** The functions that turn a key event into an action or a token. */
const RESOLVERS = ['resolveAction', 'resolveScoped', 'eventToToken'] as const;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** The text between a call's parentheses, found by counting them. */
function argumentsAt(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced call');
}

interface CallSite {
  file: string;
  line: number;
  fn: string;
  args: string;
}

function callSites(): CallSite[] {
  const found: CallSite[] = [];
  for (const file of sources(RENDERER)) {
    const code = codeOnly(readFileSync(file, 'utf8'));
    for (const fn of RESOLVERS) {
      const re = new RegExp(String.raw`\b${fn}\s*\(`, 'g');
      for (let m = re.exec(code); m; m = re.exec(code)) {
        // A declaration (`export function resolveScoped(`) is not a call.
        if (/function\s+$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
        const open = m.index + m[0].length - 1;
        found.push({
          file: relative(RENDERER, file).replace(/\\/g, '/'),
          line: code.slice(0, m.index).split('\n').length,
          fn,
          args: argumentsAt(code, open),
        });
      }
    }
  }
  return found;
}

/** A key read straight off an event — `e.key`, `ev.key`, `event.key` — or the old backtick helper. */
const READS_EVENT_KEY = /\b(?:e|ev|evt|event|keyEvent)\.key\b|\bchordKey\s*\(/;

describe('every renderer chord resolver matches a digit physically (046 FR-026)', () => {
  it('finds the resolvers it is guarding — the discovery is not vacuous', () => {
    const sites = callSites();
    const files = new Set(sites.map((s) => s.file));
    // Nine files resolved a chord when this guard was written; fewer means the scan broke.
    expect(files.size, `resolver call sites found in: ${[...files].join(', ')}`).toBeGreaterThanOrEqual(8);
  });

  it('no call builds its chord from the event’s own key — each goes through resolveKeydown', () => {
    const offenders = callSites()
      .filter((s) => READS_EVENT_KEY.test(s.args))
      .map((s) => `${s.file}:${s.line} ${s.fn}(${s.args.replace(/\s+/g, ' ').slice(0, 80)}…)`);
    expect(
      offenders,
      'These resolve a chord from e.key directly, so a digit chord the capture modal recorded ' +
        'physically (Ctrl+Shift+1, not Ctrl+Shift+!) can never match there. Wrap the call in ' +
        'resolveKeydown(e, (ev) => …) from renderer/config/chord-key.ts.',
    ).toEqual([]);
  });

  it('reads an event key the way the offending sites did — the pattern is not vacuous', () => {
    expect(READS_EVENT_KEY.test('keybindings, { key: e.key, ctrl: e.ctrlKey }, scope')).toBe(true);
    expect(READS_EVENT_KEY.test('keybindings, { key: chordKey(e), ctrl: e.ctrlKey }')).toBe(true);
    expect(READS_EVENT_KEY.test('keybindings, ev, scope')).toBe(false);
  });
});

/**
 * 046 iterate round 1 (T106, FR-109 bullet 1) — every shipped `Ctrl+Shift+Alt` default resolves
 * through the ONE shared helper (`resolveKeydown` over `chordCandidates`) that every call site the
 * guard above discovers goes through, on all five layouts R22 names, and the keypad `+`/`-`/`0`
 * resolve identically to the main-row key (FR-105). Because every discovered site shares
 * `resolveKeydown`, proving it here is proving it at every one of them without re-rendering each
 * one — `physical-key-chords-every-resolver.test.ts` proves the same fact through four of them with
 * real DOM dispatch.
 *
 * `resolveScoped` needs no real tab: every `Ctrl+Shift+Alt` default is scoped EVERYWHERE (R22), so it
 * resolves the same from an empty layout as from any panel.
 */
describe('every Ctrl+Shift+Alt default resolves on all five layouts (046 T106, FR-109 bullet 1)', () => {
  const LAYOUTS: Layout[] = ['US', 'UK', 'German', 'French', 'Polish'];
  const NO_TABS = { tabs: [], activeTabId: null };

  const resolve = (e: ReturnType<typeof chordEventOnLayout>): string | null =>
    resolveKeydown(e, (ev) => resolveScoped(DEFAULT_KEYBINDINGS, ev, NO_TABS, { transientFocus: false }));

  const tier1 = Object.entries(shippedBindingsFor().bindings).flatMap(([action, chords]) =>
    (chords ?? [])
      .filter((chord) => /^Ctrl\+Shift\+Alt\+/.test(chord))
      .map((chord) => ({ action, chord, code: chordEvent(chord).code })),
  );

  it('finds shipped tier-1 defaults to check — the discovery is not vacuous', () => {
    expect(tier1.length, 'no Ctrl+Shift+Alt default found in shippedBindingsFor()').toBeGreaterThan(5);
  });

  for (const { action, chord, code } of tier1) {
    for (const layout of LAYOUTS) {
      it(`${action} (${chord}, physical ${code}) resolves on the ${layout} layout`, () => {
        const e = chordEventOnLayout(layout, code, { ctrlKey: true, shiftKey: true, altKey: true });
        expect(resolve(e)).toBe(action);
      });
    }
  }

  it('a metaKey press resolves none of them (FR-104)', () => {
    for (const { action, code } of tier1) {
      const e = chordEventOnLayout('US', code, { ctrlKey: true, shiftKey: true, altKey: true, metaKey: true });
      expect(resolve(e), action).not.toBe(action);
    }
  });

  it('the keypad + / - resolve the SAME tier-1 default as the main-row key (FR-105)', () => {
    // 046 iterate round 2 (FR-114) narrowed this to `+`/`-`: `zoom.reset` no longer ships a Digit0
    // chord at all (its Numpad0 case is covered on its own, directly, below — Numpad0 no longer
    // aliases Digit0's default).
    const PAD_OF: Readonly<Record<string, string>> = { Equal: 'NumpadAdd', Minus: 'NumpadSubtract' };
    const rows = tier1.filter(({ code }) => code in PAD_OF);
    expect(rows.length, 'no +/- tier-1 default found — the case below would be vacuous').toBeGreaterThan(0);
    for (const { action, code } of rows) {
      const pad = PAD_OF[code] as string;
      const mainEvent = chordEventOnLayout('US', code, { ctrlKey: true, shiftKey: true, altKey: true });
      const padEvent = chordEventOnLayout('US', pad, { ctrlKey: true, shiftKey: true, altKey: true });
      expect(resolve(mainEvent), `${action} main-row`).toBe(action);
      expect(resolve(padEvent), `${action} keypad`).toBe(action);
    }
  });

  /**
   * 046 iterate round 2 (FR-114) — the maintainer's own words, mid-build: "The 'Zoom Reset' key
   * bindings need to use the numpad zero, NOT the 0 key." `zoom.reset` is discovered above via the
   * dynamic `tier1` list (its shipped chord is now `Ctrl+Shift+Alt+Numpad0`, physical code
   * `Numpad0`), so every layout case already proves Numpad0 resolves it. What that loop cannot show
   * is the NEGATIVE — that the main-row Digit0, which used to be the target, no longer is — and that
   * Numpad0 resolves regardless of NumLock (key `'0'` vs the Shift+NumLock quirk `'Insert'`), both
   * asserted directly here.
   */
  it('zoom.reset resolves from Numpad0 regardless of what NumLock makes the key report, and Digit0 no longer resolves it at all', () => {
    // With NumLock on and Shift held, a real keyboard reports key "Insert" for Numpad0 (FR-104's
    // documented quirk); with NumLock off, or without Shift, it reports "0". Either way `code` stays
    // "Numpad0", which is what this round's fix matches on.
    const insertKey = chordEventOnLayout('US', 'Numpad0', { ctrlKey: true, shiftKey: true, altKey: true });
    expect(insertKey.key).toBe('Insert');
    expect(resolve(insertKey)).toBe('zoom.reset');

    const zeroKey = { ...insertKey, key: '0' };
    expect(resolve(zeroKey)).toBe('zoom.reset');

    const mainRow = chordEventOnLayout('US', 'Digit0', { ctrlKey: true, shiftKey: true, altKey: true });
    expect(resolve(mainRow)).not.toBe('zoom.reset');
  });
});
