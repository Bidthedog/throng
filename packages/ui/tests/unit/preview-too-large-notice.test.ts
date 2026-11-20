/**
 * 073 FR-062, 074 FR-012, 077 FR-015 — a file over its preview's limit is told its size and that limit in the unit the
 * limit's setting is shown in (MB, with its bytes), digit-grouped (constitution 4.5.0), quoting the setting's value
 * (constitution 7.3.0). One wording for every provider. A too-large notice without them keeps the editor-limit
 * wording.
 *
 * Grouped digits are built with `formatGrouped`, never typed: the separator is the active locale's.
 */
import { describe, expect, it } from 'vitest';
import { formatGrouped } from '@throng/core';
import { previewNoticeMessage } from '../../src/renderer/preview/preview-notice.js';

const MB = 1024 * 1024;
const g = (n: number): string => formatGrouped(n);

describe('the too-large notice (FR-062, 077 FR-015)', () => {
  it('names the size and the limit in MB with their bytes, as the limit setting shows them', () => {
    expect(
      previewNoticeMessage({
        kind: 'too-large',
        size: 30 * MB,
        limit: 25 * MB,
        limitKey: 'editor.previews.providers.spreadsheet.maxPreviewBytes',
      }),
    ).toBe(`This file is too large to preview: ${g(30)} MB (${g(30 * MB)} bytes), over the ${g(25)} MB (${g(25 * MB)} bytes) limit set in Preferences.`);
  });

  it('says the same for a media provider and for the editor limit', () => {
    const image = previewNoticeMessage({ kind: 'too-large', size: 60 * MB, limit: 50 * MB, limitKey: 'editor.previews.providers.image.maxFileBytes' });
    expect(image).toBe(`This file is too large to preview: ${g(60)} MB (${g(60 * MB)} bytes), over the ${g(50)} MB (${g(50 * MB)} bytes) limit set in Preferences.`);
    const editor = previewNoticeMessage({ kind: 'too-large', size: 12 * MB, limit: 10 * MB, limitKey: 'editor.maxOpenFileBytes' });
    expect(editor).toBe(`This file is too large to preview: ${g(12)} MB (${g(12 * MB)} bytes), over the ${g(10)} MB (${g(10 * MB)} bytes) limit set in Preferences.`);
  });

  it('keeps the plain wording when main sent neither', () => {
    expect(previewNoticeMessage({ kind: 'too-large' })).toBe('This file is too large to preview.');
  });
});
