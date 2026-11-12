import { describe, expect, it } from 'vitest';
import { formatFileMode } from '../../src/explorer/properties.js';

describe('formatFileMode (067 FR-121)', () => {
  it('reads a stat mode as symbolic and octal, ignoring the file-type bits', () => {
    expect(formatFileMode(0o100644)).toEqual({ modeSymbolic: 'rw-r--r--', modeOctal: '0644' });
    expect(formatFileMode(0o040755)).toEqual({ modeSymbolic: 'rwxr-xr-x', modeOctal: '0755' });
  });
  it('shows the special bits', () => {
    expect(formatFileMode(0o104755)).toEqual({ modeSymbolic: 'rwsr-xr-x', modeOctal: '4755' });
    expect(formatFileMode(0o041777)).toEqual({ modeSymbolic: 'rwxrwxrwt', modeOctal: '1777' });
    expect(formatFileMode(0o102644).modeSymbolic).toBe('rw-r-Sr--');
  });
});
