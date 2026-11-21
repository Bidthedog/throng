/**
 * 075 FR-082 (the maintainer, 2026-11-21: "Can we offer a 'Save as PDF' print option from throng?") — where the Save
 * dialog starts: the printed file's own name as a PDF, in its folder, never the source itself.
 */
import { describe, expect, it } from 'vitest';
import { defaultPdfSave } from '../../src/preview/print.js';

describe('defaultPdfSave (FR-082)', () => {
  it("is the file's name with .pdf, in the file's folder, on either separator", () => {
    expect(defaultPdfSave('/home/u/notes/plan.md', 'plan.md')).toEqual({ dir: '/home/u/notes', name: 'plan.pdf' });
    expect(defaultPdfSave('C:\\p\\data.v2.csv', 'data.v2.csv')).toEqual({ dir: 'C:\\p', name: 'data.v2.pdf' });
  });

  it('never names the source when it is a PDF already', () => {
    expect(defaultPdfSave('/d/report.pdf', 'report.pdf')).toEqual({ dir: '/d', name: 'report (printed).pdf' });
    expect(defaultPdfSave('/d/REPORT.PDF', 'REPORT.PDF')).toEqual({ dir: '/d', name: 'REPORT (printed).pdf' });
  });

  it('falls back to the title, with no folder, when the file has no path', () => {
    expect(defaultPdfSave(undefined, 'Untitled-1')).toEqual({ name: 'Untitled-1.pdf' });
  });
});
