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
import { asPrintRequest } from '../../src/main/print-ipc.js';
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
  it('a provider declaring pages reaches Print Preview with its pages, and main accepts them', async () => {
    expect(canPrint(pagesProvider)).toBe(true);
    const open = vi.fn(async () => ({ opened: true }));
    expect(await printPreviewPanel({ view: pagesView, body: {} as HTMLElement, filePath: '/proj/doc.fp' }, open)).toBe(true);
    const request = open.mock.calls[0]![0];
    expect(request).toEqual({ title: 'doc.fp', output: { kind: 'pages', pdf: PDF } });
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
});
