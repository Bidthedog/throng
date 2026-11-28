/**
 * 074 FR-085a — an HTML page's body menu: Find…, Copy, Copy as ▸ (Rich Text, Plain Text) and Select All, as a
 * Markdown preview's body menu offers them (Split is the title menu's since the v1 review, #732) — though the page is not a flowing document (no Go to Heading, no
 * Synchronise Scrolling, FR-087).
 *
 * Layer: unit — `previewContentMenu` is a pure builder. The right-click in a real page reaching it is
 * `component/html-preview.test.ts`'s.
 */
import { describe, expect, it, vi } from 'vitest';
import { previewContentMenu, type PreviewContentMenuArgs } from '../../src/renderer/preview/content-menu.js';

const page = (over: Partial<PreviewContentMenuArgs> = {}): PreviewContentMenuArgs => ({
  selectionEmpty: false,
  flowingDocument: false,
  find: { run: vi.fn() },
  goToHeading: { run: vi.fn(), kind: null },
  content: { copyFormat: 'plain', copy: vi.fn(), selectAll: vi.fn(), pageSelectAll: true },
  ...over,
});

describe('an HTML page’s body menu (FR-085a)', () => {
  it('offers Find…, Copy, Copy as ▸ with both formats and Select All — and no Go to Heading or Split', () => {
    const rows = previewContentMenu(page());
    const labels = rows.map((m) => m.label);
    expect(labels).toEqual(expect.arrayContaining(['Find…', 'Copy', 'Copy as', 'Select All']));
    expect(rows.find((r) => r.label === 'Copy as')?.submenu?.map((m) => m.label)).toEqual(['Rich Text', 'Plain Text']);
    expect(labels).not.toContain('Go to Heading…');
    expect(labels).not.toContain('Split');
  });

  it('runs Select All and each copy in its format', () => {
    const args = page();
    const rows = previewContentMenu(args);
    rows.find((r) => r.label === 'Select All')!.onClick!();
    rows.find((r) => r.label === 'Copy as')!.submenu!.find((r) => r.label === 'Rich Text')!.onClick!();
    rows.find((r) => r.label === 'Copy')!.onClick!();
    expect(args.content!.selectAll).toHaveBeenCalled();
    expect(vi.mocked(args.content!.copy).mock.calls).toEqual([['rich'], ['plain']]);
  });

  it('still draws no Select All for a single picture, which has no page to select', () => {
    const picture = page({ content: { copyFormat: 'plain', copy: vi.fn(), selectAll: vi.fn() } });
    expect(previewContentMenu(picture).map((m) => m.label)).not.toContain('Select All');
  });
});
