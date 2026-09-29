import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTableLayout,
  measureColumns,
  measureTables,
  relayoutTables,
  RESIZE_HANDLE_CLASS,
  SCROLL_WRAPPER_CLASS,
  type ColumnMeasurer,
  type TableHandSet,
} from '../../src/renderer/preview/table-layout.js';

/**
 * 047 T065/T066 (R13, FR-060 – FR-068) — `applyTableLayout`, over a plain DOM tree with a STUBBED
 * measurer (jsdom has no real layout, so a `{min, max}` per column is supplied directly, the same way
 * `fold-gutter.test.ts` injects `resolveIcon`). `core/tests/unit/table-widths.test.ts` proves
 * `fairColumnWidths`'s own arithmetic; this proves the DOM this module builds from its answer.
 */

function table(rows: string[][]): HTMLTableElement {
  const t = document.createElement('table');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.append(td);
    }
    t.append(tr);
  }
  return t;
}

function mount(el: HTMLTableElement, hostWidth: number): HTMLElement {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: hostWidth, configurable: true });
  host.append(el);
  document.body.append(host);
  return host;
}

function stubMeasure(profiles: readonly { min: number; max: number }[]): ColumnMeasurer {
  return () => profiles;
}

const FIXED_MIN_LEGIBLE = (): number => 60;

function options(measure: ColumnMeasurer, handSet: Map<number, TableHandSet> = new Map()) {
  return { measure, minLegiblePx: FIXED_MIN_LEGIBLE, handSet };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** 10px a character — a stand-in for the real per-token measurement jsdom cannot make. */
const TEN_PX_A_CHARACTER = (text: string): number => text.length * 10;

function withTokens(measure: ColumnMeasurer) {
  return { ...options(measure), measureToken: TEN_PX_A_CHARACTER };
}

const NOWRAP = '.preview-table-nowrap';

describe('measureColumns — measured under the table\'s own host (T074, R15, FR-060, FR-061)', () => {
  it('measures a clone that sits inside the table\'s host, so the preview\'s cell rules apply to it', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    host.className = 'preview-markdown';

    const seenIn: (Element | null)[] = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.tagName === 'TD' && !t.contains(this)) seenIn.push(this.closest('.preview-markdown'));
      return new DOMRect(0, 0, 10, 10);
    });

    measureColumns(t);

    expect(seenIn.length).toBeGreaterThan(0);
    // Every cell the clone measured was inside `.preview-markdown`, not hanging off <body>.
    expect(seenIn.every((h) => h === host)).toBe(true);
  });

  it('leaves nothing behind in the host', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    measureColumns(t);
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild).toBe(t);
  });
});

describe('applyTableLayout — hyphenated tokens stay whole (T075, R15, FR-073)', () => {
  const two = stubMeasure([{ min: 20, max: 100 }, { min: 20, max: 100 }]);

  it('wraps a hyphenated token narrower than 40% of the available width in a nowrap span', () => {
    const t = table([['MT-01', 'needs retest'], ['x', 'y']]);
    const host = mount(t, 400); // 40% = 160px; "MT-01" = 50px
    applyTableLayout(host, withTokens(two));

    const spans = t.querySelectorAll<HTMLElement>(NOWRAP);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.textContent).toBe('MT-01');
    expect(spans[0]!.style.whiteSpace).toBe('nowrap');
    expect(t.rows[0]!.cells[0]!.textContent).toBe('MT-01');
  });

  it('leaves a token with no hyphen alone', () => {
    const t = table([['needs retest', '2a0a1d9404cb'], ['x', 'y']]);
    const host = mount(t, 400);
    applyTableLayout(host, withTokens(two));
    expect(t.querySelectorAll(NOWRAP)).toHaveLength(0);
  });

  it('leaves a token wider than 40% of the available width breakable (the last resort)', () => {
    const long = 'a-very-long-hyphenated-token-indeed'; // 35 chars = 350px > 160px
    const t = table([[long, 'ok-ok'], ['x', 'y']]);
    const host = mount(t, 400);
    applyTableLayout(host, withTokens(two));

    const wrapped = [...t.querySelectorAll(NOWRAP)].map((s) => s.textContent);
    expect(wrapped).toEqual(['ok-ok']);
  });

  it('measures the 40% against the host\'s content width, not its padded width', () => {
    const t = table([['abcdefgh-ij', 'z'], ['x', 'y']]); // 11 chars = 110px
    const host = mount(t, 400);
    host.style.paddingLeft = '100px';
    host.style.paddingRight = '100px'; // content 200px -> limit 80px, so 110px is too wide
    applyTableLayout(host, withTokens(two));
    expect(t.querySelectorAll(NOWRAP)).toHaveLength(0);
  });

  it('wraps a token inside a link and inside a code span, leaving the element and its text intact', () => {
    const t = table([['see ', 'run '], ['x', 'y']]);
    const a = document.createElement('a');
    a.textContent = 'go MT-01 now';
    t.rows[0]!.cells[0]!.append(a);
    const code = document.createElement('code');
    code.textContent = 'npm-run';
    t.rows[0]!.cells[1]!.append(code);
    const host = mount(t, 400);
    applyTableLayout(host, withTokens(two));

    expect(a.querySelector(NOWRAP)?.textContent).toBe('MT-01');
    expect(a.textContent).toBe('go MT-01 now');
    expect(code.querySelector(NOWRAP)?.textContent).toBe('npm-run');
    expect(code.textContent).toBe('npm-run');
  });

  it('leaves a token split across inline elements alone', () => {
    const t = table([['x', 'y'], ['x', 'y']]);
    const cell = t.rows[0]!.cells[0]!;
    cell.textContent = '';
    const link = document.createElement('a');
    link.textContent = '01';
    cell.append('MT-', link); // "MT-" then a link holding "01"
    const cell2 = t.rows[0]!.cells[1]!;
    cell2.textContent = '';
    const em = document.createElement('em');
    em.textContent = 'foo-';
    cell2.append(em, 'bar'); // "foo-" inside an element, "bar" after it
    const host = mount(t, 400);
    applyTableLayout(host, withTokens(two));

    expect(t.querySelectorAll(NOWRAP)).toHaveLength(0);
  });

  it('is idempotent: repeated layouts neither nest nor multiply the spans, and the text is unchanged', () => {
    const t = table([['MT-01 and MT-02', 'y'], ['x', 'y']]);
    const host = mount(t, 400);
    applyTableLayout(host, withTokens(two));
    applyTableLayout(host, withTokens(two));

    expect(t.querySelectorAll(NOWRAP)).toHaveLength(2);
    expect(t.querySelectorAll(`${NOWRAP} ${NOWRAP}`)).toHaveLength(0);
    expect(t.rows[0]!.cells[0]!.textContent).toBe('MT-01 and MT-02');
  });

  it('wraps tokens before it measures, so the measurer sees them', () => {
    const t = table([['MT-01', 'y'], ['x', 'y']]);
    const host = mount(t, 400);
    let spansAtMeasure = -1;
    applyTableLayout(host, withTokens((tbl) => {
      spansAtMeasure = tbl.querySelectorAll(NOWRAP).length;
      return [{ min: 20, max: 100 }, { min: 20, max: 100 }];
    }));
    expect(spansAtMeasure).toBe(1);
  });
});

describe('applyTableLayout — fitting table (T065/T066)', () => {
  it('applies a colgroup with table-layout: fixed; width: 100%, one <col> per column', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    applyTableLayout(host, options(stubMeasure([{ min: 20, max: 100 }, { min: 20, max: 100 }])));

    expect(t.style.tableLayout).toBe('fixed');
    expect(t.style.width).toBe('100%');
    const colgroup = t.querySelector(':scope > colgroup');
    expect(colgroup?.children).toHaveLength(2);
    expect(t.firstElementChild).toBe(colgroup);
  });

  it('never wraps a fitting table in the scroll wrapper', () => {
    const t = table([['a'], ['1']]);
    const host = mount(t, 400);
    applyTableLayout(host, options(stubMeasure([{ min: 20, max: 100 }])));
    expect(host.querySelector(`.${SCROLL_WRAPPER_CLASS}`)).toBeNull();
    expect(t.parentElement).toBe(host);
  });

  it('lays out the front-matter table too — no special-casing needed', () => {
    const t = table([['title', 'My Doc']]);
    t.className = 'preview-markdown__front-matter';
    const host = mount(t, 400);
    applyTableLayout(host, options(stubMeasure([{ min: 20, max: 80 }, { min: 20, max: 120 }])));
    expect(t.querySelector(':scope > colgroup')?.children).toHaveLength(2);
  });
});

/*
 * Found by the T072 survey (2026-09-28): with the preview's fold gutter on, `.preview-markdown` carries
 * `padding-inline-start: 2em`, and every table was sized to the host's `clientWidth` — which INCLUDES
 * that padding — so each one ended a gutter's width past the panel and the body scrolled sideways.
 * Measured in the running app: article 262px wide, table 263px, starting 26px in.
 */
describe('applyTableLayout — the space a table may take excludes the host\'s padding (SC-006a)', () => {
  it('shares only the content box among the columns', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    host.style.paddingLeft = '40px';
    host.style.paddingRight = '10px';
    applyTableLayout(host, options(stubMeasure([{ min: 20, max: 1000 }, { min: 20, max: 1000 }])));

    const cols = [...t.querySelectorAll<HTMLElement>(':scope > colgroup > col')];
    const total = cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0);
    expect(total).toBeLessThanOrEqual(350);
    expect(host.querySelector(`.${SCROLL_WRAPPER_CLASS}`)).toBeNull();
  });
});

describe('applyTableLayout — overflow (FR-062)', () => {
  it('keeps the table at its floors and wraps it in a horizontally scrolling container', () => {
    const t = table([['a', 'b', 'c'], ['1', '2', '3']]);
    // Each minimum is under 40% of the panel (160px), so none is capped (FR-073) — but together they
    // exceed it.
    const host = mount(t, 400);
    applyTableLayout(
      host,
      options(stubMeasure([{ min: 150, max: 300 }, { min: 150, max: 300 }, { min: 150, max: 300 }])),
    );

    const wrapper = host.querySelector<HTMLElement>(`.${SCROLL_WRAPPER_CLASS}`);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.contains(t)).toBe(true);
    expect(t.style.width).toBe('450px'); // each floor at max(60, 150) = 150
  });
});

describe('applyTableLayout — a word wider than 40% of the panel breaks rather than scroll (T086, FR-073)', () => {
  it('caps that column\'s minimum at 40% of the available width, so the table fits', () => {
    const t = table([['url', 'note'], ['https://example.com/averyveryverylongpathwithnohyphens', 'short']]);
    const host = mount(t, 500); // 40% = 200
    // Without the cap: 400 + 150 = 550 > 500, and the table would scroll.
    applyTableLayout(host, options(stubMeasure([{ min: 400, max: 400 }, { min: 150, max: 300 }])));

    expect(host.querySelector(`.${SCROLL_WRAPPER_CLASS}`)).toBeNull();
    const cols = [...t.querySelectorAll<HTMLElement>(':scope > colgroup > col')];
    const total = cols.reduce((sum, col) => sum + parseFloat(col.style.width), 0);
    expect(total).toBeLessThanOrEqual(500);
    expect(parseFloat(cols[1]!.style.width)).toBeGreaterThanOrEqual(150); // the other column keeps its word whole
  });

  it('leaves a minimum under the limit alone', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 1000); // 40% = 400
    applyTableLayout(host, options(stubMeasure([{ min: 390, max: 390 }, { min: 50, max: 2000 }])));
    const cols = [...t.querySelectorAll<HTMLElement>(':scope > colgroup > col')];
    expect(parseFloat(cols[0]!.style.width)).toBeGreaterThanOrEqual(390);
  });
});

describe('applyTableLayout — resize handles (FR-063/064)', () => {
  it('draws a handle between columns, none after the last, styled col-resize', () => {
    const t = table([['a', 'b', 'c'], ['1', '2', '3']]);
    const host = mount(t, 600);
    applyTableLayout(host, options(stubMeasure([{ min: 20, max: 100 }, { min: 20, max: 100 }, { min: 20, max: 100 }])));

    const cells = [...t.rows[0]!.cells];
    expect(cells[0]!.querySelector(`.${RESIZE_HANDLE_CLASS}`)).not.toBeNull();
    expect(cells[1]!.querySelector(`.${RESIZE_HANDLE_CLASS}`)).not.toBeNull();
    expect(cells[2]!.querySelector(`.${RESIZE_HANDLE_CLASS}`)).toBeNull(); // no handle after the last column
  });

  it('a drag on a handle changes that column live and records the hand-set width', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    const handSet = new Map<number, TableHandSet>();
    const onResize = vi.fn();
    applyTableLayout(host, { ...options(stubMeasure([{ min: 20, max: 100 }, { min: 20, max: 100 }]), handSet), onResize });

    const handle = t.rows[0]!.cells[0]!.querySelector<HTMLElement>(`.${RESIZE_HANDLE_CLASS}`)!;
    const col = t.querySelector('colgroup')!.children[0] as HTMLElement;
    const startWidth = parseFloat(col.style.width);

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 140, bubbles: true }));

    expect(parseFloat(col.style.width)).toBe(startWidth + 40);
    expect(handSet.get(0)?.get(0)).toBe(startWidth + 40);
    expect(onResize).toHaveBeenCalledWith(0, 0, startWidth + 40);

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 999, bubbles: true }));
    // After pointerup, further pointermove events must not keep resizing.
    expect(parseFloat(col.style.width)).toBe(startWidth + 40);
  });
});

describe('relayoutTables — a resize re-shares, it never re-measures (Principle XII, MT-07)', () => {
  const widthsOf = (t: HTMLTableElement): number[] =>
    [...t.querySelectorAll<HTMLElement>(':scope > colgroup > col')].map((c) => parseFloat(c.style.width));

  it('re-shares the widths a draw measured at the new width, without measuring again', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    const measure = vi.fn(stubMeasure([{ min: 50, max: 1000 }, { min: 50, max: 1000 }]));
    const minLegible = vi.fn(FIXED_MIN_LEGIBLE);
    const opts = { measure, minLegiblePx: minLegible, handSet: new Map() };
    applyTableLayout(host, opts);
    const before = widthsOf(t);

    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    relayoutTables(host, opts);

    expect(widthsOf(t).reduce((a, b) => a + b, 0)).toBeGreaterThan(before.reduce((a, b) => a + b, 0));
    expect(measure).toHaveBeenCalledTimes(1);
    expect(minLegible).toHaveBeenCalledTimes(1);
  });

  it('changes nothing at all when the width did not change, so it cannot feed its own trigger', () => {
    const t = table([['MT-01', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    const opts = withTokens(stubMeasure([{ min: 50, max: 300 }, { min: 50, max: 300 }]));
    applyTableLayout(host, opts);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((r) => records.push(...r));
    observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    relayoutTables(host, opts);
    records.push(...observer.takeRecords());
    observer.disconnect();

    expect(records).toEqual([]);
  });

  it('holds or lets go a token as the width crosses its 40% limit, without re-walking the text', () => {
    const t = table([['abcdefgh-ij', 'z'], ['x', 'y']]); // 110px: held at 400 (limit 160), let go at 200 (80)
    const host = mount(t, 400);
    const opts = withTokens(stubMeasure([{ min: 20, max: 100 }, { min: 20, max: 100 }]));
    applyTableLayout(host, opts);
    expect(t.querySelectorAll(NOWRAP)).toHaveLength(1);

    Object.defineProperty(host, 'clientWidth', { value: 200, configurable: true });
    relayoutTables(host, opts);
    expect(t.querySelectorAll(NOWRAP)).toHaveLength(0);

    Object.defineProperty(host, 'clientWidth', { value: 400, configurable: true });
    relayoutTables(host, opts);
    expect(t.querySelectorAll(NOWRAP)).toHaveLength(1);
    expect(t.rows[0]!.cells[0]!.textContent).toBe('abcdefgh-ij');
  });

  it('moves a table into and out of the scroll wrapper as its minimums stop and start fitting', () => {
    const t = table([['a', 'b', 'c'], ['1', '2', '3']]);
    const host = mount(t, 600);
    const opts = options(stubMeasure([{ min: 150, max: 300 }, { min: 150, max: 300 }, { min: 150, max: 300 }]));
    applyTableLayout(host, opts);
    expect(host.querySelector(`.${SCROLL_WRAPPER_CLASS}`)).toBeNull();

    Object.defineProperty(host, 'clientWidth', { value: 400, configurable: true });
    relayoutTables(host, opts);
    expect(host.querySelector(`.${SCROLL_WRAPPER_CLASS}`)?.contains(t)).toBe(true);

    Object.defineProperty(host, 'clientWidth', { value: 600, configurable: true });
    relayoutTables(host, opts);
    expect(host.querySelector(`.${SCROLL_WRAPPER_CLASS}`)).toBeNull();
    expect(t.parentElement).toBe(host);
  });
});

describe('measureTables — every table measured in one pass (Principle XII)', () => {
  it('reads every clone only after every clone is set up, and leaves nothing behind', () => {
    const a = table([['a', 'b'], ['1', '2']]);
    const b = table([['c', 'd', 'e'], ['1', '2', '3']]);
    const host = mount(a, 400);
    host.append(b);
    const events: string[] = [];
    const append = HTMLElement.prototype.append;
    vi.spyOn(HTMLElement.prototype, 'append').mockImplementation(function (this: HTMLElement, ...nodes) {
      if (nodes.some((n) => n instanceof HTMLTableElement)) events.push('clone');
      return append.apply(this, nodes);
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
      events.push('read');
      return new DOMRect(0, 0, 10, 10);
    });

    const profiles = measureTables([a, b]);

    expect(profiles.map((p) => p.length)).toEqual([2, 3]);
    expect(events.lastIndexOf('clone')).toBeLessThan(events.indexOf('read'));
    expect(host.children).toHaveLength(2);
  });
});

describe('applyTableLayout — hand-set widths (FR-064)', () => {
  it('survive a re-render of the same file: re-applying with the SAME handSet map keeps the width', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    const handSet = new Map<number, TableHandSet>([[0, new Map([[0, 250]])]]);
    const measure = stubMeasure([{ min: 20, max: 100 }, { min: 20, max: 100 }]);

    applyTableLayout(host, options(measure, handSet));
    expect((t.querySelector('colgroup')!.children[0] as HTMLElement).style.width).toBe('250px');

    // A fresh table element, as a live re-render would replace it, laid out again with the SAME map.
    const t2 = table([['a', 'b'], ['1', '2']]);
    t.replaceWith(t2);
    applyTableLayout(host, options(measure, handSet));
    expect((t2.querySelector('colgroup')!.children[0] as HTMLElement).style.width).toBe('250px');
  });

  it('are dropped on navigation — a caller that starts a fresh map gets the fair-share width back', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    const measure = stubMeasure([{ min: 20, max: 100 }, { min: 20, max: 100 }]);
    applyTableLayout(host, options(measure, new Map([[0, new Map([[0, 250]])]])));
    expect((t.querySelector('colgroup')!.children[0] as HTMLElement).style.width).toBe('250px');

    // Navigation: the caller (markdown-body.tsx) starts a FRESH map — this module never persists one.
    applyTableLayout(host, options(measure, new Map()));
    expect((t.querySelector('colgroup')!.children[0] as HTMLElement).style.width).not.toBe('250px');
  });
});

describe('applyTableLayout — idempotent across repeated calls (a settings change with no new render)', () => {
  it('never duplicates a colgroup or a handle', () => {
    const t = table([['a', 'b'], ['1', '2']]);
    const host = mount(t, 400);
    const opts = options(stubMeasure([{ min: 20, max: 100 }, { min: 20, max: 100 }]));
    applyTableLayout(host, opts);
    applyTableLayout(host, opts);
    expect(t.querySelectorAll(':scope > colgroup')).toHaveLength(1);
    expect(t.querySelectorAll(`.${RESIZE_HANDLE_CLASS}`)).toHaveLength(1);
  });
});
