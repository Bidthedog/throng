import { describe, it, expect } from 'vitest';
import {
  isWithinTree,
  isOutsideAllProjects,
  resolveSaveConfinement,
} from '../../src/editor/confinement.js';

describe('editor save confinement (006, FR-021/022/036)', () => {
  it('isWithinTree accepts the root and descendants, case/separator-insensitive', () => {
    expect(isWithinTree('C:/proj/src/a.ts', 'C:/proj')).toBe(true);
    expect(isWithinTree('C:\\PROJ\\src\\a.ts', 'c:/proj')).toBe(true);
    expect(isWithinTree('C:/proj', 'C:/proj')).toBe(true);
    expect(isWithinTree('C:/other/a.ts', 'C:/proj')).toBe(false);
    // A sibling that merely shares a prefix is NOT within.
    expect(isWithinTree('C:/proj-2/a.ts', 'C:/proj')).toBe(false);
  });

  it('isOutsideAllProjects is true only when outside every root', () => {
    const roots = ['C:/projA', 'C:/projB'];
    expect(isOutsideAllProjects('C:/scratch/note.txt', roots)).toBe(true);
    expect(isOutsideAllProjects('C:/projA/note.txt', roots)).toBe(false);
    expect(isOutsideAllProjects('C:/projB/deep/note.txt', roots)).toBe(false);
    expect(isOutsideAllProjects('C:/anything', [])).toBe(true);
  });

  it('project-owned resolves to in-owner-tree confinement', () => {
    const c = resolveSaveConfinement(
      { ownerKind: 'project' },
      { ownerRoot: 'C:/proj', allProjectRoots: ['C:/proj', 'C:/other'] },
    );
    expect(c.kind).toBe('in-owner-tree');
    expect(c.allowed('C:/proj/src/a.ts')).toBe(true);
    expect(c.allowed('C:/other/a.ts')).toBe(false);
    expect(c.allowed('C:/scratch/a.ts')).toBe(false);
  });

  it('sub-workspace-owned resolves to outside-all-projects confinement', () => {
    const c = resolveSaveConfinement(
      { ownerKind: 'subworkspace' },
      { ownerRoot: null, allProjectRoots: ['C:/proj', 'C:/other'] },
    );
    expect(c.kind).toBe('outside-all-projects');
    expect(c.allowed('C:/scratch/a.ts')).toBe(true);
    expect(c.allowed('C:/proj/a.ts')).toBe(false);
    expect(c.allowed('C:/other/deep/a.ts')).toBe(false);
  });

  it('a project-owned doc with no ownerRoot falls back to outside-all-projects (never unconfined)', () => {
    const c = resolveSaveConfinement(
      { ownerKind: 'project' },
      { ownerRoot: null, allProjectRoots: ['C:/proj'] },
    );
    expect(c.kind).toBe('outside-all-projects');
    expect(c.allowed('C:/proj/a.ts')).toBe(false);
  });
});
