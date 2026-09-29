/**
 * Fair table-column widths for a Markdown preview (047 T065/T066, R13, FR-060 – FR-068,
 * data-model.md "ColumnProfile / fair widths").
 *
 * Provider agnostic (FR-068) — nothing here names Markdown, even though the Markdown body is its only
 * caller today. `@throng/core`'s `fairColumnWidths` is the pure arithmetic (water-filling: every
 * column at `min(max, max(minLegible, min))`, surplus redistributed, never above its own max-content);
 * this module is the DOM half: measuring, applying a `<colgroup>`, drawing resize handles, and keeping
 * a reader's own drag alive across a live re-render of the SAME file.
 *
 * ══ MEASUREMENT IS INJECTED ══
 *
 * A REAL measurement needs a layout pass jsdom cannot give (`preview-table-layout.test.ts` supplies a
 * stub). The shipped `measureColumns` clones the table off-screen and reads each column's width once
 * with `width: max-content` and once with `width: min-content` — the browser's own intrinsic sizing,
 * never guessed at with character counts.
 *
 * ══ THRONG-CREATED, NEVER FROM DOCUMENT MARKUP (R6's rule, applied here too) ══
 *
 * The `<colgroup>` and every resize handle are inserted AFTER the pipeline's own render, exactly like
 * the fold gutter's toggles — `copy.ts` excludes the handle class from both plain and rich copy, and
 * it carries no text a find match could land on.
 *
 * ══ HAND-SET WIDTHS (FR-064) ══
 *
 * A drag writes into the `handSet` map the CALLER owns (`markdown-body.tsx`, per panel, per table
 * index within the document) — this module only reads and writes it, never persists it. Applying it
 * again over a live update (same file, new content) is what "survives a re-render" means; the caller
 * simply starts a FRESH map on navigation or close, which is what "dropped" means — nothing here
 * decides when that happens.
 */
import { fairColumnWidths, type ColumnProfile } from '@throng/core';

/** `8ch` (R13) — recorded as a layout constant, not a tunable; converted to px once per table (`chToPx`). */
export const MIN_LEGIBLE_CH = 8;

export const RESIZE_HANDLE_CLASS = 'preview-table-resize-handle';
export const SCROLL_WRAPPER_CLASS = 'preview-table-scroll';

export type ColumnMeasurer = (table: HTMLTableElement) => readonly ColumnProfile[];

/** One table's hand-set column widths (px), by column index. */
export type TableHandSet = Map<number, number>;

export interface TableLayoutOptions {
  /** Per column, in px. Column count MUST match the table's own column count, or that table is skipped. */
  readonly measure: ColumnMeasurer;
  /**
   * Every table at once — {@link measureTables}, which costs two layouts for the whole document where
   * `measure` per table costs two EACH. Preferred over `measure` when given.
   */
  readonly measureAll?: (tables: readonly HTMLTableElement[]) => readonly (readonly ColumnProfile[])[];
  /** `8ch` resolved to px against the tables' font — `chToPx(table)` by default; asked once per layout pass. */
  readonly minLegiblePx: (table: HTMLTableElement) => number;
  /** A token's width on one line in its cell (px) — measured in the cell's own font by default; injected by tests. */
  readonly measureToken?: (text: string, cell: HTMLElement) => number;
  /** tableIndex (this document's `querySelectorAll('table')` order) → that table's hand-set widths. */
  readonly handSet: Map<number, TableHandSet>;
  /** A drag changed a column's width — the caller may want to know, beyond reading `handSet` later. */
  readonly onResize?: (tableIndex: number, columnIndex: number, widthPx: number) => void;
}

/** The number of columns the FIRST row declares — every GFM/front-matter table renders with none spanned. */
function columnCountOf(table: HTMLTableElement): number {
  return table.rows[0]?.cells.length ?? 0;
}

/** A hyphenated token's `white-space: nowrap` wrapper (T075, FR-073) — throng-made, never document markup. */
export const NOWRAP_TOKEN_CLASS = 'preview-table-nowrap';

/** A token wider than this share of the available width may break (FR-073's last resort). */
const TOKEN_LIMIT = 0.4;

/** A word joined by a hyphen with a character either side of it: `MT-01`, not `-1` or `well-`. */
const HYPHENATED = /[^\s-]-[^\s-]/;

/**
 * Every hyphenated token's wrapper (T075) — throng-made. {@link NOWRAP_TOKEN_CLASS} is added only to the
 * ones held whole; a token wider than the limit keeps its wrapper, unheld, so a later resize can hold it
 * again by toggling a class rather than re-walking the text (Principle XII).
 */
export const TOKEN_CLASS = 'preview-table-token';

function holdToken(span: HTMLElement, hold: boolean): void {
  if (span.classList.contains(NOWRAP_TOKEN_CLASS) === hold) return;
  span.classList.toggle(NOWRAP_TOKEN_CLASS, hold);
  span.style.whiteSpace = hold ? 'nowrap' : '';
}

/** The character just beyond `node` in reading order, climbing out of inline elements; `''` at the cell's edge. */
function adjacentChar(node: Node, direction: 'prev' | 'next', stop: Node): string {
  let current: Node | null = node;
  while (current && current !== stop) {
    const sibling: Node | null = direction === 'prev' ? current.previousSibling : current.nextSibling;
    if (!sibling) {
      current = current.parentNode;
      continue;
    }
    if (sibling.nodeName === 'BR') return ' ';
    const text = sibling.textContent ?? '';
    if (text) return direction === 'prev' ? text[text.length - 1]! : text[0]!;
    current = sibling;
  }
  return '';
}

/**
 * Wrap each hyphenated token in a span, held whole (`nowrap`) to begin with, so a line never breaks at
 * its hyphen (`MT-` / `01`) — CSS has no property to forbid that (R15). Text nodes only: a token that
 * carries on into a neighbouring element (`MT-<a>01</a>`) is left alone. WRITES only — the widths that
 * decide which stay held are read afterwards, all together (Principle XII: never a read per token).
 */
function wrapHyphenatedTokens(table: HTMLTableElement): HTMLElement[] {
  const doc = table.ownerDocument;
  const spans: HTMLElement[] = [];
  for (const cell of table.querySelectorAll<HTMLElement>('th, td')) {
    const walker = doc.createTreeWalker(cell, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

    for (const node of nodes) {
      const text = node.data;
      const pieces: (string | HTMLElement)[] = [];
      let last = 0;
      for (const match of text.matchAll(/\S+/g)) {
        const token = match[0];
        const start = match.index;
        const end = start + token.length;
        if (!HYPHENATED.test(token)) continue;
        if (start === 0 && /\S/.test(adjacentChar(node, 'prev', cell))) continue;
        if (end === text.length && /\S/.test(adjacentChar(node, 'next', cell))) continue;
        const span = doc.createElement('span');
        span.className = TOKEN_CLASS;
        holdToken(span, true);
        span.textContent = token;
        spans.push(span);
        pieces.push(text.slice(last, start), span);
        last = end;
      }
      if (pieces.length === 0) continue;
      pieces.push(text.slice(last));
      node.replaceWith(...pieces.filter((p) => p !== ''));
    }
  }
  return spans;
}

function removeTokenSpans(table: HTMLTableElement): void {
  const spans = table.querySelectorAll(`.${TOKEN_CLASS}`);
  if (spans.length === 0) return;
  for (const span of spans) span.replaceWith(...span.childNodes);
  table.normalize();
}

function clearPreviousLayout(table: HTMLTableElement): void {
  laidOut.delete(table);
  removeTokenSpans(table);
  table.querySelector(':scope > colgroup')?.remove();
  for (const handle of table.querySelectorAll(`.${RESIZE_HANDLE_CLASS}`)) handle.remove();
  const wrapper = table.parentElement;
  if (wrapper?.classList.contains(SCROLL_WRAPPER_CLASS)) {
    wrapper.replaceWith(table);
  }
}

function attachDrag(
  handle: HTMLElement,
  col: HTMLTableColElement,
  tableIndex: number,
  columnIndex: number,
  options: TableLayoutOptions,
): void {
  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const doc = handle.ownerDocument;
    const win = doc.defaultView;
    const startX = e.clientX;
    const startWidth = col.getBoundingClientRect().width || parseFloat(col.style.width) || 0;

    const onMove = (moveEvent: PointerEvent): void => {
      const next = Math.max(1, Math.round(startWidth + (moveEvent.clientX - startX)));
      col.style.width = `${next}px`;
      let forTable = options.handSet.get(tableIndex);
      if (!forTable) {
        forTable = new Map();
        options.handSet.set(tableIndex, forTable);
      }
      forTable.set(columnIndex, next);
      options.onResize?.(tableIndex, columnIndex, next);
    };
    const onUp = (): void => {
      win?.removeEventListener('pointermove', onMove);
      win?.removeEventListener('pointerup', onUp);
    };
    win?.addEventListener('pointermove', onMove);
    win?.addEventListener('pointerup', onUp);
  });
}

/** A resize handle for the border AFTER `columnIndex` — none after the last column. */
function insertHandles(table: HTMLTableElement, colgroup: HTMLTableColElement[], tableIndex: number, options: TableLayoutOptions): void {
  const headerCells = [...(table.rows[0]?.cells ?? [])];
  headerCells.forEach((cell, columnIndex) => {
    if (columnIndex === headerCells.length - 1) return;
    const handle = table.ownerDocument.createElement('div');
    handle.className = RESIZE_HANDLE_CLASS;
    (cell as HTMLElement).style.position = 'relative';
    attachDrag(handle, colgroup[columnIndex]!, tableIndex, columnIndex, options);
    cell.append(handle);
  });
}

/**
 * The width a child of `el` may take: its `clientWidth` less its own horizontal padding. `clientWidth`
 * includes the padding, and the preview's fold gutter IS padding (`.preview-markdown--gutter`), so a
 * table sized to `clientWidth` ended a gutter's width past the panel (T072 survey, SC-006a).
 */
function contentWidth(el: HTMLElement): number {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  const padding = (parseFloat(style?.paddingLeft ?? '') || 0) + (parseFloat(style?.paddingRight ?? '') || 0);
  return Math.max(0, el.clientWidth - padding);
}

/**
 * What a draw measured for one table — everything a resize needs, so a resize measures nothing
 * (Principle XII). None of it depends on the width: the columns' intrinsic sizes, `8ch`, each held
 * token's width. The width is the only input a resize changes, and `available` is what it was last laid
 * out at, so a notification with no width change does nothing at all (and cannot feed its own trigger).
 */
interface LaidOutTable {
  readonly tableIndex: number;
  readonly profiles: readonly ColumnProfile[];
  readonly minLegiblePx: number;
  readonly tokens: readonly { readonly span: HTMLElement; readonly width: number }[];
  readonly cols: readonly HTMLTableColElement[];
  available: number;
}

const laidOut = new WeakMap<HTMLTableElement, LaidOutTable>();

/** The element a table's width is shared out of — its host, looking past a scroll wrapper this module added. */
function hostOf(table: HTMLTableElement): HTMLElement | null {
  const parent = table.parentElement;
  return parent?.classList.contains(SCROLL_WRAPPER_CLASS) ? parent.parentElement : parent;
}

function availableFor(table: HTMLTableElement): number {
  const host = hostOf(table);
  return host ? contentWidth(host) : table.clientWidth;
}

/** Widths from what was measured, at `entry.available` — pure arithmetic, then style WRITES only. */
function applyWidths(table: HTMLTableElement, entry: LaidOutTable, options: TableLayoutOptions): void {
  // FR-073 — a column's minimum is its widest word only up to 40% of the panel: a word wider than that
  // (a long URL, path or hash) breaks inside its cell (`overflow-wrap: break-word`) rather than push the
  // table into a scrollbar.
  const wordLimit = entry.available * TOKEN_LIMIT;
  const profiles = entry.profiles.map((p) => (p.min > wordLimit ? { ...p, min: wordLimit } : p));
  const result = fairColumnWidths(entry.available, profiles, entry.minLegiblePx);

  const handSet = options.handSet.get(entry.tableIndex);
  const widths = result.widths.map((w, i) => handSet?.get(i) ?? w);
  entry.cols.forEach((col, i) => {
    const next = `${widths[i] ?? 0}px`;
    if (col.style.width !== next) col.style.width = next;
  });

  const wrapper = table.parentElement?.classList.contains(SCROLL_WRAPPER_CLASS) ? table.parentElement : null;
  if (result.overflow) {
    // FR-062 — the minimums alone exceed the panel: keep them, and let the table itself widen past
    // `available` inside a horizontally scrolling wrapper, rather than crush a column unreadable.
    table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
    if (wrapper === null) {
      const made = table.ownerDocument.createElement('div');
      made.className = SCROLL_WRAPPER_CLASS;
      table.replaceWith(made);
      made.append(table);
    }
  } else {
    if (table.style.width !== '100%') table.style.width = '100%';
    if (wrapper !== null) wrapper.replaceWith(table);
  }
}

/**
 * Lay out every table under `root` (a Markdown body's host, or any provider's) — idempotent per call.
 *
 * Phased so the whole document costs a FIXED number of layouts, however many tables and tokens it has
 * (Principle XII — measured at ~120 forced layouts per pass on a 21-table document when every table and
 * every token read its own): all writes, then `8ch`, then every width read together, then the held
 * tokens settled, then every table measured together, then every write.
 */
export function applyTableLayout(root: HTMLElement, options: TableLayoutOptions): void {
  const prepared = [...root.querySelectorAll<HTMLTableElement>('table')]
    .map((table, tableIndex) => {
      clearPreviousLayout(table);
      const count = columnCountOf(table);
      return count === 0 ? null : { table, tableIndex, count, spans: wrapHyphenatedTokens(table) };
    })
    .filter((p) => p !== null);
  if (prepared.length === 0) return;

  const minLegiblePx = options.minLegiblePx(prepared[0]!.table);

  // READS — every width this pass needs, with nothing written in between.
  const measureToken = options.measureToken;
  const read = prepared.map(({ table, spans }) => ({
    available: availableFor(table),
    tokens: spans.map((span) => ({
      span,
      width: measureToken
        ? measureToken(span.textContent ?? '', span.closest<HTMLElement>('th, td') ?? span)
        : span.getBoundingClientRect().width,
    })),
  }));

  // FR-073 — a token wider than 40% of the panel is let go before the columns are measured, so their
  // minimums count only the tokens that stay whole.
  prepared.forEach((_, i) => {
    const limit = read[i]!.available * TOKEN_LIMIT;
    for (const token of read[i]!.tokens) holdToken(token.span, token.width < limit);
  });

  const tables = prepared.map((p) => p.table);
  const measured = options.measureAll ? options.measureAll(tables) : tables.map((t) => options.measure(t));

  prepared.forEach(({ table, tableIndex, count }, i) => {
    const profiles = measured[i];
    if (profiles === undefined || profiles.length !== count) return; // a measurer that cannot answer leaves it be

    const colgroup = table.ownerDocument.createElement('colgroup');
    const cols = profiles.map(() => colgroup.appendChild(table.ownerDocument.createElement('col')));
    table.insertBefore(colgroup, table.firstChild);
    table.style.tableLayout = 'fixed';

    const entry: LaidOutTable = { tableIndex, profiles, minLegiblePx, tokens: read[i]!.tokens, cols, available: read[i]!.available };
    laidOut.set(table, entry);
    applyWidths(table, entry, options);
    insertHandles(table, cols, tableIndex, options);
  });
}

/**
 * A resize: re-share each table's width from what its last draw measured — no measurement, no DOM
 * rebuilt, and nothing at all for a table whose width did not change (Principle XII). The only reads are
 * the hosts' widths, all taken before anything is written. A table no draw has laid out is left for the
 * next draw.
 */
export function relayoutTables(root: HTMLElement, options: TableLayoutOptions): void {
  const tables = [...root.querySelectorAll<HTMLTableElement>('table')].filter((t) => laidOut.has(t));
  const widths = tables.map(availableFor);
  tables.forEach((table, i) => {
    const entry = laidOut.get(table)!;
    const available = widths[i]!;
    if (Math.abs(available - entry.available) < 0.5) return;
    entry.available = available;
    const limit = available * TOKEN_LIMIT;
    for (const token of entry.tokens) holdToken(token.span, token.width < limit);
    applyWidths(table, entry, options);
  });
}

/** `8ch` against `table`'s own font — a transient measuring span, never left in the document. */
export function chToPx(table: HTMLTableElement): number {
  const span = table.ownerDocument.createElement('span');
  span.style.position = 'absolute';
  span.style.visibility = 'hidden';
  span.style.width = `${MIN_LEGIBLE_CH}ch`;
  table.append(span);
  const px = span.getBoundingClientRect().width;
  span.remove();
  return px;
}

/**
 * The shipped measurer: each column's min-content and max-content, read from an off-screen clone —
 * `table-layout: auto` sizes naturally with `white-space: nowrap` forced for max-content, and allowed
 * to wrap against a `min-content`-sized container for min-content. No real layout in a unit/component
 * test (jsdom has none); exercised by `scripts/dev/table-fit-survey.mjs` in the running app (SC-006a).
 */
export function measureColumns(table: HTMLTableElement): readonly ColumnProfile[] {
  return measureTables([table])[0] ?? [];
}

/**
 * {@link measureColumns} for every table at once: all the clones are set up, THEN all read, so the whole
 * document costs two layouts rather than two per table (Principle XII).
 */
export function measureTables(tables: readonly HTMLTableElement[]): (readonly ColumnProfile[])[] {
  const clones = tables.map((table) => {
    if (columnCountOf(table) === 0) return null;
    const clone = table.cloneNode(true) as HTMLTableElement;
    clone.querySelector(':scope > colgroup')?.remove();
    for (const handle of clone.querySelectorAll(`.${RESIZE_HANDLE_CLASS}`)) handle.remove();
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.left = '-99999px';
    clone.style.top = '0';
    clone.style.tableLayout = 'auto';
    // R15 — beside the table, inside its own host, so every rule that styles the real table (cell padding,
    // `th` weight, the preview's font) styles the clone too. On `document.body` none of them applied and
    // every width came out short of what the cell draws.
    (table.parentElement ?? table.ownerDocument.body).append(clone);
    return clone;
  });

  const widthsAt = (cssWidth: string, whiteSpace: string): number[][] => {
    for (const clone of clones) {
      if (clone === null) continue;
      clone.style.width = cssWidth;
      for (const cell of clone.querySelectorAll<HTMLElement>('th, td')) cell.style.whiteSpace = whiteSpace;
    }
    return clones.map((clone) => {
      const row = clone?.rows[0];
      return row ? [...row.cells].map((cell) => cell.getBoundingClientRect().width) : [];
    });
  };

  const max = widthsAt('max-content', 'nowrap');
  const min = widthsAt('min-content', 'normal');
  for (const clone of clones) clone?.remove();

  return max.map((m, t) => m.map((w, i) => ({ min: min[t]?.[i] ?? w, max: w })));
}
