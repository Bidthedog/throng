/**
 * The monitor's interaction states live in the stylesheet (055 FR-089, FR-091, defect D7), so they are
 * guarded where they are written: hover on every interactive element and gated on window blur, a visible
 * 2px focus ring in throng's convention on every control, a pointer cursor, a two-column body with no chart
 * region, and no animation under reduced motion.
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

  it('is drawn for rows, breadcrumb segments, the toolbar’s buttons and the filter’s clear button', () => {
    for (const el of ['.breakdown-row', '.breadcrumb__segment', '.monitor-controls__button', '.monitor-filter__clear']) {
      expect(all.some((r) => r.selectors.some((s) => s.startsWith(GATE) && s.endsWith(`${el}:hover`))), `${el} has no hover rule`).toBe(true);
    }
  });

  it('is not drawn for the right column’s bars, which are read-only (FR-108)', () => {
    expect(all.some((r) => r.selectors.some((s) => s.endsWith('.share-bar:hover')))).toBe(false);
    expect(bodyOf('.share-bar')).not.toMatch(/cursor:\s*pointer/);
  });
});

describe('the pointer cursor (FR-089)', () => {
  it.each(['.breakdown-row', '.breadcrumb__segment', '.monitor-controls__button', '.monitor-filter__clear', '.monitor-controls__select'])('%s shows it', (selector) => {
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

describe('the body is a header over two columns (FR-096, FR-097, FR-111, FR-112)', () => {
  const body = bodyOf('.monitor-body');
  const columns = bodyOf('.monitor-body__columns');

  it('stacks a header that does not scroll over the columns, ruled off from them', () => {
    expect(body).toMatch(/display:\s*(flex|grid)/);
    const header = bodyOf('.monitor-body__header');
    expect(header).toMatch(/border-bottom:[^;]*var\(--throng-colour-border\)/);
    expect(header).toMatch(/flex:\s*none/);
    expect(header).not.toMatch(/overflow(-y)?:\s*auto/);
  });

  it('lays the columns out from the divider’s ratio, a divider track between them', () => {
    expect(columns).toMatch(/display:\s*grid/);
    expect(columns).toMatch(/grid-template-columns:[^;]*var\(--monitor-split-left[^;]*var\(--monitor-split-right/);
    expect(bodyOf('.column-divider')).toMatch(/cursor:\s*col-resize/);
  });

  it('lets each column scroll on its own', () => {
    expect(bodyOf('.monitor-body__detail')).toMatch(/overflow(-y)?:\s*auto/);
    expect(bodyOf('.breakdown')).toMatch(/overflow(-y)?:\s*auto/);
  });

  it('has no chart area or treemap left', () => {
    expect(section).not.toMatch(/monitor-body__chart|\.treemap|\.timeseries|\.breakdown__map|uplot/i);
  });
});

describe('selection is marked with an accent edge, as throng marks its active item (FR-089)', () => {
  it('draws the selected row with the accent stripe the explorer uses for the active file', () => {
    expect(bodyOf('.breakdown-row--selected')).toMatch(/box-shadow:[^;]*inset[^;]*var\(--throng-colour-accent\)/);
  });

  it('keeps the selected look under the pointer: the selected rule covers :hover and follows the hover rule (FR-098, D1)', () => {
    const hoverAt = all.findIndex((r) => r.selectors.includes(`${GATE} .breakdown-row:hover`));
    const selectedHoverAt = all.findIndex((r) => r.selectors.includes(`${GATE} .breakdown-row--selected:hover`));
    expect(hoverAt).toBeGreaterThanOrEqual(0);
    expect(selectedHoverAt, 'no rule styles the selected row under the pointer').toBeGreaterThan(hoverAt);
    const rule = all[selectedHoverAt]!;
    expect(rule.selectors).toContain('.breakdown-row--selected');
    expect(rule.body).toMatch(/background:\s*var\(--throng-colour-surfaceActive\)/);
    expect(rule.body).toMatch(/box-shadow:[^;]*inset[^;]*var\(--throng-colour-accent\)/);
  });

  it('has no drill-down button on a row to style: a double-click opens (FR-096)', () => {
    expect(section).not.toMatch(/breakdown-row__open/);
  });
});

describe('the line graphs (FR-097)', () => {
  it('are drawn in the theme’s accent, which the canvas reads back as its CSS colour', () => {
    expect(bodyOf('.line-graph__plot')).toMatch(/color:\s*var\(--throng-colour-accent\)/);
    expect(bodyOf('.sparkline')).toMatch(/color:\s*var\(--throng-colour-accent\)/);
  });

  it('keep the box the canvas is drawn in, so a line is never stretched', () => {
    expect(bodyOf('.line-graph__plot')).toMatch(/width:\s*220px/);
    expect(bodyOf('.line-graph__plot')).toMatch(/height:\s*44px/);
  });
});

describe('motion (FR-090, FR-091)', () => {
  const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(section)?.[1] ?? '';

  it('has no pulse under reduced motion', () => {
    expect(reduced).toMatch(/\.monitor-liveness__pulse[^{]*\{[^}]*animation:\s*none/);
  });

  it('spins the loading spinner in the theme’s accent, and holds it still under reduced motion (FR-114)', () => {
    expect(bodyOf('.monitor-spinner')).toMatch(/animation:[^;]*throng-spin/);
    expect(bodyOf('.monitor-spinner')).toMatch(/var\(--throng-colour-accent\)/);
    expect(reduced).toMatch(/\.monitor-spinner[^{]*\{[^}]*animation:\s*none/);
  });

  it('keeps a loading graph in the graph’s own box, centred, so nothing overlaps its neighbours (FR-114)', () => {
    const box = bodyOf('.line-graph__building');
    expect(box).toMatch(/width:\s*220px/);
    expect(box).toMatch(/height:\s*44px/);
    expect(box).toMatch(/place-items:\s*center/);
    const spark = bodyOf('.sparkline--building');
    expect(spark).toMatch(/place-items:\s*center/);
    expect(spark).toMatch(/overflow:\s*hidden/);
  });
});
