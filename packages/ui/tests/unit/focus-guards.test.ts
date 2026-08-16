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
 */
function code(src: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1: string) =>
    p1 + blank(m.slice(p1.length)),
  );
}

const lineOf = (src: string, index: number): number => src.slice(0, index).split('\n').length;

/** Reading an element's rendered text… */
const TEXT = String.raw`\.\s*(?:textContent|innerText|innerHTML)`;
/** …and then asking whether some string is somewhere in it. */
const CONTAINS = String.raw`(?:\.\s*(?:includes|indexOf|match|search|test)\s*\(|toContain\s*\(|toMatch\s*\()`;

/**
 * Direct form: `document.activeElement?.textContent ?? ''` … `.includes(...)`.
 *
 * The windows are deliberately short. `activeElement` reaches `textContent` through a property chain
 * — optional chaining, a `??` default, a wrapping paren — never through a statement, so 80 characters
 * covers every spelling of it without letting an unrelated `textContent` elsewhere in the same
 * expression raise a false alarm.
 */
const DIRECT = new RegExp(
  String.raw`activeElement[\s\S]{0,80}?${TEXT}[\s\S]{0,140}?${CONTAINS}`,
  'g',
);

/** The same predicate written through a local: `const active = document.activeElement;` … */
const VIA_LOCAL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*document\s*\.\s*activeElement/g;

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
    const rest = src.slice(decl.index);
    const indirect = new RegExp(
      String.raw`\b${name}\b[\s\S]{0,80}?${TEXT}[\s\S]{0,140}?${CONTAINS}`,
      'g',
    );
    for (const m of rest.matchAll(indirect)) {
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

const files = walk(E2E, /\.tsx?$/);

describe('FR-053a — no E2E focus guard tests the ACTIVE ELEMENT’S TEXT', () => {
  it('finds E2E sources to scan', () => {
    // A walk that silently returns nothing would report a clean bill of health for an unread tree.
    expect(files.length).toBeGreaterThan(20);
  });

  it('no source polls document.activeElement’s text for a substring', () => {
    const offences = files.flatMap(offencesIn);
    const report = offences
      .map((o) => `  ${o.file}:${o.line}\n    ${o.snippet}`)
      .join('\n');
    expect(
      offences,
      offences.length === 0
        ? ''
        : `FR-053a: ${offences.length} vacuous focus guard(s). Every ancestor's textContent contains ` +
          `its descendants' text, so these predicates hold regardless of where focus is — including ` +
          `with the triggering click removed. Assert containment of the ACTIVE ELEMENT instead ` +
          `(document.activeElement?.closest('[data-testid="…"]') != null) plus the state the ` +
          `keystroke depends on, e.g. the row's own tree-row--selected class. See ` +
          `notice-stacking.e2e.ts.\n${report}`,
    ).toEqual([]);
  });
});
