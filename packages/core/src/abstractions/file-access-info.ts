import type { FileAccess } from '../explorer/properties.js';

/** The access details the OS keeps for a file (067 FR-121), as far as this OS has them. */
export interface IFileAccessInfo {
  read(stats: { readonly uid: number; readonly gid: number; readonly mode: number }): Promise<FileAccess | undefined>;
}
