/**
 * 075 FR-068e (the maintainer, 2026-11-20 18:10: "Add an option to 'center' print previews. This should center the
 * preview's canvas on the print canvas — especially important for images and SVGs.")
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT_SETTINGS, PRINT_CENTRE_CSS, parsePrintSettings, serialisePrintSettings, toPdfOptions } from '../../src/index.js';

const PRINTERS = [{ name: 'home', isDefault: true }];

describe('Centre', () => {
  it('is on for a picture or a PDF\'s pages, and off for a flowing document, until changed', () => {
    expect(DEFAULT_PRINT_SETTINGS.centre).toEqual({ page: true, width: false });
    expect(parsePrintSettings({}, PRINTERS).centre).toEqual({ page: true, width: false });
  });

  it('keeps each kind\'s choice across sessions, and a malformed one takes its default', () => {
    const s = { ...DEFAULT_PRINT_SETTINGS, printer: 'home', centre: { page: false, width: true } };
    expect(parsePrintSettings(JSON.parse(JSON.stringify(serialisePrintSettings(s))).settings, PRINTERS).centre).toEqual({ page: false, width: true });
    expect(parsePrintSettings({ centre: { page: 'yes', width: 1 } }, PRINTERS).centre).toEqual({ page: true, width: false });
  });

  it('lays a job out with the choice for its own kind', () => {
    const s = { ...DEFAULT_PRINT_SETTINGS, centre: { page: true, width: false } };
    expect(toPdfOptions(s, undefined, 'page').centre).toBe(true);
    expect(toPdfOptions(s, undefined, 'width').centre).toBe(false);
    expect(toPdfOptions(s).centre).toBe(false);
  });

  it('centres a picture and a PDF\'s page both ways, and a narrower block across the column; never text', () => {
    expect(PRINT_CENTRE_CSS).toMatch(/\.throng-print--fit-page \.throng-print__diagram\{[^}]*align-items:center;justify-content:center/);
    expect(PRINT_CENTRE_CSS).toMatch(/\.throng-print__pdf-page\{align-items:center;justify-content:center\}/);
    expect(PRINT_CENTRE_CSS).toMatch(/\.throng-print--fit-width img[^{]*\{margin-left:auto;margin-right:auto\}/);
    expect(PRINT_CENTRE_CSS).not.toMatch(/text-align/);
  });
});
