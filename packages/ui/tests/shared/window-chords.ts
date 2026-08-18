/**
 * The window-level chord allowlist, DISCOVERED from `app.tsx` rather than written down.
 *
 * Lifted out of `packages/ui/tests/e2e/window-chord-resolution.e2e.ts` (034 FR-045) so that the
 * manifest check — which presses no key, opens no window and reads two files — can live at the unit
 * layer while the chords it names are still pressed end to end. Both layers import this module, so
 * there is exactly one definition of "which chords the widening can reach" and no chance of the
 * guard and the tests drifting apart while each stays green.
 *
 * ══ WHAT THE WIDENING WAS ══
 *
 * The dispatcher in `packages/ui/src/renderer/app.tsx` used to DROP Shift for every key but the
 * backtick and the function keys, reasoning that the produced character already encodes it (`Ctrl++`
 * is really Ctrl+Shift+`=`). That does not hold for LETTERS: `normalizeToken` folds `T` and `t`
 * together on purpose, so for A–Z the shifted character encodes nothing and dropping the modifier
 * loses the chord. `Ctrl+Shift+T` (Quick Open) arrived at the resolver as `Ctrl+T`, matched no
 * binding, and did nothing at all. The fix widened the exception to a third branch:
 *
 *     const keepShift = backtick || /^F\d{1,2}$/.test(e.key) || /^[a-z]$/i.test(e.key);
 *
 * One line, and it changed how the event is BUILT for every command in the same listener's `HANDLED`
 * allowlist. Nothing in that set announces a regression: an event built with one modifier too many
 * resolves to `null`, `HANDLED.has(null)` is false, the listener returns, and the chord is simply
 * inert. No throw, no log, no visible failure.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shippedBindingsFor } from '@throng/core';

/** The dispatcher whose allowlist is the subject. */
export const APP_TSX = fileURLToPath(new URL('../../src/renderer/app.tsx', import.meta.url));

/** Where the end-to-end specs live, for resolving a `COVERED_ELSEWHERE` exemption. */
export const E2E_DIR = fileURLToPath(new URL('../e2e/', import.meta.url));

/**
 * The action ids in `app.tsx`'s `HANDLED` set.
 *
 * Half the entries are string literals and half are module constants (`TABS_OPEN_PICKER`,
 * `QUICK_OPEN`, `GOTO_LINE`), so the identifiers are resolved against their declarations in the same
 * file. Every failure mode here THROWS rather than returning a short list: a scanner that quietly
 * finds nothing reports a clean bill of health for an allowlist it never read, which is the same
 * defect as the vacuous guard that FR-053a is about.
 */
export function handledActions(): string[] {
  const src = readFileSync(APP_TSX, 'utf8');
  const block = /const HANDLED:[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!block) {
    throw new Error(
      `could not find the HANDLED set in ${APP_TSX} — the dispatcher was restructured, and this ` +
        `guard is no longer reading the allowlist it claims to cover`,
    );
  }
  const entries = (block[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim().replace(/,$/, ''))
    .filter((line) => line.length > 0);
  const actions = entries.map((entry) => {
    const literal = /^'([^']+)'$/.exec(entry) ?? /^"([^"]+)"$/.exec(entry);
    if (literal) return literal[1] as string;
    const decl = new RegExp(String.raw`const ${entry}\s*:[^=]*=\s*'([^']+)'`).exec(src);
    if (!decl) {
      throw new Error(`HANDLED entry \`${entry}\` is neither a literal nor a resolvable constant`);
    }
    return decl[1] as string;
  });
  if (actions.length === 0) throw new Error('the HANDLED set parsed as empty');
  return actions;
}

/** The key segment of a binding token — everything after the modifiers. `Ctrl++` → `+`. */
export function keyOf(token: string): string {
  let rest = token;
  for (;;) {
    const mod = /^(Ctrl|Control|Shift|Alt|Meta)\+(?=.)/.exec(rest);
    if (!mod) return rest;
    rest = rest.slice(mod[0].length);
  }
}

/**
 * The dispatcher's three `keepShift` branches, restated against a BINDING token.
 *
 * `app.tsx` asks the live event; this asks the chord the event would have to be. The two agree by
 * construction: `chordKey` normalises the physical Backquote to `` ` `` whatever it produced, a
 * function key's `e.key` is its own name, and a letter chord's `e.key` is that letter with case
 * folded away by `normalizeToken`. Restated rather than imported because it is not exported — and
 * `handledActions()` above would catch the dispatcher being restructured underneath it.
 */
export function keepsShift(key: string): boolean {
  return key === '`' || /^F\d{1,2}$/.test(key) || /^[a-z]$/i.test(key);
}

/** Every HANDLED action whose shipped chord goes through one of those branches, with those chords. */
export function discoverKeepShiftChords(): Map<string, string[]> {
  const bindings = shippedBindingsFor().bindings;
  const found = new Map<string, string[]>();
  for (const action of handledActions()) {
    const chords = (bindings[action] ?? []).filter((token) => keepsShift(keyOf(token)));
    if (chords.length > 0) found.set(action, chords);
  }
  return found;
}

/**
 * The actions the end-to-end file presses, each against the test that presses it.
 *
 * The value is documentation for whoever reads a failure of the manifest guard; the KEY is the part
 * that is checked.
 */
export const COVERED: ReadonlyMap<string, string> = new Map([
  ['view.toggleProjects', 'the two pane toggles'],
  ['view.toggleExplorer', 'the two pane toggles'],
  ['tabs.openPicker', 'the tab picker'],
  ['navigate.quickOpen', 'Quick Open — the chord the widening was made for'],
  ['navigate.gotoLine', 'Go To Line over the active editor'],
  ['panel.rename', 'the active panel’s rename box'],
  ['file.undo', 'undo and redo a file operation'],
  ['file.redo', 'undo and redo a file operation'],
  ['focus.cycle', 'cycling panel focus both ways'],
  ['focus.cycleBack', 'cycling panel focus both ways'],
  ['view.fullscreen', 'fullscreen'],
]);

/**
 * The one action covered ELSEWHERE, named with the file that covers it and checked to still be true.
 *
 * `menu.open` is `Shift+F10`, which takes the function-key branch — so it belongs in the chord file's
 * subject and is deliberately not in it. Asserting it means opening a context menu, and throng closes
 * menus when its window loses focus, which would move that spec into `parallel-plan.json`'s serial
 * list and cost a worker slot for an assertion that already exists a file away.
 *
 * An exemption that names a file is only worth anything while the file still does what it is named
 * for, so the manifest guard reads it and checks the chord is still pressed there. An exemption
 * nobody verifies is how coverage evaporates without anyone deleting a test.
 */
export const COVERED_ELSEWHERE: ReadonlyMap<string, { spec: string; press: string }> = new Map([
  ['menu.open', { spec: 'menu-keyboard.e2e.ts', press: 'Shift+F10' }],
]);

/**
 * A file's CODE, with its comments blanked out — offsets and lines preserved.
 *
 * The exemption above used to be checked with `toContain(chord)`, a raw substring over the whole
 * file. `menu-keyboard.e2e.ts` explains at length, in a block comment, why a `Shift+F10` at that row
 * needs a real guard in front of it — and names the chord three times doing so. So the exemption was
 * satisfied by the PROSE: delete the `keyboard.press('Shift+F10')` the exemption exists to point at
 * and the check stays green, which makes it an assertion about documentation.
 *
 * Strings are tracked so a `//` inside one does not blank the rest of its line; a template literal
 * spanning lines is the one case this does not follow, and it can only ever hide a comment, never
 * eat code.
 */
export function codeOnly(src: string): string {
  const blanked = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return blanked
    .split('\n')
    .map((line) => {
      let quote = '';
      for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (quote !== '') {
          if (c === '\\') i += 1;
          else if (c === quote) quote = '';
          continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** `keyboard.press('<chord>')` — the keystroke itself, not a mention of it. */
export function pressesChord(src: string, chord: string): boolean {
  const literal = chord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(String.raw`keyboard\s*\.\s*press\(\s*['"\`]${literal}['"\`]`).test(src);
}
