/**
 * What confines `FilesService.revealDocument` (#273): a path may be revealed exactly while some Panel,
 * in some window, is showing it.
 *
 * 044 FR-033 widens "some Panel" to include a preview. A STANDALONE preview shows a file that no editor
 * has open (FR-025), so a check that asked the editor registry alone refused the very path the
 * preview's own Open in OS Explorer item names.
 */
export function openInEditorOrPreview(
  editors: { isOpen(absPath: string): boolean },
  previews: { isOpen(absPath: string): boolean },
): (absPath: string) => boolean {
  return (absPath) => editors.isOpen(absPath) || previews.isOpen(absPath);
}
