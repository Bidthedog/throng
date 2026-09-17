/**
 * 044 US1 fix round 1, item 3 — `preview.open` over Files & Folders previews the selected FILE, and a
 * folder is not a file (FR-003's "absent on folders", applied to the chord).
 *
 * The tree's key handler asks `previewTargetFor` which path, if any, the command names. Nothing, for a
 * folder, the project root, or no selection: a preview of a folder means nothing, and asking main would
 * only earn a refusal the user did not expect a key to produce.
 */
import { describe, expect, it } from 'vitest';
import { previewTargetFor } from '../../src/renderer/explorer/explorer-keybindings.js';

const ROOT = 'D:/proj';

describe('which file preview.open names from the tree', () => {
  it('names the selected file, under the project root', () => {
    expect(previewTargetFor({ relPath: 'docs/guide.md', kind: 'file' }, ROOT)).toBe('D:/proj/docs/guide.md');
  });

  it('names nothing for a folder', () => {
    expect(previewTargetFor({ relPath: 'docs', kind: 'folder' }, ROOT)).toBeNull();
  });

  it('names nothing for the root node or no selection', () => {
    expect(previewTargetFor({ relPath: '', kind: 'folder' }, ROOT)).toBeNull();
    expect(previewTargetFor({ relPath: '', kind: 'file' }, ROOT)).toBeNull();
    expect(previewTargetFor(null, ROOT)).toBeNull();
  });
});
