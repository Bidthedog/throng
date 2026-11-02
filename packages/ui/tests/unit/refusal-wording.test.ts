/**
 * 059 T022 / T039 — every surface that refuses a file says it in core's ONE wording (FR-053).
 *
 * The editor's open notice, the preview's file notice, the Find in Files replace report and the task
 * toggle each used to carry their own sentence for "this is not text". They now take it from
 * `refusalMessage`, so a UTF-32 file, a binary file and a file that does not decode read the same
 * everywhere — and a file that does not decode names the encoding it was read as (review R2/R3), never a
 * blanket "UTF-8".
 */
import { describe, expect, it } from 'vitest';
import { refusalMessage } from '@throng/core';
import { taskNoticeMessage } from '../../src/renderer/preview/task-toggle.js';
import { missingFileMessage } from '../../src/renderer/editor/editor-missing-notice.js';
import { failureWording } from '../../src/renderer/find-in-files/commit-replace.js';
import { previewNoticeMessage, type FileNotice } from '../../src/renderer/preview/preview-notice.js';

describe('the editor open notice (059 T022, review R2)', () => {
  it('says the refusal in core’s words for binary, UTF-32 and not-decodable', () => {
    expect(missingFileMessage('binary')).toBe(refusalMessage('binary'));
    expect(missingFileMessage('utf32')).toBe(refusalMessage('utf32'));
    expect(missingFileMessage('not-decodable')).toBe(refusalMessage('not-decodable'));
  });

  it('names the encoding a not-decodable file was read as', () => {
    expect(missingFileMessage('not-decodable', 'utf16le')).toBe(refusalMessage('not-decodable', 'utf16le'));
    expect(missingFileMessage('not-decodable', 'utf16le')).toContain('UTF-16 LE');
  });
});

describe('the preview task toggle (059 T039, review R2/R4)', () => {
  it('says a file-level refusal in core’s words', () => {
    expect(taskNoticeMessage('utf32')).toBe(`The file was left unchanged. ${refusalMessage('utf32')}`);
    expect(taskNoticeMessage('binary')).toBe(`The file was left unchanged. ${refusalMessage('binary')}`);
    expect(taskNoticeMessage('not-decodable')).toBe(`The file was left unchanged. ${refusalMessage('not-decodable')}`);
  });

  it('names the encoding a not-decodable file was read as', () => {
    expect(taskNoticeMessage('not-decodable', 'windows1252')).toBe(
      `The file was left unchanged. ${refusalMessage('not-decodable', 'windows1252')}`,
    );
  });

  it('carries no wording for the retired `encoding` reason (R4)', () => {
    // Nothing emits it since 059: the reason left the union, and the replace report's clause went with it.
    expect(failureWording('encoding')).toBe(failureWording('some-unknown-reason'));
  });
});

describe('the preview file notice (059 T022, review R3)', () => {
  it('says the refusal in core’s words for a file that is not text, and for UTF-32', () => {
    expect(previewNoticeMessage({ kind: 'not-text' })).toBe(refusalMessage('binary'));
    expect(previewNoticeMessage({ kind: 'utf32' } as FileNotice)).toBe(refusalMessage('utf32'));
  });

  it('names the encoding a not-decodable file was read as', () => {
    expect(previewNoticeMessage({ kind: 'not-decodable', encoding: 'utf16be' } as FileNotice)).toBe(
      refusalMessage('not-decodable', 'utf16be'),
    );
  });
});
