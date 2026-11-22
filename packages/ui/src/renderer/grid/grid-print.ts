/**
 * Printing a grid preview — a CSV Preview Editor, a workbook's sheet — as a table (075 FR-075b; the maintainer,
 * 2026-11-20: "Add support for printing to PDFs, image previews, CSVs and editors").
 *
 * The grid on screen is virtualised: it draws only the rows in view, so a clone of its DOM (how a Markdown preview
 * prints) would print a screenful. A grid body therefore REGISTERS what it shows — its rows, its columns, its header
 * row and its column widths — on its root element ({@link registerGridPrintSource}), and the view's `printable`
 * reads it back from the body it is handed ({@link gridPrintable}). The table it builds holds every row:
 *
 * - The header row, when the grid treats the file's first row as headers (a CSV's Lock first row, a workbook's
 *   First row is header), is the table's head, which Chromium repeats at the top of every printed page.
 * - Column widths are the grid's, as shares of the page width, so the columns keep their proportions and the table
 *   is exactly as wide as the text column. A cell wraps rather than overflowing its column.
 * - A row never splits across a page: the page breaks between rows.
 *
 * The document runs nothing and requests nothing; it carries the print palette's colours (FR-072).
 */
import { PRINT_PALETTE, type PrintableOutput } from '@throng/core';
import { GRID_DEFAULT_COLUMN_WIDTH } from './data-grid.js';
import { escapeHtml } from '@throng/core';

/** What a grid shows, read when Print… runs. */
export interface GridPrintSource {
  /** Data rows, the header row excluded. */
  readonly rowCount: number;
  readonly colCount: number;
  cell(row: number, col: number): string;
  /** The header row's labels, or `null` when the grid has no header row (its columns are lettered on screen only). */
  readonly header: readonly string[] | null;
  /** A column's width on screen, in pixels; absent: the grid's default. */
  width(col: number): number | undefined;
}

/** On a grid body's root element: it holds a print source. */
export const GRID_PRINT_ATTRIBUTE = 'data-grid-print';

const sources = new WeakMap<Element, () => GridPrintSource>();

/** Register `read` as what `root` prints. Returns the release. */
export function registerGridPrintSource(root: Element, read: () => GridPrintSource): () => void {
  sources.set(root, read);
  root.setAttribute(GRID_PRINT_ATTRIBUTE, '');
  return () => {
    if (sources.get(root) === read) sources.delete(root);
    root.removeAttribute(GRID_PRINT_ATTRIBUTE);
  };
}

/** The print source registered on `body` or an element inside it. */
export function gridPrintSourceIn(body: HTMLElement): (() => GridPrintSource) | undefined {
  const root = body.hasAttribute(GRID_PRINT_ATTRIBUTE) ? body : body.querySelector(`[${GRID_PRINT_ATTRIBUTE}]`);
  return root === null ? undefined : sources.get(root);
}


/** Each column's share of the table's width, in percent, from the grid's widths. */
export function columnShares(source: GridPrintSource): number[] {
  const widths = Array.from({ length: source.colCount }, (_, c) => {
    const w = source.width(c);
    return w !== undefined && Number.isFinite(w) && w > 0 ? w : GRID_DEFAULT_COLUMN_WIDTH;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  return total > 0 ? widths.map((w) => (w / total) * 100) : [];
}

// No `@page`: the paper, margins and scale are Print Preview's, applied by the layout (FR-066).
const STYLE = `
html, body { margin: 0; padding: 0; background: ${PRINT_PALETTE.surface}; color: ${PRINT_PALETTE.text}; }
body { font: 9pt system-ui, -apple-system, 'Segoe UI', sans-serif; }
table { width: 100%; table-layout: fixed; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 0.5pt solid ${PRINT_PALETTE.border}; padding: 2pt 4pt; text-align: left; vertical-align: top;
  white-space: pre-wrap; overflow-wrap: anywhere; }
th { background: ${PRINT_PALETTE.appBg}; font-weight: 600; }
`;

/** One row of the table. */
function rowHtml(source: GridPrintSource, r: number): string {
  let row = '<tr>';
  for (let c = 0; c < source.colCount; c++) row += `<td>${escapeHtml(source.cell(r, c))}</td>`;
  return `${row}</tr>`;
}

/** The document round `body`, the table's rows. */
function documentHtml(source: GridPrintSource, title: string, body: string): string {
  const cols = columnShares(source)
    .map((share) => `<col style="width:${share.toFixed(4)}%">`)
    .join('');
  const head =
    source.header === null
      ? ''
      : `<thead><tr>${Array.from({ length: source.colCount }, (_, c) => `<th>${escapeHtml(source.header?.[c] ?? '')}</th>`).join('')}</tr></thead>`;
  // Concatenated, not joined: the rows are already one string, and a join would copy them whole again.
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>${STYLE}</style>` +
    '</head><body class="throng-print throng-print--grid">' +
    `<table><colgroup>${cols}</colgroup>${head}<tbody>` +
    body +
    '</tbody></table></body></html>'
  );
}

/** The table document for `source`, built in one go: for a test, or a table known to be small. */
export function gridPrintHtml(source: GridPrintSource, title: string): string {
  const rows: string[] = [];
  for (let r = 0; r < source.rowCount; r++) rows.push(rowHtml(source, r));
  return documentHtml(source, title, rows.join(''));
}

/**
 * How long one slice of a table build may hold the renderer, in ms (Principle XII). Measured 2026-11-20: building
 * 100,000 rows × 50 columns in one go took 2.6 – 3.0 s (10,000 × 50: 0.22 – 0.26 s), long enough to freeze the panel,
 * so the rows are built in slices of this length, yielding to input between them.
 */
export const GRID_PRINT_SLICE_MS = 12;

/** How the time-sliced build reads the clock and gives the renderer back; injectable for a test. */
export interface GridPrintPacing {
  now(): number;
  yieldToInput(): Promise<void>;
}

const browserPacing: GridPrintPacing = {
  now: () => performance.now(),
  yieldToInput: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

/** How many rows are built between clock reads: reading it per row would cost more than the rows. */
const ROWS_PER_CHECK = 64;

/** The table document for `source`, built in slices of {@link GRID_PRINT_SLICE_MS}, yielding to input between them. */
export async function gridPrintHtmlSliced(source: GridPrintSource, title: string, pacing: GridPrintPacing = browserPacing): Promise<string> {
  // Each slice's rows are joined as the slice ends, and the slices concatenated: one join of the whole table at the
  // end held the renderer for over half a second at 100,000 rows (measured 2026-11-20).
  let body = '';
  let slice: string[] = [];
  let sliceStart = pacing.now();
  for (let r = 0; r < source.rowCount; r++) {
    slice.push(rowHtml(source, r));
    if ((r + 1) % ROWS_PER_CHECK === 0 && pacing.now() - sliceStart >= GRID_PRINT_SLICE_MS) {
      body += slice.join('');
      slice = [];
      await pacing.yieldToInput();
      sliceStart = pacing.now();
    }
  }
  body += slice.join('');
  return documentHtml(source, title, body);
}

/** A grid view's `printable`: the table of what the body's grid shows, or a refusal when it holds none yet. */
export async function gridPrintable(body: HTMLElement, title: string, pacing?: GridPrintPacing): Promise<PrintableOutput> {
  const read = gridPrintSourceIn(body);
  if (read === undefined) throw new Error('The grid has not drawn yet.');
  // Read once, now: the rows are what the grid showed when Print… ran, even if it changes while they are built.
  const source = read();
  return { kind: 'document', html: await gridPrintHtmlSliced(source, title, pacing), fit: 'width', remoteImages: [] };
}
