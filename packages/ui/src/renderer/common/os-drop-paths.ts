/**
 * The absolute paths of the files in an OS drag (018 US9; 067 FR-014).
 *
 * Electron 43 removed the non-standard `File.path`, so the only way to learn an OS file's path is
 * `webUtils.getPathForFile`, which lives in the preload (`window.throng.editor.getPathForFile`). That
 * one call is the only part of dropping a file in that a test below end-to-end cannot drive — a File
 * made in a renderer is not an OS file and yields '' — so it is kept to this one function, which the
 * editor/panel drop target and the File Explorer's inbound drop both use.
 */

/** True for a drag that carries files from outside the page (the only kind the OS can start). */
export function isOsFileDrag(dataTransfer: Pick<DataTransfer, 'types'> | null | undefined): boolean {
  return Array.from(dataTransfer?.types ?? []).includes('Files');
}

export interface OsDropPaths {
  /** How many files the drop carried. */
  readonly count: number;
  /** The absolute path of each one that has a path on disk. */
  readonly paths: string[];
}

/**
 * The paths of a drop's files. `count > 0` with no `paths` is a drag we cannot serve — a virtual folder,
 * a mail attachment, an item that exists only inside the source application — which callers report
 * rather than ignore.
 */
export function osDropPaths(dataTransfer: Pick<DataTransfer, 'files'> | null | undefined): OsDropPaths {
  const files = Array.from(dataTransfer?.files ?? []);
  const paths = files
    .map((file) => window.throng?.editor?.getPathForFile?.(file) ?? '')
    .filter((p) => p.length > 0);
  return { count: files.length, paths };
}
