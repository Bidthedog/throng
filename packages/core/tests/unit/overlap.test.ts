import { describe, it, expect } from 'vitest';
import { projectRootWouldContainOpenEditor } from '../../src/editor/overlap.js';

describe('project-creation overlap detection (006, FR-038)', () => {
  it('blocks when a new root would swallow a sub-ws-owned editor file', () => {
    const r = projectRootWouldContainOpenEditor('C:/work', [
      { filePath: 'C:/work/notes/a.txt' },
      { filePath: 'C:/elsewhere/b.txt' },
    ]);
    expect(r.blocked).toBe(true);
    expect(r.files).toEqual(['C:/work/notes/a.txt']);
  });

  it('does not block when no open sub-ws editor is inside the new root', () => {
    const r = projectRootWouldContainOpenEditor('C:/work', [{ filePath: 'C:/elsewhere/b.txt' }]);
    expect(r.blocked).toBe(false);
    expect(r.files).toEqual([]);
  });

  it('matches case/separator-insensitively', () => {
    const r = projectRootWouldContainOpenEditor('c:/work', [{ filePath: 'C:\\Work\\a.txt' }]);
    expect(r.blocked).toBe(true);
  });

  it('empty open-editor list is never blocked', () => {
    expect(projectRootWouldContainOpenEditor('C:/work', [])).toEqual({ blocked: false, files: [] });
  });
});
