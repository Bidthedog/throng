import { describe, expect, it } from 'vitest';
import { decidePasteSource, type FileListSnapshot } from '../../src/index.js';

const list = (paths: string[], intent: 'copy' | 'cut' = 'copy'): FileListSnapshot => ({ paths, intent });

describe('decidePasteSource (067 FR-006, research D3)', () => {
  it('pastes internally when the OS still holds what throng placed, spelling aside', () => {
    expect(decidePasteSource(true, list(['C:\\A\\b.txt']), list(['c:/a/b.txt']))).toBe('internal');
  });

  it('takes the OS list when another application replaced it', () => {
    expect(decidePasteSource(true, list(['/a']), list(['/other']))).toBe('os');
  });

  it('treats a changed intent as a replaced clipboard', () => {
    expect(decidePasteSource(true, list(['/a'], 'copy'), list(['/a'], 'cut'))).toBe('os');
  });

  it('takes the OS list when throng has no record', () => {
    expect(decidePasteSource(false, null, list(['/a']))).toBe('os');
  });

  it('is stale when another application replaced the list with something that is no file list', () => {
    expect(decidePasteSource(true, list(['/a']), null)).toBe('stale');
  });

  it('keeps the internal record when placing it on the OS failed, so nothing was ever replaced', () => {
    expect(decidePasteSource(true, null, null)).toBe('internal');
  });

  it('has nothing to paste when neither side holds a list', () => {
    expect(decidePasteSource(false, null, null)).toBe('none');
  });
});
