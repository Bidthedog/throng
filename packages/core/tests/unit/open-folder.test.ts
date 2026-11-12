import { describe, expect, it } from 'vitest';
import { decideOpenFolder } from '../../src/projects/open-folder.js';

const projects = [
  { id: 'a', name: 'Alpha', rootFolder: '/work/alpha' },
  { id: 'b', name: 'Beta', rootFolder: '/work/nested/beta' },
];

describe('decideOpenFolder (067 FR-026, FR-027)', () => {
  it('selects a folder that already is a project', () => {
    expect(decideOpenFolder('/work/alpha', 'folder', projects)).toEqual({ kind: 'select', projectId: 'a' });
  });
  it('selects the project a folder lies inside', () => {
    expect(decideOpenFolder('/work/alpha/src/deep', 'folder', projects)).toEqual({ kind: 'select', projectId: 'a' });
  });
  it('refuses a folder that contains a project, naming it', () => {
    expect(decideOpenFolder('/work/nested', 'folder', projects)).toEqual({ kind: 'refuse-contains', projectName: 'Beta' });
  });
  it('refuses a file', () => {
    expect(decideOpenFolder('/work/x.txt', 'file', projects)).toEqual({ kind: 'refuse-invalid', reason: 'file' });
  });
  it('refuses a missing path', () => {
    expect(decideOpenFolder('/gone', 'missing', projects)).toEqual({ kind: 'refuse-invalid', reason: 'missing' });
  });
  it('adds any other folder', () => {
    expect(decideOpenFolder('/work/gamma', 'folder', projects)).toEqual({ kind: 'add' });
  });
  it('does not confuse a sibling that shares a name prefix', () => {
    expect(decideOpenFolder('/work/alpha2', 'folder', projects)).toEqual({ kind: 'add' });
  });
});
