import { describe, it, expect } from 'vitest';
import { buildFileChangedNotice } from '../../src/renderer/editor/file-changed-notice.js';

// 011 US4 (FR-010/011): the "file changed on disk" warning names the containing
// tab, the panel, and the file's full path via the notice files list.

describe('buildFileChangedNotice', () => {
  it('names the tab, panel, and full path (windows separators)', () => {
    const notice = buildFileChangedNotice('C:/proj/src/app.ts', 'Editor 1', 'Main', 'windows');
    expect(notice.title).toBe('File changed on disk');
    // Still explains save-overwrites / revert-discards.
    expect(notice.message).toMatch(/overwrite/i);
    expect(notice.message).toMatch(/revert/i);
    expect(notice.files).toHaveLength(1);
    const f = notice.files![0];
    expect(f.dir).toBe('C:\\proj\\src\\');
    expect(f.name).toBe('app.ts');
    expect(f.note).toBe('Panel: Editor 1 · Tab: Main');
  });

  it('uses forward slashes on non-windows', () => {
    const f = buildFileChangedNotice('/home/dev/x.md', 'Notes', 'T2', 'linux').files![0];
    expect(f.dir).toBe('/home/dev/');
    expect(f.name).toBe('x.md');
  });

  it('omits the files list when the document has no path', () => {
    const notice = buildFileChangedNotice(null, 'Untitled', 'Main', 'windows');
    expect(notice.files).toBeUndefined();
  });
});
