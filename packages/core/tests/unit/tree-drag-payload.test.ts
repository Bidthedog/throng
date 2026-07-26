import { describe, expect, it } from 'vitest';
import { buildTreeDragPayload, toAbsPath } from '../../src/explorer/tree-drag-payload.js';

/**
 * US2 / US4 (spec 024, #155/#114): what a tree drag CARRIES to a drop target outside the tree.
 *
 * The rule this encodes is the one that is easy to get wrong: react-arborist drags the whole
 * selection only when the grabbed row is part of it, and dragging an unselected row must carry that
 * row alone. Getting it backwards pastes the wrong paths into a terminal — silently, because the
 * drop looks identical either way.
 *
 * `singleFile` is separate from the path count because US4 accepts exactly one FILE onto an empty
 * panel: one folder is still one item, and a panel cannot open a folder.
 */
describe('tree drag payload (024 US2/US4)', () => {
  const root = 'D:\\proj';

  describe('toAbsPath', () => {
    it('joins a relPath onto the root in the root\u2019s own separator style', () => {
      expect(toAbsPath('D:\\proj', 'src/app.ts')).toBe('D:\\proj\\src\\app.ts');
      expect(toAbsPath('/home/u/proj', 'src/app.ts')).toBe('/home/u/proj/src/app.ts');
    });

    it('tolerates a trailing separator on the root', () => {
      expect(toAbsPath('D:\\proj\\', 'a.ts')).toBe('D:\\proj\\a.ts');
      expect(toAbsPath('/home/u/proj/', 'a.ts')).toBe('/home/u/proj/a.ts');
    });

    it('returns the root itself for an empty relPath', () => {
      expect(toAbsPath('D:\\proj', '')).toBe('D:\\proj');
    });
  });

  describe('buildTreeDragPayload', () => {
    it('carries the whole selection when the dragged row is part of it, in selection order', () => {
      const p = buildTreeDragPayload({
        rootFolder: root,
        draggedRelPath: 'b.ts',
        draggedKind: 'file',
        selectedRelPaths: ['c.ts', 'b.ts', 'a.ts'],
      });
      // Selection ORDER, not sorted and not re-anchored on the dragged row.
      expect(p?.paths).toEqual(['D:\\proj\\c.ts', 'D:\\proj\\b.ts', 'D:\\proj\\a.ts']);
      expect(p?.singleFile).toBe(false);
    });

    it('carries ONLY the dragged row when it is not part of the selection', () => {
      const p = buildTreeDragPayload({
        rootFolder: root,
        draggedRelPath: 'lonely.ts',
        draggedKind: 'file',
        selectedRelPaths: ['c.ts', 'a.ts'],
      });
      expect(p?.paths).toEqual(['D:\\proj\\lonely.ts']);
      expect(p?.singleFile).toBe(true);
    });

    it('carries the dragged row when nothing is selected at all', () => {
      const p = buildTreeDragPayload({
        rootFolder: root,
        draggedRelPath: 'src/app.ts',
        draggedKind: 'file',
        selectedRelPaths: [],
      });
      expect(p?.paths).toEqual(['D:\\proj\\src\\app.ts']);
      expect(p?.singleFile).toBe(true);
    });

    it('marks a single FOLDER as not-a-single-file, so an empty panel refuses it', () => {
      const p = buildTreeDragPayload({
        rootFolder: root,
        draggedRelPath: 'src',
        draggedKind: 'folder',
        selectedRelPaths: [],
      });
      expect(p?.paths).toEqual(['D:\\proj\\src']);
      expect(p?.singleFile).toBe(false);
    });

    it('marks a multi-file selection as not-a-single-file', () => {
      const p = buildTreeDragPayload({
        rootFolder: root,
        draggedRelPath: 'a.ts',
        draggedKind: 'file',
        selectedRelPaths: ['a.ts', 'b.ts'],
      });
      expect(p?.singleFile).toBe(false);
      expect(p?.paths).toHaveLength(2);
    });

    it('refuses a drag of the root row itself (empty relPath, nothing selected)', () => {
      // The root has no relPath. Dropping "the project" onto a terminal would paste the root path
      // as though it were a file the user picked, which they did not.
      expect(
        buildTreeDragPayload({
          rootFolder: root,
          draggedRelPath: '',
          draggedKind: 'folder',
          selectedRelPaths: [],
        }),
      ).toBeNull();
    });
  });
});
