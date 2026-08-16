import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 033 FR-053a (#244) — a focus guard that cannot fail is not a guard.
 *
 * The shape this bans, in full:
 *
 *     const rowFocused = async (): Promise<boolean> =>
 *       win.evaluate(() => (document.activeElement?.textContent ?? '').includes('thing.txt'));
 *
 * It reads as a focus assertion and it is a sleep. `textContent` is the CONCATENATED text of an
 * element and every descendant, so the predicate holds for any ancestor of the row — and the file
 * tree keeps `document.activeElement` on its container (react-arborist roving focus, see
 * `tree-node.tsx`), whose text contains every row in the project. It also holds for `document.body`,
 * which is the active element before focus lands at all. So the poll returns true on its first
 * sample whether the click landed, missed, or was deleted outright — which is exactly how #244 was
 * found, and the same predicate had already been copied as precedent because it read like a guard.
 *
 * The same predicate has a Playwright-native spelling that says `textContent` nowhere at all:
 *
 *     await expect(win.locator(':focus')).toContainText('thing.txt');
 *
 * `:focus` resolves to the very element `document.activeElement` names, and `toContainText` matches
 * an element's text INCLUDING its descendants'. So it is the same sleep wearing the framework's
 * clothes — and it is the spelling a Playwright author reaches for first, which is why the scanner
 * below hunts the SHAPE in both vocabularies rather than the one property name.
 *
 * `notice-stacking.e2e.ts` writes out the correct form and its reasoning: ask whether the active
 * element is INSIDE the tree (`closest('[data-testid="file-explorer-tree"]')`) and, for the specific
 * row, whether it carries `tree-row--selected` — a class React only puts there once selection state
 * has actually reached the DOM. Both can be false; that is the whole point.
 *
 * This scanner therefore looks for the SHAPE across every E2E source, not for the one instance that
 * prompted it. A guard shaped like the known instance is the failure mode this task exists to fix:
 * the vacuous predicate spread by being copied, and a check that only knew the file it was copied
 * from would have watched the next copy sail past.
 */
const E2E = fileURLToPath(new URL('../e2e/', import.meta.url));

/**
 * Every source under `tests/e2e/`, whatever extension it wears.
 *
 * `\.tsx?$` alone walks straight past a helper written as `.js` or `.mjs` — and a helper is precisely
 * where a guard that got copied once ends up copied everywhere, so the one file this scanner most
 * needs to read would have been the one it skipped.
 */
const SOURCE = /\.[cm]?[jt]sx?$/;

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Blank out comments while preserving every offset and newline.
 *
 * The guard polices CODE. This very file, and the prose in `notice-stacking.e2e.ts` that explains
 * why the shape is vacuous, both have to be able to quote it — a guard that failed on the
 * documentation of its own rule would teach the next author to delete the explanation instead of
 * the defect. Padding rather than deleting keeps `file:line` in the failure message honest.
 *
 * Strings are SKIPPED rather than read, because `//` inside one is not a comment. The previous
 * spelling was a regex that refused to blank only after a colon — enough for a URL, and nothing else:
 * any other string carrying a double slash (`'a // b'`, `'[href^="//"]'`) blanked the REST OF ITS
 * LINE, so a vacuous guard sitting two columns to its right became invisible to the scanner. Template
 * holes are walked as code, so a comment inside `${…}` is still blanked.
 *
 * Regex literals are deliberately not tracked: telling `/` apart from division needs the token before
 * it, and a wrong guess would skip real code. A regex containing a quote can therefore cost the
 * scanner the rest of that line — it can only ever hide an offence, never invent one, and a regex
 * spells a double slash `\/\/`, which has no two adjacent slashes to be mistaken for a comment.
 */
function code(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };

  /** The index just past the `'`/`"` string opening at `i`. */
  const quoted = (i: number, quote: string): number => {
    let k = i + 1;
    while (k < src.length) {
      const c = src[k];
      if (c === '\\') {
        k += 2;
        continue;
      }
      if (c === quote) return k + 1;
      // Unterminated (a lone apostrophe inside a regex, say): resume at the line end rather than
      // swallowing the remainder of the file.
      if (c === '\n') return k;
      k += 1;
    }
    return k;
  };

  /** The index just past the template literal opening at `i`, its `${…}` holes walked as code. */
  const template = (i: number): number => {
    let k = i + 1;
    while (k < src.length) {
      const c = src[k];
      if (c === '\\') {
        k += 2;
        continue;
      }
      if (c === '`') return k + 1;
      if (c === '$' && src[k + 1] === '{') {
        k = scan(k + 2, true);
        continue;
      }
      k += 1;
    }
    return k;
  };

  /** Blank every comment from `i`; inside a `${…}` hole, stop just past its closing brace. */
  function scan(i: number, inHole: boolean): number {
    let depth = 0;
    let k = i;
    while (k < src.length) {
      const c = src[k];
      const n = src[k + 1];
      if (c === '/' && n === '/') {
        const nl = src.indexOf('\n', k);
        const to = nl === -1 ? src.length : nl;
        blank(k, to);
        k = to;
        continue;
      }
      if (c === '/' && n === '*') {
        const end = src.indexOf('*/', k + 2);
        const to = end === -1 ? src.length : end + 2;
        blank(k, to);
        k = to;
        continue;
      }
      if (c === "'" || c === '"') {
        k = quoted(k, c);
        continue;
      }
      if (c === '`') {
        k = template(k);
        continue;
      }
      if (inHole && c === '{') depth += 1;
      if (inHole && c === '}') {
        if (depth === 0) return k + 1;
        depth -= 1;
      }
      k += 1;
    }
    return k;
  }

  scan(0, false);
  return out.join('');
}

/** Every character a regex would read as a pattern rather than as itself. */
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const lineOf = (src: string, index: number): number => src.slice(0, index).split('\n').length;

/** Reading an element's rendered text… */
const TEXT = String.raw`\.\s*(?:textContent|innerText|innerHTML|allInnerTexts|allTextContents)`;
/** …and then asking whether some string is somewhere in it. */
const CONTAINS = String.raw`(?:\.\s*(?:includes|indexOf|match|search|test)\s*\(|toContain\s*\(|toMatch\s*\()`;

/**
 * Playwright's spelling of BOTH halves at once.
 *
 * `toContainText` reads an element's text and asks for containment in one call, and it is
 * subtree-inclusive exactly as `Element.textContent` is. So
 * `await expect(win.locator(':focus')).toContainText('thing.txt')` is the identical vacuous
 * predicate with no `textContent` anywhere in it — it holds for the tree container roving focus
 * parks on, and for `<body>` before focus has landed at all.
 */
const CONTAINS_TEXT = String.raw`toContainText\s*\(`;

/**
 * The active element, in EITHER spelling.
 *
 * `:focus` selects the same element `document.activeElement` names — Playwright simply asks the
 * browser for it with a selector instead of a property. It is already how `menu-keyboard.e2e.ts`,
 * `open-in-terminal.e2e.ts` and `preferences-fonts-and-sliders.e2e.ts` reach focus, so it is the
 * spelling the next author will reach for; a scanner that knew only the DOM property would have
 * proved nothing beyond "nobody here writes `document.activeElement`", which is not what the
 * describe above claims. The character class cannot cross a quote or a newline, so the match stays
 * inside one string literal and an unrelated quote earlier on the line cannot reach a later `:focus`.
 */
const ACTIVE = String.raw`(?:activeElement|['"\`][^'"\`\n]{0,120}:focus)`;

/**
 * Direct form: the active element, its text, and a containment test, in one expression.
 *
 *     document.activeElement?.textContent ?? ''  …  .includes('thing.txt')
 *     await expect(win.locator(':focus')).toContainText('thing.txt')
 *
 * The windows are deliberately short, and they cannot cross a `;`. The active element reaches its
 * text through a property chain — optional chaining, a `??` default, a wrapping paren — never
 * through a statement, so one expression's worth of characters covers every spelling of it. Allowing
 * a statement end into the window is not merely loose, it is WRONG: `const a = await
 * win.locator(':focus').getAttribute('x');` followed on the next line by an ordinary
 * `expect(...).toContainText('deep')` is two unrelated statements, and reporting it would be the
 * kind of noise that gets a guard deleted rather than obeyed.
 *
 * A read hoisted into its own `const` escapes these windows on purpose: that shape is the
 * `VIA_LOCAL` pass below, which puts no distance at all between the read and the comparison.
 */
const DIRECT = new RegExp(
  String.raw`${ACTIVE}[^;]{0,80}?(?:${TEXT}[^;]{0,140}?${CONTAINS}|${CONTAINS_TEXT})`,
  'g',
);

/**
 * The same predicate written through a local, in either half:
 *
 *     const active = document.activeElement;            …  active.textContent.includes(x)
 *     const el = win.locator(':focus');                 …  await expect(el).toContainText(x)
 *     const text = (await win.locator(':focus').textContent()) ?? '';   … much later …  text.includes(x)
 *
 * The third is what a fixed distance between the READ and the COMPARISON cannot see: hoist the read
 * and assert a hundred and fifty characters further down and `DIRECT` is satisfied by neither half.
 */
const VIA_LOCAL = new RegExp(
  String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=[^;]{0,160}?${ACTIVE}`,
  'g',
);

/**
 * An identifier occurrence that reads as a USE rather than as a word.
 *
 * A zero-width lookahead, so the character it demands is still there for the pattern that follows:
 * `text.includes(`, `expect(text).toContain(`, `(text ?? '').includes(`, `text!.includes(`. Without
 * it, the same word sitting in a prose message two lines down — `'…the row was focused…'` for a
 * local named `focused` — counts as a use, and drags whatever follows it into a false offence.
 */
const USE = String.raw`(?=\s*[.)\],?!])`;

interface Offence {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
}

function offencesIn(file: string): Offence[] {
  const raw = readFileSync(file, 'utf8');
  const src = code(raw);
  const found: Offence[] = [];
  const at = (index: number, length: number): Offence => ({
    file,
    line: lineOf(src, index),
    snippet: raw.slice(index, index + length).replace(/\s+/g, ' ').trim(),
  });

  for (const m of src.matchAll(DIRECT)) found.push(at(m.index, m[0].length));

  for (const decl of src.matchAll(VIA_LOCAL)) {
    const name = decl[1] as string;
    /*
     * Did the DECLARATION already do the reading? `const text = (await win.locator(':focus')
     * .textContent()) ?? '';` leaves nothing but a containment test to find, and that test can sit
     * any distance below — which is exactly the hole a fixed window between the read and the
     * comparison leaves open. When the read is still to come, both halves are required as before.
     */
    const semi = src.indexOf(';', decl.index);
    const stmt = src.slice(
      decl.index,
      Math.min(semi === -1 ? src.length : semi + 1, decl.index + 400),
    );
    const tail = new RegExp(TEXT).test(stmt)
      ? String.raw`(?:${CONTAINS}|${CONTAINS_TEXT})`
      : String.raw`(?:${TEXT}[^;]{0,140}?${CONTAINS}|${CONTAINS_TEXT})`;
    /*
     * Bounded to the declaration's own neighbourhood — roughly the enclosing function. An identifier
     * followed to the end of the file eventually meets an unrelated `row` or `label` belonging to
     * another test, and reports its line instead.
     */
    const region = src.slice(decl.index, decl.index + 2000);
    const indirect = new RegExp(
      String.raw`(?<![\w$])${esc(name)}(?![\w$])${USE}[^;]{0,80}?${tail}`,
      'g',
    );
    for (const m of region.matchAll(indirect)) {
      found.push(at(decl.index + m.index, m[0].length));
    }
  }

  /*
   * One offence per line. The two passes overlap on the local-variable spelling — `const active =
   * document.activeElement; … active.textContent.includes(…)` is short enough that the direct chain
   * window reaches it too — and reporting the same line twice would make the count a lie about how
   * much is wrong.
   */
  const seen = new Set<number>();
  return found.filter((o) => {
    if (seen.has(o.line)) return false;
    seen.add(o.line);
    return true;
  });
}

const files = walk(E2E, SOURCE);

describe('FR-053a — no E2E focus guard tests the ACTIVE ELEMENT’S TEXT', () => {
  it('finds E2E sources to scan', () => {
    // A walk that silently returns nothing would report a clean bill of health for an unread tree.
    expect(files.length).toBeGreaterThan(20);
  });

  it('no source polls the active element’s text for a substring — activeElement OR :focus', () => {
    const offences = files.flatMap(offencesIn);
    const report = offences
      .map((o) => `  ${o.file}:${o.line}\n    ${o.snippet}`)
      .join('\n');
    expect(
      offences,
      offences.length === 0
        ? ''
        : `FR-053a: ${offences.length} vacuous focus guard(s). Every ancestor's textContent contains ` +
          `its descendants' text — and Playwright's toContainText is subtree-inclusive in exactly ` +
          `the same way — so these predicates hold regardless of where focus is, including ` +
          `with the triggering click removed. Assert containment of the ACTIVE ELEMENT instead ` +
          `(document.activeElement?.closest('[data-testid="…"]') != null) plus the state the ` +
          `keystroke depends on, e.g. the row's own tree-row--selected class. See ` +
          `notice-stacking.e2e.ts.\n${report}`,
    ).toEqual([]);
  });
});
