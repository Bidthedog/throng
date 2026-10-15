/**
 * The monitor's interaction states live in the stylesheet (055 FR-089, FR-091, defect D7), so they are
 * guarded where they are written: hover on every interactive element and gated on window blur, a visible
 * 2px focus ring in throng's convention on every control, a pointer cursor, banded tiles that still show
 * hover and selection, and no animation under reduced motion.
 *
 * Layer: unit — the stylesheet read as text, the seam `hover-suppression-coverage.test.ts` and the literal
 * colour guard in `breakdown.test.ts` already use. jsdom resolves no cascade, so a rule's EFFECT is not
 * assertable here and is not claimed; what is claimed is that the rules exist and say what the convention says.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const full = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
const section = full.slice(full.indexOf('══ 055 — the Resource Monitor'), full.indexOf('── 055 end ──'));
const GATE = ':where(body:not([data-window-blurred]))';

interface Rule {
  readonly selectors: string[];
  readonly body: string;
}

/** Every `selector { body }` of the 055 section outside an @-block (reduced motion is read separately). */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const selectors = splitSelectors(m[1]!.replace(/\/\*[\s\S]*?\*\//g, ''));
    out.push({ selectors, body: m[2]! });
  }
  return out;
}

/** A selector list's members: split on the commas that are not inside `:is( … )`, `:not( … )` and the like. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

const all = rules(section);
const bodyOf = (selector: string): string => all.filter((r) => r.selectors.includes(selector)).map((r) => r.body).join('\n');

describe('hover (FR-089)', () => {
  it('is gated on window blur in EVERY selector of a hover rule, not only the last of a list', () => {
    const ungated = all.flatMap((r) => r.selectors).filter((s) => s.includes(':hover') && !s.includes(GATE));
    expect(ungated).toEqual([]);
  });

  it('is drawn for tiles, rows, breadcrumb segments, the toolbar’s buttons and the filter’s clear button', () => {
    for (const el of ['.treemap__tile', '.breakdown-row', '.breadcrumb__segment', '.monitor-controls__button', '.monitor-filter__clear', '.breakdown-row__open-button', '.treemap__open-button']) {
      expect(all.some((r) => r.selectors.some((s) => s.startsWith(GATE) && s.endsWith(`${el}:hover`))), `${el} has no hover rule`).toBe(true);
    }
  });
});

describe('the pointer cursor (FR-089)', () => {
  it.each([
    '.treemap__tile',
    '.breakdown-row',
    '.breadcrumb__segment',
    '.monitor-controls__button',
    '.monitor-filter__clear',
    '.monitor-controls__select',
    '.breakdown-row__open-button',
    '.treemap__open-button',
  ])('%s shows it', (selector) => {
    expect(bodyOf(selector)).toMatch(/cursor:\s*pointer/);
  });
});

describe('the focus ring (FR-089: throng’s 2px convention, from the keyboard)', () => {
  it('is 2px in the active-panel colour on every :focus-visible rule of the section', () => {
    const rings = all.filter((r) => r.selectors.some((s) => s.includes(':focus-visible')));
    expect(rings.length).toBeGreaterThan(0);
    for (const r of rings) {
      expect(r.body, r.selectors.join(', ')).toMatch(/outline:\s*2px solid var\(--throng-colour-activePanelBorder\)/);
    }
  });

  it('covers every kind of control in the window with one rule, so a new one is not forgotten', () => {
    const selectors = all.flatMap((r) => (r.body.includes('outline') ? r.selectors : [])).filter((s) => s.includes(':focus-visible'));
    const joined = selectors.join(' ');
    for (const kind of ['button', 'input', 'select', '[tabindex]']) expect(joined, kind).toContain(kind);
    expect(joined).toContain('.resource-monitor');
  });
});

describe('a banded tile is still a tile (D7)', () => {
  it('has no band rule that paints over the hover or the selected edge', () => {
    const banded = all.filter((r) => r.selectors.some((s) => s.includes('.treemap__tile[data-band')));
    for (const r of banded) expect(r.body, r.selectors.join(', ')).not.toMatch(/border-color|box-shadow|outline/);
  });

  it('shows the selected edge after every other tile rule, so nothing can override it', () => {
    const selected = section.indexOf(".treemap__tile[data-selected='true']");
    expect(selected).toBeGreaterThan(0);
    const lastTileRule = section.lastIndexOf('.treemap__tile:hover');
    expect(selected).toBeGreaterThan(lastTileRule);
  });
});

describe('selection is marked with an accent edge, as throng marks its active item (FR-089)', () => {
  it('draws the selected row with the accent stripe the explorer uses for the active file', () => {
    expect(bodyOf('.breakdown-row--selected')).toMatch(/box-shadow:[^;]*inset[^;]*var\(--throng-colour-accent\)/);
  });

  it('does not give a tile at rest the fill the selected row has', () => {
    expect(bodyOf('.treemap__tile')).not.toMatch(/background:\s*var\(--throng-colour-surfaceActive\)/);
  });
});

describe('motion (FR-090, FR-091)', () => {
  const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(section)?.[1] ?? '';

  it('has no pulse under reduced motion', () => {
    expect(reduced).toMatch(/\.monitor-liveness__pulse[^{]*\{[^}]*animation:\s*none/);
  });
});
