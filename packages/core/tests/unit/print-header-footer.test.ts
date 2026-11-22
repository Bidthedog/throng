/**
 * Each printed page's header and footer (maintainer, 2026-11-22: "'File name on page' needs to be split into two text
 * boxes - header and footer. Each supports placeholders and require a checkbox to enable / disable their output …
 * Placeholder values supported are {fileName}, {fileExt}, {path}, {page}, {totalPages}. Each box also needs an
 * 'alignment' drop down with three options - left, right, center").
 *
 * They are drawn by `printToPDF`'s header and footer templates, so the pages Print Preview shows are the pages that
 * print, placeholders filled in.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINT_SETTINGS,
  formatPrintTimeStamp,
  parsePrintSettings,
  printBandHtml,
  serialisePrintSettings,
  toPdfOptions,
  type PrintSettings,
} from '../../src/index.js';

const PRINTERS = [{ name: 'home', isDefault: true }];
const FILE = { path: '/home/u/docs/notes <draft>.md', title: 'notes <draft>.md' };

const withBands = (header: Partial<PrintSettings['header']>, footer: Partial<PrintSettings['footer']> = {}): PrintSettings => ({
  ...DEFAULT_PRINT_SETTINGS,
  header: { ...DEFAULT_PRINT_SETTINGS.header, ...header },
  footer: { ...DEFAULT_PRINT_SETTINGS.footer, ...footer },
});

describe('the header and the footer', () => {
  // Maintainer, 2026-11-22: "Header: {filePath} center aligned. Footer: Page {page} of {totalPages} right aligned".
  it('are off until asked for, with the path centred in the header and the page number right in the footer ready', () => {
    expect(DEFAULT_PRINT_SETTINGS.header).toEqual({ enabled: false, text: '{path}', align: 'center' });
    expect(DEFAULT_PRINT_SETTINGS.footer).toEqual({ enabled: false, text: 'Page {page} of {totalPages}', align: 'right' });
    expect(toPdfOptions(DEFAULT_PRINT_SETTINGS, undefined, 'width', FILE).displayHeaderFooter).toBeUndefined();
  });

  it('are kept across sessions; a malformed field takes its default', () => {
    const s = { ...withBands({ enabled: true, text: '{path}', align: 'right' }, { enabled: true, text: '{page}', align: 'left' }), printer: 'home' };
    const back = parsePrintSettings(JSON.parse(JSON.stringify(serialisePrintSettings(s))).settings, PRINTERS);
    expect(back.header).toEqual(s.header);
    expect(back.footer).toEqual(s.footer);
    const bad = parsePrintSettings({ header: { enabled: 'yes', text: 7, align: 'middle' } }, PRINTERS);
    expect(bad.header).toEqual(DEFAULT_PRINT_SETTINGS.header);
  });

  it('take over a file-name choice saved before they existed', () => {
    expect(parsePrintSettings({ fileLabel: 'path-footer' }, PRINTERS).footer).toEqual({ enabled: true, text: '{path}', align: 'center' });
    expect(parsePrintSettings({ fileLabel: 'name-header' }, PRINTERS).header).toEqual({ enabled: true, text: '{fileName}{fileExt}', align: 'center' });
    expect(parsePrintSettings({ fileLabel: 'none' }, PRINTERS).header.enabled).toBe(false);
  });

  it('fill the file placeholders, escaped, and leave the page numbers to Chromium', () => {
    expect(printBandHtml('{fileName} — {fileExt} — {path}', FILE)).toBe('notes &lt;draft&gt; — .md — /home/u/docs/notes &lt;draft&gt;.md');
    expect(printBandHtml('Page {page} of {totalPages}', FILE)).toBe('Page <span class="pageNumber"></span> of <span class="totalPages"></span>');
  });

  it('print anything else as typed, markup included', () => {
    expect(printBandHtml('{unknown} <b>&', FILE)).toBe('{unknown} &lt;b&gt;&amp;');
  });

  it('name a file with no extension, and a file with no path by its title', () => {
    expect(printBandHtml('[{fileName}][{fileExt}]', { path: 'C:\\proj\\Makefile', title: 'Makefile' })).toBe('[Makefile][]');
    expect(printBandHtml('{fileName}{fileExt} {path}', { title: 'Untitled 3' })).toBe('Untitled 3 Untitled 3');
  });

  it('draw each enabled band where its alignment says, and an empty template for one that is off', () => {
    const o = toPdfOptions(withBands({ enabled: true, align: 'right' }), undefined, 'width', FILE);
    expect(o.displayHeaderFooter).toBe(true);
    expect(o.headerTemplate).toContain('text-align:right');
    expect(o.headerTemplate).toContain('notes &lt;draft&gt;.md');
    expect(o.footerTemplate).toBe('<span></span>');
  });
});

// Maintainer, 2026-11-22: "Add a header / footer placeholder for {timeStamp} which prints the current date in the user's
// current locale (short - `01/12/26 @ 13:01`)".
// 075 T081 (FR-071): a file with no path is named by its title, split as a file name is, so the pair gives it whole.
describe('a printed file with no path', () => {
  it('gives its title for {path}, and splits it for {fileName} and {fileExt}', () => {
    expect(printBandHtml('{fileName}|{fileExt}|{path}', { title: 'Untitled-2.md' })).toBe('Untitled-2|.md|Untitled-2.md');
    expect(printBandHtml('{fileName}{fileExt}', { title: 'Untitled-2.md' })).toBe('Untitled-2.md');
  });
});

describe('{timeStamp}', () => {
  const AT = new Date(2026, 11, 1, 13, 1);

  it('is the date and time, short, in the locale, joined by @', () => {
    expect(formatPrintTimeStamp(AT, 'en-GB')).toBe('01/12/26 @ 13:01');
    expect(formatPrintTimeStamp(AT, 'en-US')).toMatch(/^12\/01\/26 @ 01:01\sPM$/);
  });

  it('fills a band with the time the pages were drawn', () => {
    expect(printBandHtml('Printed {timeStamp}', { ...FILE, timeStamp: '01/12/26 @ 13:01' })).toBe('Printed 01/12/26 @ 13:01');
    expect(toPdfOptions(withBands({ enabled: true, text: '{timeStamp}' }), undefined, 'width', { ...FILE, timeStamp: 'x<y' }).headerTemplate).toContain('x&lt;y');
  });
});
