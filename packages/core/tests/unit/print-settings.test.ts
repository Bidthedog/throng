/**
 * 075 FR-068, FR-070 — the print settings Print Preview starts from, and the two mappings that make the pages shown
 * the pages printed.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINT_SETTINGS,
  parsePageRanges,
  parsePrintSettings,
  pickDefaultPrinter,
  serialisePrintSettings,
  toPdfOptions,
  toPrintOptions,
  printSheetHtml,
  type PrintSettings,
} from '../../src/preview/print.js';

const PRINTERS = [{ name: 'office' }, { name: 'home', isDefault: true }];
const withSettings = (over: Partial<PrintSettings>): PrintSettings => ({ ...DEFAULT_PRINT_SETTINGS, printer: 'home', ...over });

describe('parsePrintSettings (FR-070)', () => {
  it('falls back to the defaults, with the default printer, for a missing or malformed file', () => {
    for (const raw of [undefined, null, 'x', 42, [], {}]) {
      expect(parsePrintSettings(raw, PRINTERS)).toEqual({ ...DEFAULT_PRINT_SETTINGS, printer: 'home' });
    }
  });

  it('keeps every valid field and replaces each invalid one with its default, alone', () => {
    const parsed = parsePrintSettings(
      { printer: 'office', pageSize: 'Letter', orientation: 'sideways', margins: { preset: 'custom', custom: { top: 20, right: 99, bottom: -1, left: 5 } }, scale: { fitWidth: false, percent: 500 }, copies: 2.5 },
      PRINTERS,
    );
    expect(parsed).toEqual({
      ...DEFAULT_PRINT_SETTINGS,
      printer: 'office',
      pageSize: 'Letter',
      margins: { preset: 'custom', custom: { top: 20, right: 10, bottom: 10, left: 5 } },
      scale: { fitWidth: false, percent: 100 },
    });
  });

  it('takes the default printer when the stored one has gone, and none when there are no printers', () => {
    expect(parsePrintSettings({ printer: 'gone' }, PRINTERS).printer).toBe('home');
    expect(parsePrintSettings({ printer: 'gone' }, []).printer).toBeNull();
  });

  it('never restores a page range, and never writes one', () => {
    expect(parsePrintSettings({ pages: { all: false, ranges: '2' } }, PRINTERS).pages).toEqual({ all: true });
    const written = serialisePrintSettings(withSettings({ pages: { all: false, ranges: '2-3' } }));
    expect(written.version).toBe(1);
    expect('pages' in written.settings).toBe(false);
  });

  it('reads back exactly what it wrote', () => {
    const s = withSettings({ pageSize: 'A3', orientation: 'landscape', copies: 4, scale: { fitWidth: false, percent: 80 } });
    expect(parsePrintSettings(JSON.parse(JSON.stringify(serialisePrintSettings(s))).settings, PRINTERS)).toEqual(s);
  });
});

describe('pickDefaultPrinter', () => {
  it('takes the flagged printer, then the CUPS default option, then the first', () => {
    expect(pickDefaultPrinter(PRINTERS)).toBe('home');
    expect(pickDefaultPrinter([{ name: 'a' }, { name: 'b', options: { 'printer-is-default': 'true' } }])).toBe('b');
    expect(pickDefaultPrinter([{ name: 'a' }, { name: 'b' }])).toBe('a');
    expect(pickDefaultPrinter([])).toBeNull();
  });
});

describe('parsePageRanges', () => {
  it('sorts and merges ranges', () => {
    expect(parsePageRanges('5, 1-3, 2-4')).toEqual([{ from: 1, to: 5 }]);
    expect(parsePageRanges('1,3')).toEqual([{ from: 1, to: 1 }, { from: 3, to: 3 }]);
  });

  it.each(['', '0', '3-1', 'a', '1-', '1--2'])('refuses %j', (text) => {
    expect(parsePageRanges(text)).toBeNull();
  });
});

describe('the printed sheet (2026-11-20)', () => {
  it('is one image per sheet of paper at the paper\'s size, with no margin of its own', () => {
    const html = printSheetHtml({ widthMm: 210, heightMm: 297, pages: ['data:image/png;base64,AA', 'data:image/png;base64,BB'] });
    expect(html.match(/<img\b/g)).toHaveLength(2);
    expect(html).toContain('@page{size:210mm 297mm;margin:0}');
    expect(html).toContain('img{display:block;width:210mm;height:297mm;break-after:page}');
  });
});

describe('one layout, printed as laid out (FR-068, 2026-11-20)', () => {
  it.each([
    ['default', 10],
    ['minimum', 5],
    ['none', 0],
  ] as const)('the %s margin preset is %d mm on the laid-out pages, and the printer adds none', (preset, mm) => {
    const s = withSettings({ margins: { preset, custom: DEFAULT_PRINT_SETTINGS.margins.custom } });
    expect(toPdfOptions(s).margins.top).toBeCloseTo(mm / 25.4);
    expect(toPrintOptions(s)?.margins).toEqual({ marginType: 'none' });
  });

  it('maps custom margins, orientation, scale, range and copies', () => {
    const s = withSettings({
      orientation: 'landscape',
      margins: { preset: 'custom', custom: { top: 25.4, right: 0, bottom: 12.7, left: 50 } },
      scale: { fitWidth: false, percent: 150 },
      pages: { all: false, ranges: '2-3,5' },
      copies: 3,
    });
    expect(toPdfOptions(s)).toMatchObject({ landscape: true, scale: 1.5, pageRanges: '2-3,5', margins: { top: 1, right: 0, bottom: 0.5 } });
    // The pages carry the margins, scale and range; the printer is told the paper, the printer and the copies.
    expect(toPrintOptions(s)).toEqual({
      silent: true,
      deviceName: 'home',
      pageSize: 'A4',
      landscape: true,
      scaleFactor: 100,
      copies: 3,
      margins: { marginType: 'none' },
      printBackground: true,
    });
  });

  it('prints at 100% when fitting the width, whatever percentage is stored', () => {
    const s = withSettings({ scale: { fitWidth: true, percent: 40 } });
    expect(toPdfOptions(s).scale).toBe(1);
    expect(toPrintOptions(s)?.scaleFactor).toBe(100);
  });

  it('sends nothing without a printer', () => {
    expect(toPrintOptions(withSettings({ printer: null }))).toBeNull();
  });
});
