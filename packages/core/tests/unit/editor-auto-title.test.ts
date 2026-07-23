import { describe, expect, it } from 'vitest';
import { editorAutoTitle } from '../../src/editor/path-display.js';

/**
 * US5 / FR-015 (spec 024): an editor panel with no manual name shows its open file's basename with
 * ONLY the final extension stripped, never a blank title.
 */
describe('editorAutoTitle', () => {
  it('strips only the final extension', () => {
    expect(editorAutoTitle('D:/proj/src/foo.ts')).toBe('foo');
    expect(editorAutoTitle('/proj/foo.test.ts')).toBe('foo.test');
    expect(editorAutoTitle('/proj/archive.tar.gz')).toBe('archive.tar');
  });

  it('keeps the whole name for a file with no extension', () => {
    expect(editorAutoTitle('/proj/Makefile')).toBe('Makefile');
    expect(editorAutoTitle('C:\\proj\\LICENSE')).toBe('LICENSE');
  });

  it('keeps a dotfile with no further extension intact, including its leading dot', () => {
    expect(editorAutoTitle('/proj/.gitignore')).toBe('.gitignore');
    expect(editorAutoTitle('/proj/.env')).toBe('.env');
  });

  it('strips the final extension of a dotfile that has one', () => {
    expect(editorAutoTitle('/proj/.eslintrc.json')).toBe('.eslintrc');
  });

  it('handles native (back-slash) separators', () => {
    expect(editorAutoTitle('D:\\a\\b\\report.md')).toBe('report');
  });

  it('never returns a blank title', () => {
    // A trailing-dot name keeps at least the stem.
    expect(editorAutoTitle('/proj/foo.')).toBe('foo');
    // A bare name with no directory.
    expect(editorAutoTitle('notes.txt')).toBe('notes');
  });
});
