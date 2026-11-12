/** What the Properties dialog shows (067 FR-046). Timestamps are ms since the epoch. */
export type ItemKind = 'file' | 'folder' | 'symlink' | 'junction';

export interface FileAttributes {
  readonly readOnly: boolean;
  readonly hidden: boolean;
  readonly system: boolean;
  readonly archive: boolean;
  /** A Windows directory junction, which the OS reports as a link but is a different thing. */
  readonly junction: boolean;
}

/** Who owns an item and who may do what with it (067 FR-121). Read-only. */
export interface FileAccess {
  readonly owner?: string;
  readonly group?: string;
  readonly modeSymbolic?: string;
  readonly modeOctal?: string;
}

const triad = (bits: number, special: boolean, on: string, off: string): string =>
  `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${special ? (bits & 1 ? on : off) : bits & 1 ? 'x' : '-'}`;

/** A stat mode as `chmod` shows it. The file-type bits are not permissions and are ignored. */
export function formatFileMode(mode: number): { readonly modeSymbolic: string; readonly modeOctal: string } {
  const perms = mode & 0o7777;
  return {
    modeSymbolic:
      triad((perms >> 6) & 7, (perms & 0o4000) !== 0, 's', 'S') +
      triad((perms >> 3) & 7, (perms & 0o2000) !== 0, 's', 'S') +
      triad(perms & 7, (perms & 0o1000) !== 0, 't', 'T'),
    modeOctal: perms.toString(8).padStart(4, '0'),
  };
}

export interface ItemProperties {
  readonly name: string;
  readonly path: string;
  readonly type: ItemKind;
  readonly linkTarget?: string;
  readonly sizeBytes: number;
  readonly attributes: FileAttributes;
  /** Absent where the OS does not report it. */
  readonly access?: FileAccess;
  readonly created: number;
  readonly modified: number;
  readonly accessed: number;
  /** Deleted since the menu opened. */
  readonly gone?: boolean;
}

/** Grows as the walk runs. Links are never followed; unreadable folders count in `skipped` (FR-051). */
export interface FolderTally {
  readonly sizeBytes: number;
  readonly files: number;
  readonly folders: number;
  readonly skipped: number;
  readonly done: boolean;
  /** Paths deleted or renamed since the dialog opened. The last tally a request sends. */
  readonly gone?: readonly string[];
}
