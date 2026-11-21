/**
 * 075 FR-060 – FR-062, SC-011 — the print seam a provider plugs into, driven with fake providers the shipped code
 * has never heard of: one that prints ready-made pages, one that prints nothing.
 *
 * Layer: contract — the subject is the provider seam (descriptor `print` + view `printable`) as the command body
 * consumes it, and the IPC request check main applies to what crosses it.
 */
import { describe, expect, it, vi } from 'vitest';
import { canPrint, type PreviewProviderDescriptor } from '@throng/core';
import { printPreviewPanel } from '../../src/renderer/preview/print/print-command.js';
import { MAX_PRINTABLE_LENGTH, asPrintRequest, printRefusal } from '../../src/main/print-ipc.js';
import type { PreviewProviderView } from '../../src/renderer/preview/provider-view.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pagesProvider: PreviewProviderDescriptor = { id: 'fakePages', displayName: 'Fake pages', extensions: ['.fp'], kind: 'binary', print: 'pages' };
const pagesView: PreviewProviderView = {
  id: 'fakePages',
  textSelection: false,
  load: vi.fn(),
  printable: async () => ({ kind: 'pages', pdf: PDF }),
};
const silentProvider: PreviewProviderDescriptor = { id: 'fakeSilent', displayName: 'Fake silent', extensions: ['.fs'], kind: 'binary' };
const silentView: PreviewProviderView = { id: 'fakeSilent', textSelection: false, load: vi.fn() };

describe('the print seam (FR-060 – FR-062)', () => {
  /*
   * SC-011, US6/AS2 — "the same print preview and print flow run" for ready-made pages. Print Preview lays a DOCUMENT
   * out (FR-066), so the pages reach it as a document of the pages drawn, one per sheet, fitted whole — the route the
   * PDF preview already proves (FR-075c) — rather than as a PDF loaded into a window that cannot display one.
   */
  it('a provider declaring pages reaches Print Preview as a document of its pages, and main accepts it', async () => {
    expect(canPrint(pagesProvider)).toBe(true);
    const open = vi.fn(async () => ({ opened: true }));
    const drawn: Uint8Array[] = [];
    const drawPages = async (pdf: Uint8Array) => {
      drawn.push(pdf);
      return [{ src: 'data:image/png;base64,AAAA', widthPt: 612, heightPt: 792 }];
    };
    expect(await printPreviewPanel({ view: pagesView, body: {} as HTMLElement, filePath: '/proj/doc.fp' }, open, undefined, drawPages)).toBe(true);
    expect(drawn).toEqual([PDF]);
    const request = open.mock.calls[0]![0] as { title: string; output: { kind: string; fit?: string; html?: string } };
    expect(request.title).toBe('doc.fp');
    expect(request.output).toMatchObject({ kind: 'document', fit: 'page' });
    expect(request.output.html).toContain('data:image/png;base64,AAAA');
    expect(asPrintRequest(request)).toEqual(request);
  });

  it('a provider declaring nothing cannot print, and its command reaches nothing', async () => {
    expect(canPrint(silentProvider)).toBe(false);
    const open = vi.fn();
    expect(await printPreviewPanel({ view: silentView, body: {} as HTMLElement, filePath: '/proj/doc.fs' }, open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('main refuses anything that is not a printable output', () => {
    expect(asPrintRequest({ title: 'x', output: { kind: 'document', html: '<p/>', fit: 'sideways', remoteImages: [] } })).toBeNull();
    expect(asPrintRequest({ title: 'x', output: { kind: 'pages', pdf: 'not bytes' } })).toBeNull();
    expect(asPrintRequest({ title: 'x', output: { kind: 'document', html: '<p/>', fit: 'width', remoteImages: ['http://e.com/a.png', 'https://e.com/b.png', 4] } })).toEqual({
      title: 'x',
      output: { kind: 'document', html: '<p/>', fit: 'width', remoteImages: ['https://e.com/b.png'] },
    });
  });

  it('says why it refused, in words the requesting window shows (FR-080)', () => {
    const huge = { title: 'x', output: { kind: 'document', html: 'a'.repeat(MAX_PRINTABLE_LENGTH + 1), fit: 'width', remoteImages: [] } };
    expect(asPrintRequest(huge)).toBeNull();
    expect(printRefusal(huge)).toBe('The document is too large to print.');
    expect(printRefusal({ title: 'x', output: { kind: 'pages', pdf: 'not bytes' } })).toBe('It could not be made ready to print.');
  });

  it('a refusal reaches the command as a failure naming its cause; a focused Print Preview does not (FR-080, FR-071)', async () => {
    const view = { printable: () => Promise.resolve({ kind: 'document' as const, html: '<p/>', fit: 'width' as const, remoteImages: [] }) };
    const target = { view: view as never, body: {} as HTMLElement, filePath: 'D:/p/a.md' };
    const failed = vi.fn();
    expect(await printPreviewPanel(target, () => Promise.resolve({ opened: false, cause: 'The document is too large to print.' }), failed)).toBe(false);
    expect(failed).toHaveBeenCalledWith('a.md', 'The document is too large to print.');
    failed.mockClear();
    expect(await printPreviewPanel(target, () => Promise.resolve({ opened: false }), failed)).toBe(true);
    expect(failed).not.toHaveBeenCalled();
  });
});
