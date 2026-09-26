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
import { shippedBindingsFor, splitStrokes } from '@throng/core';
import { chordCandidates } from '../../src/renderer/config/chord-key.js';
import { chordEvent, keyOf } from './chord-event.js';

/** The dispatcher whose allowlist is the subject. */
export const APP_TSX = fileURLToPath(new URL('../../src/renderer/app.tsx', import.meta.url));

/** Where the end-to-end specs live, for resolving a `COVERED_ELSEWHERE` exemption. */
export const E2E_DIR = fileURLToPath(new URL('../e2e/', import.meta.url));

/**
 * The action ids in `app.tsx`'s window allowlist.
 *
 * Half the entries are string literals and half are module constants (`TABS_OPEN_PICKER`,
 * `QUICK_OPEN`, `GOTO_LINE`), so the identifiers are resolved against their declarations in the same
 * file. Every failure mode here THROWS rather than returning a short list: a scanner that quietly
 * finds nothing reports a clean bill of health for an allowlist it never read, which is the same
 * defect as the vacuous guard that FR-053a is about.
 *
 * ══ IT IS `WINDOW_HANDLED_ACTIONS` NOW, AND THIS GUARD CAUGHT THE RENAME ══
 *
 * The set was a `const HANDLED` inside the keydown effect until 035 hoisted it to module scope and
 * exported it, so its membership could be asserted without launching the app. This regex still said
 * `const HANDLED:` and threw — with the message above, which named the cause exactly. That is the
 * guard working, and it is worth leaving the mechanism recorded rather than silently retargeted.
 *
 * The constant is EXPORTED now, so a consumer in a DOM environment can import it instead of parsing
 * it. This one cannot: it is a node-env unit guard, and `app.tsx` touches `window` at module scope.
 */
export function handledActions(): string[] {
  return parseHandledActions(readFileSync(APP_TSX, 'utf8'));
}

/** `handledActions` over a given source text — the part that parses, separated so it can be fed. */
export function parseHandledActions(src: string): string[] {
  const block = /const WINDOW_HANDLED_ACTIONS:[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!block) {
    throw new Error(
      `could not find the WINDOW_HANDLED_ACTIONS set in ${APP_TSX} — the dispatcher was ` +
        `restructured, and this guard is no longer reading the allowlist it claims to cover`,
    );
  }
  // Comments go through `codeOnly`, and entries are split on the COMMA, never on the line. The old
  // per-line `/\/\/.*$/` strip could not see past a `\r` (`.` does not match it), so on a CRLF
  // checkout — the hosted runner's — a whole-line comment survived and was read as an entry, while an
  // LF workstation stayed green. Splitting on commas also takes a trailing or inline comment, and two
  // entries on one line, without any line-shaped assumption at all.
  const entries = codeOnly(block[1] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

export { chordEvent, keyOf, type ChordEvent } from './chord-event.js';

/**
 * Whether the dispatcher KEEPS Shift for a chord on this key — asked of `chordCandidates` itself.
 *
 * `app.tsx` asks the live event; this asks the event a US keyboard would produce with Shift held, and
 * reports whether any candidate token still carries the modifier. Imported rather than restated
 * (046 T044): a restated copy of the rule is the one thing that can drift silently, and the digit
 * branch 046 added (`Ctrl+Shift+0`) is exactly a change the old restatement would not have seen.
 * `mods` defaults to Ctrl held and Alt not, the shape of every window chord this guard is about;
 * the digit branch needs both (Alt held is how AltGr types, and excludes it).
 */
export function keepsShift(key: string, mods: { ctrlKey?: boolean; altKey?: boolean } = {}): boolean {
  const e = chordEvent(key, { ctrlKey: mods.ctrlKey ?? true, altKey: mods.altKey ?? false, shiftKey: true });
  return chordCandidates(e).some((token) => /(^|\+)Shift\+/.test(token));
}

/** Every HANDLED action whose shipped chord goes through one of those branches, with those chords. */
export function discoverKeepShiftChords(): Map<string, string[]> {
  const bindings = shippedBindingsFor().bindings;
  const found = new Map<string, string[]>();
  for (const action of handledActions()) {
    const chords = (bindings[action] ?? []).filter((token) => {
      const e = chordEvent(token);
      return keepsShift(keyOf(token), { ctrlKey: e.ctrlKey, altKey: e.altKey });
    });
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
  /*
   * 043 (#220, #153) — find and replace in files, `Ctrl+Shift+F` and `Ctrl+Shift+H`.
   *
   * Both take the LETTER branch, which is the branch that produced this file: `Ctrl+Shift+T`
   * arrived at the resolver as `Ctrl+T`, matched no binding, and was silently inert. Two more
   * chords of exactly that shape are exactly what the manifest guard exists to notice, so they are
   * claimed here rather than exempted — an exemption would have to name a spec that presses them,
   * and the chord spec IS where they belong.
   */
  ['search.findInFiles', 'find in files — the second Ctrl+Shift+<letter> pair'],
  ['search.replaceInFiles', 'replace in files — the same command with replace pre-enabled'],
  /*
   * 046 T049 — both pressed from a focused REAL terminal, which must receive nothing. `zoom.reset`'s
   * shipped chord takes the PHYSICAL code branch `chordCandidates` added (FR-026), and only a real
   * engine reports a genuine `code` for it; `focus.explorer` (`Ctrl+Shift+Alt+M` since 046 iterate
   * round 3, FR-117; `F` before) takes the letter branch and is pressed in the same declaration
   * (analysis H1). 046 iterate round 2 (T164, FR-114) re-pointed the physical key `zoom.reset`
   * presses from Digit0 to Numpad0.
   */
  ['zoom.reset', 'Ctrl+Shift+Alt+Numpad0 from a focused real terminal (046 T049, re-pointed T164)'],
  ['focus.explorer', 'Ctrl+Shift+Alt+M from a focused real terminal (046 T049, re-pointed T181)'],
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
  /*
   * 041 FR-020a — `Ctrl+Shift+Alt+V` (tier 1 since 046 FR-102, on V since iterate round 3's FR-117;
   * `M` before, which is `focus.explorer`'s now) takes the letter branch, so it belongs in this file's subject, and it
   * is deliberately not in it. What the requirement claims is that a REAL SHELL does not swallow the
   * chord, and this file's shared app has no terminal: adding one would make every test in it pay
   * for a `cmd` launch, and the assertion still needs a notice on screen to move focus TO.
   *
   * It lived here for one commit as a press over the focused EDITOR against an empty notice stack,
   * which asserted nothing — an inert binding passes that identically (T062, FR-029). Its real home
   * builds the shell and the notice it needs.
   */
  ['focus.notice', { spec: 'notice-focus-chord.e2e.ts', press: 'Control+Shift+Alt+V' }],
]);

/**
 * The window chords on ARROW keys, covered by a COMPONENT test that presses them through the real
 * `KeybindingsHandler` (044 US7b fix round 1).
 *
 * The arrow branch of `keepShift` was added to stop `Shift+Alt+ArrowLeft` (column select) resolving as
 * `Alt+ArrowLeft` (`navigate.back`). It changed how every arrow chord's event is built, so each is claimed
 * here — at the lowest layer that can press it through the dispatcher, which is jsdom, not Electron. As
 * with `COVERED_ELSEWHERE`, the claim is checked: the named file must press the key with each modifier.
 */
export const COVERED_IN_COMPONENT: ReadonlyMap<string, { test: string; key: string; mods: readonly string[] }> = new Map([
  // 046 iterate round 1 (FR-102): focus.left/right/up/down moved to tier 1.
  ['focus.left', { test: 'window-arrow-chords.test.ts', key: 'ArrowLeft', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  ['focus.right', { test: 'window-arrow-chords.test.ts', key: 'ArrowRight', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  ['focus.up', { test: 'window-arrow-chords.test.ts', key: 'ArrowUp', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  ['focus.down', { test: 'window-arrow-chords.test.ts', key: 'ArrowDown', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  ['navigate.back', { test: 'window-arrow-chords.test.ts', key: 'ArrowLeft', mods: ['altKey'] }],
  ['navigate.forward', { test: 'window-arrow-chords.test.ts', key: 'ArrowRight', mods: ['altKey'] }],
  /*
   * 046 US2 (T033) — `focus.projects` (moved to tier 1 at the iterate round 1 checkpoint, T099; on
   * `Ctrl+Shift+Alt+B` since iterate round 3's FR-117, `P` before) takes the LETTER branch, the shape
   * `window-chord-manifest.test.ts` exists to catch. `focus.explorer` (`Ctrl+Shift+Alt+M`) is claimed
   * in `COVERED` by `focus.explorer`'s E2E instead (T049) — real-engine proof that a focused terminal
   * receives nothing.
   *
   * 046 iterate round 3 (T177, FR-116) — `focus.workspace` (`Ctrl+Shift+Alt+N`) is the same letter
   * shape, claimed by the same file: the component layer is the lowest that mounts the side panes,
   * the workspace and the real `KeybindingsHandler` together, so no E2E is added for it.
   */
  ['focus.projects', { test: 'side-pane-focus-commands.test.ts', key: 'B', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  ['focus.workspace', { test: 'side-pane-focus-commands.test.ts', key: 'N', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  /*
   * 046 iterate round 1 (T106/T111) — `project.next` / `project.previous` moved to the tier-1
   * `Ctrl+Shift+Alt+PageDown` / `Ctrl+Shift+Alt+PageUp` at the same checkpoint (T099), and newly
   * appear in `discoverKeepShiftChords()` once `chordCandidates` gains the tier-1 rule. Pressed,
   * literally, by T033's own file (re-pointed to the tier-1 shape in this same round).
   */
  ['project.next', { test: 'side-pane-focus-commands.test.ts', key: 'PageDown', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  ['project.previous', { test: 'side-pane-focus-commands.test.ts', key: 'PageUp', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  /*
   * 046 iterate round 1 (T106/T111) — the same newly-discovered shape, one namespace along:
   * `zoom.in` / `zoom.out` ship tier-1 (`Ctrl+Shift+Alt++` / `Ctrl+Shift+Alt+-`), and
   * `panel.zoomIn` / `panel.zoomOut` / `panel.zoomReset` ship `Ctrl+Alt` without Shift. Pressed beside
   * `zoom.reset` / `panel.zoomReset`'s existing cases in the same file.
   */
  ['zoom.in', { test: 'window-zoom-reset-shift.test.ts', key: '+', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  ['zoom.out', { test: 'window-zoom-reset-shift.test.ts', key: '_', mods: ['ctrlKey', 'shiftKey', 'altKey'] }],
  ['panel.zoomIn', { test: 'window-zoom-reset-shift.test.ts', key: '=', mods: ['ctrlKey', 'altKey'] }],
  ['panel.zoomOut', { test: 'window-zoom-reset-shift.test.ts', key: '-', mods: ['ctrlKey', 'altKey'] }],
  ['panel.zoomReset', { test: 'window-zoom-reset-shift.test.ts', key: '0', mods: ['ctrlKey', 'altKey'] }],
]);

/** Where the component tests live, for resolving a `COVERED_IN_COMPONENT` claim. */
export const COMPONENT_DIR = fileURLToPath(new URL('../component/', import.meta.url));

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

/**
 * A binding token's key segment, Playwright-cased: `+`, `-` and the digits have no key of their own
 * in Chromium DevTools Protocol's key names, so Playwright presses the PHYSICAL key that types them
 * (046 iterate round 1, T106/T111, FR-104, FR-105) — mirroring `chord-key.ts`'s own token→code
 * mapping into the one form the E2E suite needs: a literal for `page.keyboard.press`.
 */
const PLAYWRIGHT_KEY_OF: Readonly<Record<string, string>> = {
  '+': 'Equal',
  '-': 'Minus',
  '0': 'Digit0',
  '1': 'Digit1',
  '2': 'Digit2',
  '3': 'Digit3',
  '4': 'Digit4',
  '5': 'Digit5',
  '6': 'Digit6',
  '7': 'Digit7',
  '8': 'Digit8',
  '9': 'Digit9',
};

/** Playwright's own modifier spelling — `Ctrl` (throng's) is `Control` there. */
const PLAYWRIGHT_MOD_OF: Readonly<Record<string, string>> = {
  Ctrl: 'Control',
  Control: 'Control',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Meta',
};

/** One single-stroke binding token → the ONE literal `page.keyboard.press` takes for it. */
function toPlaywrightPress(stroke: string): string {
  const mods: string[] = [];
  let rest = stroke;
  for (;;) {
    const m = /^(Ctrl|Control|Shift|Alt|Meta)\+(?=.)/.exec(rest);
    if (!m) break;
    mods.push(PLAYWRIGHT_MOD_OF[m[1] as string] as string);
    rest = rest.slice(m[0].length);
  }
  // An unshifted letter is pressed lowercase — the `key` a real keyboard reports for it. Playwright's
  // `press('W')` sends `key: 'W'` with no Shift held, which no keyboard produces and which CodeMirror
  // does not match as a bare `w` second stroke (046 T142).
  const letter = /^[a-z]$/i.test(rest) ? (mods.includes('Shift') ? rest.toUpperCase() : rest.toLowerCase()) : undefined;
  const key = letter ?? PLAYWRIGHT_KEY_OF[rest] ?? rest;
  return [...mods, key].join('+');
}

/**
 * A binding token → the literal string(s) `page.keyboard.press` takes (046 T106/T111), one per
 * stroke AS WRITTEN (core `splitStrokes`, comma-aware: `Ctrl+,` is one stroke).
 *
 * 046 FR-124 (S29): a two-stroke token (`Ctrl+E,W`) is ONE continuous press — the first stroke's
 * modifiers stay HELD through the second — so its second entry names only what the second stroke
 * adds (`w`). Pressing the two entries one after the other releases Ctrl between them, which is no
 * longer the chord; press a two-stroke chord through {@link toPlaywrightTwoStroke} instead.
 */
export function toPlaywrightPresses(token: string): string[] {
  const strokes = splitStrokes(token);
  if (!strokes) throw new Error(`${token} is not a binding token`);
  return strokes.map(toPlaywrightPress);
}

/**
 * A two-stroke chord as Playwright presses it (046 FR-124): `keyboard.down` each of `hold`, `press`
 * `first`, `press` `second`, then `keyboard.up` each of `hold` — the first stroke's modifiers held
 * from the first key through the second. `Ctrl+E,W` → `{ hold: ['Control'], first: 'e', second: 'w' }`;
 * `Ctrl+E,Shift+W` → `second: 'Shift+W'`. Throws for a token that is not exactly two strokes.
 */
export interface PlaywrightTwoStroke {
  hold: string[];
  first: string;
  second: string;
}

export function toPlaywrightTwoStroke(token: string): PlaywrightTwoStroke {
  const strokes = splitStrokes(token);
  if (!strokes || strokes.length !== 2) throw new Error(`${token} is not a two-stroke chord`);
  const [first, second] = strokes as [string, string];
  const hold: string[] = [];
  let key = first;
  for (;;) {
    const m = /^(Ctrl|Control|Shift|Alt|Meta)\+(?=.)/.exec(key);
    if (!m) break;
    hold.push(PLAYWRIGHT_MOD_OF[m[1] as string] as string);
    key = key.slice(m[0].length);
  }
  return { hold, first: toPlaywrightPress(key), second: toPlaywrightPress(second) };
}

/** {@link toPlaywrightTwoStroke} for `action`'s FIRST shipped binding on this platform. */
export function shippedTwoStroke(action: string): PlaywrightTwoStroke {
  const token = shippedBindingsFor().bindings[action]?.[0];
  if (token === undefined) throw new Error(`${action} ships no binding — nothing to press`);
  return toPlaywrightTwoStroke(token);
}

/**
 * The presses for `action`'s FIRST shipped binding on this platform (046 T142).
 *
 * An E2E that presses a shipped default reads it here rather than spelling it, so a moved default is
 * pressed as moved instead of failing on a stale literal. Throws for an action that ships no binding
 * rather than pressing nothing, which would pass any negative assertion that followed.
 */
export function shippedPresses(action: string): string[] {
  const token = shippedBindingsFor().bindings[action]?.[0];
  if (token === undefined) throw new Error(`${action} ships no binding — nothing to press`);
  return toPlaywrightPresses(token);
}

/** {@link shippedPresses} for a single-stroke default — throws if the default is a two-stroke chord. */
export function shippedPress(action: string): string {
  const presses = shippedPresses(action);
  if (presses.length !== 1) throw new Error(`${action} ships a ${presses.length}-stroke chord; use shippedPresses`);
  return presses[0] as string;
}
