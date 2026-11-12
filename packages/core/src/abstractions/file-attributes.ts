import type { FileAttributes } from '../explorer/properties.js';

/** A path's OS attributes (067 FR-046). Answers none set rather than rejecting. */
export interface IFileAttributes {
  read(path: string): Promise<FileAttributes>;
}
