/**
 * 081 US6 (#731, FR-050 – FR-053) — the Open In ▸ rows, built once for every menu that offers them: the File
 * Explorer's row menu and the Link menu over a local file or folder. A change here reaches both menus.
 *
 * The groups and their order are the File Explorer's (#483): the OS rows, the editor targets, the preview
 * targets, Terminal ▸, Search ▸. Each group's own rows come from the module that already shares them:
 * `editor/open-in-targets.ts` for the editor targets and `preview/preview-open-in.ts` for the previews.
 *
 * The target state carries 045's omission rules for a link (FR-051):
 *   - outside the project: the OS rows only (FR-170a/FR-170c); Terminal and Search need a project (FR-052);
 *   - a binary file: no editor rows (FR-170e);
 *   - `pending` (main has not answered, or the link did not resolve): every row that needs the answer is
 *     drawn disabled, never hidden (Principle VI). OS File Explorer needs no answer and stays live.
 * The File Explorer's own targets are always in the project, resolved and never pending.
 */
import type { FlavourOption, MenuSection } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { previewOpenInRows, type PreviewOpenInFacts } from '../preview/preview-open-in.js';

export interface OpenInTarget {
  readonly absPath: string;
  readonly kind: 'file' | 'folder';
  /** false: no editor, preview, Terminal or Search rows. */
  readonly inProject: boolean;
  /** true: no editor rows (045 FR-170e). */
  readonly binary: boolean;
  /** true: the rows that depend on the resolution are drawn disabled (045 FR-170a/FR-170c). */
  readonly pending: boolean;
}

/** The performers, each on the target's absolute path, and the facts the editor and preview groups draw. */
export interface OpenInOps {
  readonly osExplorer: (absPath: string) => void;
  /** Absent draws no row: the setting is off, the selection is not one file, or main is out of reach. */
  readonly osDefaultProgram?: (absPath: string) => void;
  /** The editor targets, from `openInMenuActions(describeOpenInTargets(…))`. Absent draws none. */
  readonly editorRows?: readonly MenuAction[];
  /** The preview targets' facts and their two opens. Absent draws none. */
  readonly preview?: PreviewOpenInFacts & { readonly openLastActive: () => void; readonly openNew: () => void };
  /** The terminal flavour catalogue; empty or absent draws Terminal disabled (033 FR-035). */
  readonly flavours?: readonly FlavourOption[];
  /** Opens a terminal at the folder, or at a file's folder. Absent draws Terminal disabled. */
  readonly openInTerminal?: (absPath: string, flavour: FlavourOption) => void;
  /** Find in Files scoped to the target, with replace shown when `replace` is true. Absent draws no Search. */
  readonly findInFiles?: (absPath: string, replace: boolean) => void;
}

/** A row drawn disabled: no handler, and a disabled ▸ parent that opens nothing. */
function disabledRow(row: MenuAction): MenuAction {
  const { onClick: _onClick, submenu: _submenu, ...rest } = row;
  return { ...rest, disabled: true };
}

export function openInRows(target: OpenInTarget, ops: OpenInOps): MenuAction[] {
  const { absPath, kind, inProject, binary, pending } = target;
  const isFile = kind === 'file';
  const live = (rows: readonly MenuAction[]): MenuAction[] => (pending ? rows.map(disabledRow) : [...rows]);

  // OS File Explorer needs no answer from main: enabled in every state (045 FR-170a, row 4).
  const rows: MenuAction[] = [
    { label: 'OS File Explorer', icon: 'folderOpen', section: 'navigate', group: 'os', onClick: () => ops.osExplorer(absPath) },
  ];
  const osDefaultProgram = ops.osDefaultProgram;
  if (isFile && osDefaultProgram !== undefined) {
    rows.push(
      ...live([
        {
          label: 'Open in OS Default Program',
          icon: 'openInDefaultProgram',
          section: 'navigate',
          group: 'os',
          onClick: () => osDefaultProgram(absPath),
        },
      ]),
    );
  }
  if (!inProject) return rows;

  if (isFile && !binary && ops.editorRows !== undefined) {
    rows.push(...live(ops.editorRows.map((row) => ({ ...row, group: 'editor' }))));
  }
  // 044 FR-003 — after the editor targets, before Terminal; previewOpenInRows owns absent vs disabled.
  if (isFile && ops.preview !== undefined) {
    const preview = ops.preview;
    rows.push(...live(previewOpenInRows(preview, { lastActive: preview.openLastActive, new: preview.openNew })));
  }

  // 033 FR-029 / FR-035 — Terminal, for a folder or a file's folder; drawn disabled with no flavour to offer.
  const flavours = ops.flavours ?? [];
  const openInTerminal = ops.openInTerminal;
  const canOpenTerminal = !pending && flavours.length > 0 && openInTerminal !== undefined;
  rows.push({
    label: 'Terminal',
    icon: 'terminal',
    section: 'navigate',
    group: 'terminal',
    disabled: !canOpenTerminal,
    submenu: canOpenTerminal
      ? flavours.map((flavour) => ({
          label: flavour.label,
          icon: 'terminal',
          section: 'navigate' as const,
          onClick: () => openInTerminal(absPath, flavour),
        }))
      : undefined,
  });

  // 043 FR-090 — Search, last: `explorer.e2e.ts` clicks the flyout's first row expecting the OS reveal.
  const findInFiles = ops.findInFiles;
  if (findInFiles !== undefined) {
    const search: MenuAction = {
      label: 'Search',
      icon: 'search',
      section: 'navigate',
      group: 'search',
      submenu: [
        { label: 'Find', icon: 'findInFiles', section: 'navigate', onClick: () => findInFiles(absPath, false) },
        { label: 'Find & Replace', icon: 'replace', section: 'navigate', onClick: () => findInFiles(absPath, true) },
      ],
    };
    rows.push(...live([search]));
  }
  return rows;
}

/** The Open In ▸ parent over `rows`, in the section the host menu files it under. */
export function openInSubmenu(rows: MenuAction[], section: MenuSection): MenuAction {
  return { label: 'Open In', icon: 'send', section, submenu: rows };
}
