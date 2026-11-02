/**
 * The Resource Monitor's layout and style claims that are written in the stylesheet and read back as text.
 *
 * Layer: unit — these assert RULES in `theme.css` / `title-bar.css`, and render nothing. jsdom has no layout and
 * resolves no cascade, so a rule's effect is not claimed here (MT-16 is the visual proof); what is claimed is
 * that the rules exist and say what the requirement says. They were component tests that mounted nothing: each
 * is moved here unchanged from the file that still holds the monitor's rendered claims for the same area
 * (`monitor-height`, `breakdown-columns`, `breakdown-header`, `breakdown`, `help-panel`, `info-helper`,
 * `monitor-layout`, `status-resources`). The interaction-state rules (hover, focus ring, body columns) are
 * `monitor-css.test.ts`'s; the heat scale is `heat.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = 'packages/ui/src/renderer';
const read = (file: string, crlf = false): string => {
  const text = readFileSync(resolve(process.cwd(), RENDERER, file), 'utf8');
  return crlf ? text.replace(/\r\n/g, '\n') : text;
};

describe('the rules the browser lays the left column out by (055 FR-118; was monitor-height.test.ts)', () => {
  const css = read('theme.css', true);
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  };

  it('scrolls the list\'s rows, with a floor of its declared rows', () => {
    const rows = rule('.breakdown__rows');
    expect(rows).toMatch(/overflow-y:\s*auto/);
    expect(rows).toMatch(/min-height:\s*calc\(var\(--breakdown-floor\)\s*\*\s*var\(--breakdown-row-px\)\)/);
  });

  it('gives Held folders up first: it shrinks far faster than the list, and scrolls within what it has', () => {
    const held = rule('.held-folders');
    const shrink = Number(/flex:\s*0\s+(\d+)\s+auto/.exec(held)?.[1] ?? 'NaN');
    expect(shrink).toBeGreaterThan(1);
    expect(rule('.held-folders > .held-folders__list')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.held-folders > .breakdown__heading')).toMatch(/flex:\s*none/);
  });

  it('lets the shortage reach the list: a section can shrink (min-height 0), so the Total row and column names stay put while the rows scroll', () => {
    const section = rule('.breakdown__section');
    expect(section).toMatch(/min-height:\s*0/);
    expect(section).toMatch(/flex:\s*var\(--breakdown-grow,\s*0\)\s+1\s+auto/);
  });

  it('sizes the list by its floor, and lets a tall window fill it only when it has more than 10 rows (FR-118)', () => {
    // basis = floor rows: beyond 10 rows the list stops asking Held folders for more and scrolls;
    // grow only when there is something to scroll, so a short list leaves no blank space in itself.
    expect(rule('.breakdown__rows')).toMatch(/flex:\s*var\(--breakdown-grow,\s*0\)\s+1\s+calc\(var\(--breakdown-floor\)\s*\*\s*var\(--breakdown-row-px\)\)/);
    expect(rule('.breakdown')).toMatch(/flex:\s*var\(--breakdown-grow,\s*0\)\s+1\s+auto/);
  });

  it('never lets Held folders vanish: it keeps room for its heading', () => {
    expect(rule('.held-folders')).toMatch(/min-height:\s*\d+px/);
  });

  it('keeps the list\'s own floor when the column is shorter still: the column scrolls, the list is not squeezed', () => {
    expect(rule('.breakdown')).toMatch(/min-height:\s*calc\(var\(--breakdown-floor-rows[,)]/);
    expect(rule('.monitor-body__breakdown')).toMatch(/overflow-y:\s*auto/);
  });
});

describe('the Breakdown list\'s stylesheet (055 FR-099, FR-106, FR-067)', () => {
  const css = read('theme.css');

  it('never scrolls sideways: the list hides horizontal overflow, and every grid reads the template (was breakdown-columns)', () => {
    expect(/\.breakdown\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/overflow-x:\s*hidden/);
    for (const selector of ['.breakdown__columns', '.breakdown-row', '.breakdown-total']) {
      const body = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(body, selector).toMatch(/grid-template-columns:\s*var\(--breakdown-columns/);
    }
  });

  it('the column header is sticky, so it stays over the rows when the list scrolls (was breakdown-header)', () => {
    expect(/\.breakdown__columns\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/position:\s*sticky/);
  });

  it('gives an unloaded project’s row the project list’s grey italic style, from theme tokens (was breakdown)', () => {
    const rule = /\.breakdown-row--unloaded[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/font-style:\s*italic/);
    expect(rule).toMatch(/color:\s*var\(--throng-colour-textMuted\)/);
  });

  it('draws nothing from a literal colour: the 055 stylesheet names theme variables only (was breakdown)', () => {
    const start = css.indexOf('══ 055 — the Resource Monitor');
    const end = css.indexOf('── 055 end ──');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = css.slice(start, end);
    // A colour-bearing declaration never holds a hex, rgb()/hsl() or a named colour.
    const colourDecls = [...section.matchAll(/(?:^|[;{\s])((?:color|background(?:-color)?|fill|stroke|border(?:-[a-z]+)*|outline(?:-color)?|text-decoration-color)\s*:[^;}]*)/gm)].map((m) => m[1] ?? '');
    expect(colourDecls.length).toBeGreaterThan(10);
    for (const decl of colourDecls) {
      expect(decl, decl).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
      expect(decl, decl).not.toMatch(/:\s*(red|green|blue|white|black|gray|grey|orange|yellow)\b/i);
    }
  });
});

describe('the monitor window\'s other stylesheet claims', () => {
  const css = read('theme.css', true);

  it('lays the row out in three columns: the filter at the left, the line centred, the help right-aligned (was monitor-layout)', () => {
    const row = /\.monitor-body__top\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(row).toMatch(/display:\s*grid/);
    expect(row).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/);
    expect(/\.monitor-body__updated\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/text-align:\s*center/);
    expect(/\.monitor-body__help\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/justify-self:\s*end/);
  });

  it('shows the help panel in the popover style with no glow (FR-119; was help-panel)', () => {
    // The panel's own rule is the last `.monitor-help {`; the first is the shared surface it is grouped into.
    const own = [...css.matchAll(/\n\.monitor-help\s*\{([^}]*)\}/g)].pop()?.[1] ?? '';
    expect(own).toMatch(/width:/);
    expect(own).not.toMatch(/color-mix/);
    expect(own).not.toMatch(/box-shadow/);
    expect(own).not.toMatch(/background/);
    // The surface itself is the attention popover's, shared in one rule.
    expect(/\n((?:\.[\w-]+,\n)*\.attention-popover(?:,\n\.[\w-]+)*)\s*\{/.exec(css)?.[1] ?? '').toContain('.monitor-help');
  });

  it('is a floating surface in the attention popover\'s style, not a glow (FR-119; was info-helper)', () => {
    const shared = /\n((?:\.[\w-]+,\n)*\.attention-popover(?:,\n\.[\w-]+)*)\s*\{/.exec(css)?.[1] ?? '';
    expect(shared).toContain('.info-helper-popover');
    expect(shared).toContain('.monitor-help');
    expect(shared).toContain('.status-popover');
  });

  it('raises the info helper "?" and makes it small, with no margin of its own pushing it away (was info-helper)', () => {
    const escaped = '.info-helper'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(body).toMatch(/vertical-align:\s*(super|top)/);
    expect(body).toMatch(/margin:\s*0/);
    expect(Number(/width:\s*(\d+)px/.exec(body)?.[1])).toBeLessThanOrEqual(14);
    expect(Number(/height:\s*(\d+)px/.exec(body)?.[1])).toBeLessThanOrEqual(14);
  });

  it('colours the status bar\'s bands from the theme tokens warning and danger, with no literal colour (FR-046, FR-067; was status-resources)', () => {
    const rules = css.match(/\.status-resources[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    const warning = rules.find((r) => r.includes("data-band='warning'") || r.includes('data-band="warning"'));
    const critical = rules.find((r) => r.includes("data-band='critical'") || r.includes('data-band="critical"'));
    expect(warning).toContain('var(--throng-colour-warning)');
    expect(critical).toContain('var(--throng-colour-danger)');
    for (const rule of rules) expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it('gives the title bar\'s drag region up while the info helper mark is there: a drag region delivers no DOM press, so it could never dismiss (was info-helper)', () => {
    const titleCss = read('title-bar/title-bar.css', true);
    const rule = /\[data-helper-open\][^{]*\{([^}]*)\}/.exec(titleCss);
    expect(rule, 'no rule for an open helper').not.toBeNull();
    expect(rule?.[0]).toContain('.title-bar');
    expect(rule?.[0]).toContain('.title-bar__drag-zone');
    expect(rule?.[1]).toMatch(/-webkit-app-region:\s*no-drag/);
  });
});
