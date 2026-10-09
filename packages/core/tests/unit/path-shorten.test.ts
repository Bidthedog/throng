import { describe, it, expect } from 'vitest';
import { lastFolder, shortenEnd, shortenPath } from '@throng/core';

/**
 * 053 FR-012 / research R3 — `{path}` keeps its root and its last folder and drops whole middle
 * folders behind an ellipsis; when root plus last folder alone are too long it falls back to an
 * end cut. Lengths count graphemes, and `\` and `/` are treated alike (R2, "Working directories as
 * reported").
 */
describe('shortenPath (053 FR-012)', () => {
  it('leaves a path that fits unchanged, including one exactly at the limit', () => {
    expect(shortenPath('D:\\git\\throng', 40)).toBe('D:\\git\\throng');
    expect(shortenPath('D:\\git\\throng', 13)).toBe('D:\\git\\throng');
  });

  it('drops middle folders, keeping the drive root and the last folder', () => {
    expect(shortenPath('D:\\git\\throng\\packages\\core\\src', 16)).toBe('D:\\…\\core\\src');
    expect(shortenPath('D:\\git\\throng\\packages\\core\\src', 12)).toBe('D:\\…\\src');
  });

  it('drops WHOLE folders, never a fragment of one', () => {
    // `D:\…\e\src` would fit 11 too — it must not appear.
    expect(shortenPath('D:\\git\\throng\\packages\\core\\src', 11)).toBe('D:\\…\\src');
  });

  it('treats forward slashes alike and keeps the path’s own separator', () => {
    expect(shortenPath('D:/git/throng/packages/core/src', 12)).toBe('D:/…/src');
  });

  it('keeps a POSIX root', () => {
    expect(shortenPath('/d/git/throng/packages/core', 12)).toBe('/…/core');
  });

  it('keeps a UNC root whole', () => {
    expect(shortenPath('\\\\server\\share\\team\\projects\\throng', 24)).toBe(
      '\\\\server\\share\\…\\throng',
    );
  });

  it('ignores a trailing separator when choosing the last folder', () => {
    expect(shortenPath('D:\\git\\throng\\packages\\core\\', 12)).toBe('D:\\…\\core');
  });

  it('falls back to an end cut when root plus last folder exceed the limit', () => {
    const path = 'D:\\git\\a-very-long-final-folder-name';
    expect(shortenPath(path, 12)).toBe('D:\\git\\a-ve…');
  });

  it('end-cuts a path with no middle folder to drop', () => {
    expect(shortenPath('D:\\a-very-long-folder', 10)).toBe('D:\\a-very…');
  });

  it('counts graphemes, not UTF-16 units', () => {
    // Each flag is one character made of four UTF-16 units.
    const path = 'D:\\🇬🇧\\🇫🇷\\🇩🇪\\🇯🇵';
    expect(shortenPath(path, 10)).toBe(path);
    expect(shortenPath(path, 9)).toBe('D:\\…\\🇩🇪\\🇯🇵');
  });
});

describe('shortenEnd (053 FR-012, {command})', () => {
  it('keeps its start and ends with the ellipsis, the whole within the limit', () => {
    expect(shortenEnd('ping localhost -t', 40)).toBe('ping localhost -t');
    expect(shortenEnd('ping localhost -t', 17)).toBe('ping localhost -t');
    expect(shortenEnd('ping localhost -t', 10)).toBe('ping loca…');
  });
});

describe('lastFolder (053 {folder})', () => {
  it('is the last folder of a Windows, forward-slash, POSIX or UNC path', () => {
    expect(lastFolder('D:\\git\\throng')).toBe('throng');
    expect(lastFolder('D:/git/throng/')).toBe('throng');
    expect(lastFolder('/d/git/throng')).toBe('throng');
    expect(lastFolder('\\\\server\\share\\throng')).toBe('throng');
  });

  it('is the root itself when the path is only a root', () => {
    expect(lastFolder('D:\\')).toBe('D:\\');
    expect(lastFolder('/')).toBe('/');
    expect(lastFolder('\\\\server\\share\\')).toBe('\\\\server\\share\\');
  });

  it('is empty for an empty path', () => {
    expect(lastFolder('')).toBe('');
  });
});
