/**
 * The grid's column letters and clipboard formats (073 FR-002, FR-024, FR-037a, FR-037c).
 *
 * Copy writes the selection as tab-separated rows — the plain-text form every spreadsheet application
 * pastes as cells — quoting a cell only where a tab, a quote or a line break would otherwise split it.
 * The rich form is a text-only HTML table: every cell escaped, no attribute, no markup from the data.
 * Paste reads the same tab-separated form back, from throng or from another application.
 *
 * Pure: no OS, no DOM.
 */

import { escapeHtml } from '../text/escape-html.js';

/** Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLabel(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function tsvCell(value: string): string {
  return /[\t"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows of cells as tab-separated text, rows joined by line feeds, with no trailing line break. */
export function gridToTsv(cells: readonly (readonly string[])[]): string {
  return cells.map((row) => row.map(tsvCell).join('\t')).join('\n');
}

/** Tab-separated text as rows of cells. One trailing line break is the copy's, not an empty row. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i <= n) {
    let value = '';
    if (text[i] === '"') {
      i++;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i];
        i++;
      }
    }
    while (i < n && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') value += text[i++];
    row.push(value);
    if (i >= n) {
      rows.push(row);
      break;
    }
    if (text[i] === '\t') {
      i++;
      continue;
    }
    // A line break ends the row; CRLF counts once.
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
    if (i >= n) break;
  }
  return rows;
}


/** Rows of cells as a text-only HTML table (FR-024's rich format). */
export function gridToHtmlTable(cells: readonly (readonly string[])[]): string {
  const body = cells.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table><tbody>${body}</tbody></table>`;
}
