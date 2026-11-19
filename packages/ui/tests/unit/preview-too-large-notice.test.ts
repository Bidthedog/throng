/**
 * 073 FR-062 — a workbook over the Spreadsheet preview's own limit is told its size and that limit,
 * digit-grouped (constitution 4.5.0); a too-large notice without them keeps the editor-limit wording.
 */
import { describe, expect, it } from 'vitest';
import { formatGrouped } from '@throng/core';
import { previewNoticeMessage } from '../../src/renderer/preview/preview-notice.js';

const MB = 1024 * 1024;

describe('the too-large notice (FR-062)', () => {
  it('names the size and the limit in megabytes, grouped', () => {
    expect(previewNoticeMessage({ kind: 'too-large', size: 1536.25 * MB, limit: 500 * MB })).toBe(
      `This file is ${formatGrouped(1536.3)} MB, over the preview size limit of 500 MB.`,
    );
  });

  it('keeps the plain wording when main sent neither', () => {
    expect(previewNoticeMessage({ kind: 'too-large' })).toBe('This file is too large to preview.');
  });
});
