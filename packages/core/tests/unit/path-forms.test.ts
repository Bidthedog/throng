/**
 * US9 (#156) — the four path renderings a "Copy Path" entry offers.
 */
import { describe, it, expect } from 'vitest';
import { pathForms } from '../../src/explorer/path-forms.js';

describe('pathForms', () => {
  it('renders absolute/relative × Windows/Linux slashes for a nested file', () => {
    const f = pathForms('C:\\proj', 'src/a.txt');
    expect(f.absWin).toBe('C:\\proj\\src\\a.txt');
    expect(f.absLinux).toBe('C:/proj/src/a.txt');
    expect(f.relWin).toBe('src\\a.txt');
    expect(f.relLinux).toBe('src/a.txt');
  });

  it('normalises a mixed-separator root and rel path', () => {
    const f = pathForms('C:/proj/', '\\src\\b.txt');
    expect(f.absWin).toBe('C:\\proj\\src\\b.txt');
    expect(f.absLinux).toBe('C:/proj/src/b.txt');
  });

  it('handles the project root itself (empty rel path)', () => {
    const f = pathForms('C:\\proj', '');
    expect(f.absWin).toBe('C:\\proj');
    expect(f.absLinux).toBe('C:/proj');
    expect(f.relWin).toBe('');
    expect(f.relLinux).toBe('');
  });
});
