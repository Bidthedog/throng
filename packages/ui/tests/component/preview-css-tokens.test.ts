/**
 * 081 FR-030 (#733 item 1) — a highlighted table row lays out exactly as it does unhighlighted; only its background
 * changes. The bar every other marked block draws in the gutter is a `::before` on the block with `position: relative`
 * on the block itself. On a table part that pseudo-element joins the table's own layout and the row draws differently
 * while marked, so no rule may give a marked `table`, `thead`, `tbody` or `tr` either: a row's bar is drawn on its
 * first cell instead.
 *
 * Read against the shipped markdown.css, with each rule's selector matched against real elements, so a selector that
 * names a table part indirectly (`.preview-sync-mark` alone) is caught as surely as one that names it outright.
 *
 * Layer: component — selector matching needs a DOM (jsdom); jsdom has no layout, so the geometry itself is measured by
 * the E2E in `preview-scroll.e2e.ts`. `tests/unit/preview-css-tokens.test.ts` holds the sync mark's colours.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MARKDOWN_CSS = readFileSync(resolve(__dirname, '../../src/renderer/preview/providers/markdown/markdown.css'), 'utf8');

interface Rule {
  selectors: string[];
  body: Map<string, string>;
}

/** A selector list split at its top-level commas only: `a:not(b, c), d` is two selectors, not three. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '(') depth += 1;
    else if (list[i] === ')') depth -= 1;
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter((s) => s !== '');
}

function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out: Rule[] = [];
  for (const m of text.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const body = new Map<string, string>();
    for (const part of m[2]!.split(';')) {
      const colon = part.indexOf(':');
      if (colon > 0) body.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
    }
    out.push({ selectors: splitSelectors(m[1]!.replace(/\s+/g, ' ')), body });
  }
  return out;
}

const RULES = rules(MARKDOWN_CSS);
const BEFORE = /::before$/;

/** A gutter-on Markdown body holding a marked table: every part of it carries the mark, as any one of them may. */
function markedTable(): { table: HTMLTableElement; parts: HTMLElement[]; firstCells: HTMLElement[] } {
  const body = document.createElement('div');
  body.className = 'preview-markdown preview-markdown--gutter';
  body.innerHTML =
    '<table><thead><tr><th></th><th></th></tr></thead><tbody><tr><td>Alpha</td><td>one</td></tr></tbody></table>';
  document.body.replaceChildren(body);
  const table = body.querySelector('table')!;
  const parts = [table, ...table.querySelectorAll<HTMLElement>('thead, tbody, tr')];
  for (const part of parts) part.classList.add('preview-sync-mark', 'preview-sync-mark--on');
  const firstCells = [...table.querySelectorAll('tr')].map((tr) => tr.cells[0]!);
  return { table, parts, firstCells };
}

describe('a marked table part keeps its layout (081 FR-030)', () => {
  it('no rule gives a marked table, thead, tbody or tr a position', () => {
    const { parts } = markedTable();
    for (const rule of RULES) {
      if (!rule.body.has('position')) continue;
      for (const selector of rule.selectors.filter((s) => !BEFORE.test(s))) {
        for (const part of parts) expect(part.matches(selector), `${selector} on <${part.tagName}>`).toBe(false);
      }
    }
  });

  it('no ::before rule draws on a marked table, thead, tbody or tr', () => {
    const { parts } = markedTable();
    for (const rule of RULES) {
      for (const selector of rule.selectors.filter((s) => BEFORE.test(s))) {
        const on = selector.replace(BEFORE, '');
        for (const part of parts) expect(part.matches(on), `${selector} on <${part.tagName}>`).toBe(false);
      }
    }
  });

  it('draws a marked row\'s bar on its first cell, in the gutter, bright while the mark is on', () => {
    const { firstCells } = markedTable();
    const bar = (cell: HTMLElement): Rule | undefined =>
      RULES.find((r) => r.body.has('content') && r.selectors.some((s) => BEFORE.test(s) && cell.matches(s.replace(BEFORE, ''))));
    const bright = (cell: HTMLElement): Rule | undefined =>
      RULES.find((r) => r.body.get('opacity') === '1' && r.selectors.some((s) => BEFORE.test(s) && cell.matches(s.replace(BEFORE, ''))));
    for (const cell of firstCells) {
      expect(bar(cell)?.body.get('border-left'), `<${cell.tagName}>`).toMatch(/var\(--throng-colour-border\)/);
      expect(bright(cell), `<${cell.tagName}>`).toBeDefined();
    }
    // The second cell draws no bar.
    const second = firstCells[0]!.nextElementSibling as HTMLElement;
    expect(bar(second)).toBeUndefined();
  });

  it('still washes the marked row itself', () => {
    const { parts } = markedTable();
    const row = parts.find((p) => p.tagName === 'TR')!;
    const wash = RULES.find((r) => r.body.has('background-color') && r.selectors.some((s) => row.matches(s)));
    expect(wash?.body.get('background-color')).toMatch(/--throng-colour-accent/);
  });
});
