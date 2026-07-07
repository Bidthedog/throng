import { describe, it, expect } from 'vitest';
import { editorPathParts, toDisplayPath } from '../../src/editor/path-display.js';

describe('toDisplayPath native separators (006, FR-101)', () => {
  it('uses back-slashes on Windows', () => {
    expect(toDisplayPath('D:\\git/file.txt', 'windows')).toBe('D:\\git\\file.txt');
    expect(toDisplayPath('C:/a/b.txt', 'windows')).toBe('C:\\a\\b.txt');
  });
  it('uses forward-slashes on Linux/macOS', () => {
    expect(toDisplayPath('/home/u/file.txt', 'linux')).toBe('/home/u/file.txt');
    expect(toDisplayPath('a\\b/c.txt', 'macos')).toBe('a/b/c.txt');
  });
});

describe('editor pill path display (006, FR-088/101)', () => {
  it('project + full (Windows): a root-level file shows a "\\" prefix', () => {
    expect(editorPathParts('C:/proj/a.ts', 'C:/proj', 'project', 'full', 'windows')).toEqual({
      dir: '\\',
      name: 'a.ts',
    });
  });

  it('project + full (Windows): a subfolder file shows the project-relative path', () => {
    expect(editorPathParts('C:/proj/src/deep/a.ts', 'C:/proj', 'project', 'full', 'windows')).toEqual({
      dir: '\\src\\deep\\',
      name: 'a.ts',
    });
  });

  it('project + full (Linux): forward-slash separators', () => {
    expect(editorPathParts('/proj/src/a.ts', '/proj', 'project', 'full', 'linux')).toEqual({
      dir: '/src/',
      name: 'a.ts',
    });
  });

  it('project + name: just the file name (no path)', () => {
    expect(editorPathParts('C:/proj/src/a.ts', 'C:/proj', 'project', 'name', 'windows')).toEqual({
      dir: '',
      name: 'a.ts',
    });
  });

  it('sub-workspace + full (Windows): the absolute directory prefix, native slashes', () => {
    expect(editorPathParts('C:/scratch/notes/note.txt', null, 'subworkspace', 'full', 'windows')).toEqual({
      dir: 'C:\\scratch\\notes\\',
      name: 'note.txt',
    });
  });

  it('sub-workspace + full (Linux): forward-slash absolute prefix', () => {
    expect(editorPathParts('/scratch/note.txt', null, 'subworkspace', 'full', 'linux')).toEqual({
      dir: '/scratch/',
      name: 'note.txt',
    });
  });

  it('handles a mixed-separator input, normalised to the OS (Windows)', () => {
    expect(editorPathParts('D:\\git/proj/file.txt', 'D:/git/proj', 'project', 'full', 'windows')).toEqual({
      dir: '\\',
      name: 'file.txt',
    });
  });
});
