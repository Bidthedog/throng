/**
 * US9 (#156) — the four path renderings a "Copy Path" entry offers. The POSIX form is the MSYS/Git
 * Bash convention (`C:\git` → `/c/git`), not a bare slash-swap (#156 follow-up).
 */
import { describe, it, expect } from 'vitest';
import { pathForms } from '../../src/explorer/path-forms.js';

describe('pathForms', () => {
  it('renders absolute/relative × Windows/POSIX for a nested file', () => {
    const f = pathForms('C:\\proj', 'src/a.txt');
    expect(f.absWin).toBe('C:\\proj\\src\\a.txt');
    expect(f.absPosix).toBe('/c/proj/src/a.txt'); // drive → /c (Git Bash), forward slashes
    expect(f.relWin).toBe('src\\a.txt');
    expect(f.relPosix).toBe('src/a.txt'); // relative carries no drive
  });

  it('normalises a mixed-separator root and rel path', () => {
    const f = pathForms('C:/proj/', '\\src\\b.txt');
    expect(f.absWin).toBe('C:\\proj\\src\\b.txt');
    expect(f.absPosix).toBe('/c/proj/src/b.txt');
  });

  it('lowercases the drive letter in the POSIX form', () => {
    const f = pathForms('D:\\Work', 'a.txt');
    expect(f.absPosix).toBe('/d/Work/a.txt');
  });

  it('handles the project root itself (empty rel path)', () => {
    const f = pathForms('C:\\proj', '');
    expect(f.absWin).toBe('C:\\proj');
    expect(f.absPosix).toBe('/c/proj');
    expect(f.relWin).toBe('');
    expect(f.relPosix).toBe('');
  });
});
