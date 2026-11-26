import type { MenuSection } from '../workspace/menu-sections.js';
import type { ResourceClass } from './resource-class.js';
import type { ResolvedLink } from './types.js';

/**
 * 045 FR-169 – FR-171, FR-170a – FR-170c, FR-175 — the ONE Link menu (data-model §16.7, as amended by
 * §16.11, §16.12, §16.16, §16.21 and §16.22).
 *
 * Every surface with links — editors, terminals, the Markdown preview — draws what this returns and
 * filters nothing, so the three menus cannot disagree (SC-025). The only input that differs between
 * surfaces is the Open Link chord, shown only where one is bound (FR-169's note, FR-046), and the
 * surface's own Ctrl+click, which Open Link runs.
 *
 * ══ THREE RESOLUTION STATES ══
 *
 *   - `'pending'` — main has not answered (FR-170c). Only what the renderer knows is drawn: rows 2/3
 *     disabled when the link is in the project by name and not a folder by grammar, row 3 only when a
 *     provider accepts the extension; rows 5/6 NOT drawn, because executability is main's answer.
 *   - `null` — did not resolve (FR-170a). Principle VI: a state a later moment can change, so the rows
 *     that apply by grammar and extension are drawn DISABLED, never removed.
 *   - a {@link ResolvedTarget} — drawn from the answer; a folder or an out-of-project target removes
 *     rows 2/3, a folder removes 5/6.
 *
 * Web, loopback, protocol and anchor links are decided by their class alone: Open Link and Copy Link
 * to Clipboard, every target row absent as meaningless.
 *
 * FR-170d (#714) adds **Find in File Explorer** immediately before row 4, for a file or folder inside
 * the project; it is not one of FR-170's numbered rows, which this file's comments keep numbering as
 * FR-170 does.
 *
 * FR-170e (#719) withholds row 2 — every Open In ▸ editor row — from a file the editor refuses as binary:
 * by extension before main answers (`binaryByExtension`), and by the resolved target's `binary` after.
 *
 * ══ A LOCAL FILE OR FOLDER (081 FR-050 – FR-054) ══
 *
 * An `onDevice` link no longer draws rows 2 – 6 here. It draws one `openIn` item carrying the target's
 * STATE — kind, in the project, binary, pending — and the renderer builds the File Explorer's Open In ▸
 * from it with the explorer's own builder (`renderer/explorer/open-in-rows.ts`), so the two menus share
 * one source. 045's omission rules travel in that state. Open Link, Find in File Explorer and Copy Link to
 * Clipboard stay rows of this menu. A UNC link keeps the rows above unchanged (FR-054).
 */
export type LinkMenuItemId =
  | 'openLink'
  | 'openIn'
  | 'openInNew'
  | 'openInActive'
  | 'openInEditor'
  | 'openPreview'
  | 'findInExplorer'
  | 'osExplorer'
  | 'osDefaultProgram'
  | 'openProgram'
  | 'copyLink';

/** §16.22: names §16.7's inline `resolution` object — a {@link ResolvedLink} without its path. */
export type ResolvedTarget = Pick<ResolvedLink, 'kind' | 'inProject' | 'executable' | 'preview'> & {
  /** FR-170e — the file is one the editor refuses as binary (067 FR-117): no Open In ▸ row. Absent reads false. */
  readonly binary?: boolean;
};

/** §16.12 / §16.16: what the grammar and the extension decide without the disk (FR-170a). */
export interface LinkMenuApplicable {
  readonly inProjectByName: boolean;
  readonly previewByExtension: 'enabled' | 'disabled' | 'none';
  readonly executableByExtension: boolean;
  /** A path ending in a separator, or the project root itself (FR-168b): no Open In ▸, no preview. */
  readonly folderByGrammar: boolean;
  /** FR-170e — a binary preview provider claims the extension (a PDF, an image): no Open In ▸ in any state. */
  readonly binaryByExtension?: boolean;
}

export interface LinkMenuContext {
  readonly cls: ResourceClass | 'anchor';
  readonly resolution: ResolvedTarget | null | 'pending';
  readonly applicable: LinkMenuApplicable;
  /** One Open In ▸ row each, by name, after New Editor and Active Editor. */
  readonly openEditors: readonly { readonly id: string; readonly name: string }[];
  /** The Open Link chord where the surface binds one; absent (or empty) draws none. */
  readonly chord?: string;
  /** The surface's own Ctrl+click action (§16.11) — Open Link runs exactly this. */
  readonly openLink: () => void;
}

/** 081 FR-050 — what the Open In ▸ rows of a local link turn on; the renderer's `openInRows` reads it. */
export interface LinkOpenInState {
  readonly kind: 'file' | 'folder';
  /** Resolved, or before that by name. False: the OS rows only (045 FR-170a/FR-170c, 081 FR-052). */
  readonly inProject: boolean;
  /** No editor rows (045 FR-170e). */
  readonly binary: boolean;
  /** Main has not answered, or the link did not resolve: rows that need the answer are drawn disabled. */
  readonly pending: boolean;
}

export interface LinkMenuItem {
  /** What the item performs. Callers route on this, never on the label. */
  readonly id: LinkMenuItemId;
  readonly label: string;
  readonly disabled: boolean;
  /** Always `contextual` (FR-169: sections from Principle VI's vocabulary). */
  readonly section: MenuSection;
  /** Open Link only, and only where bound. */
  readonly shortcut?: string;
  /** The parent row's label for the Open In ▸ rows (`'Open In'`); absent on top-level rows. */
  readonly submenu?: string;
  /** The editor an `openInEditor` row targets. */
  readonly editorId?: string;
  /** Open Link only: the surface's Ctrl+click. Every other id is performed by the caller. */
  readonly run?: () => void;
  /** The `openIn` item only: the target state its Open In ▸ rows are built from. */
  readonly openIn?: LinkOpenInState;
}

const OPEN_IN = 'Open In';

type RowState = 'enabled' | 'disabled' | 'absent';

export function buildLinkMenu(ctx: LinkMenuContext): readonly LinkMenuItem[] {
  const row = (
    id: LinkMenuItemId,
    label: string,
    disabled: boolean,
    extra: Partial<LinkMenuItem> = {},
  ): LinkMenuItem => ({ id, label, disabled, section: 'contextual', ...extra });

  const items: LinkMenuItem[] = [
    row('openLink', 'Open Link', false, {
      run: ctx.openLink,
      ...(ctx.chord !== undefined && ctx.chord.length > 0 ? { shortcut: ctx.chord } : {}),
    }),
  ];
  const copy = row('copyLink', 'Copy Link to Clipboard', false);

  if (ctx.cls !== 'unc' && ctx.cls !== 'onDevice') return [...items, copy];

  const { resolution, applicable } = ctx;
  const find = findInExplorerState(resolution, applicable);
  const findRow = (): LinkMenuItem => row('findInExplorer', 'Find in File Explorer', find === 'disabled');

  if (ctx.cls === 'onDevice') {
    const binaryByExtension = applicable.binaryByExtension === true;
    const openIn: LinkOpenInState =
      resolution === 'pending' || resolution === null
        ? {
            kind: applicable.folderByGrammar ? 'folder' : 'file',
            inProject: applicable.inProjectByName,
            binary: binaryByExtension,
            pending: true,
          }
        : {
            kind: resolution.kind,
            inProject: resolution.inProject,
            binary: binaryByExtension || resolution.binary === true,
            pending: false,
          };
    // Enabled in every state: OS File Explorer, inside it, needs no target (FR-170a, row 4).
    items.push(row('openIn', OPEN_IN, false, { openIn }));
    if (find !== 'absent') items.push(findRow());
    items.push(copy);
    return items;
  }

  const throngRows = !applicable.folderByGrammar;

  // Rows 2 and 3 — throng's own destinations.
  let openIn: RowState;
  let preview: RowState;
  // FR-170e — a binary file never has an editor to open in, so row 2 is meaningless rather than unavailable.
  const binary = applicable.binaryByExtension === true;
  if (resolution === 'pending' || resolution === null) {
    const byName = throngRows && applicable.inProjectByName;
    openIn = byName && !binary ? 'disabled' : 'absent';
    preview = byName && applicable.previewByExtension !== 'none' ? 'disabled' : 'absent';
  } else {
    const canOpen = throngRows && resolution.kind === 'file' && resolution.inProject;
    openIn = canOpen && !binary && resolution.binary !== true ? 'enabled' : 'absent';
    preview = !canOpen
      ? 'absent'
      : resolution.preview === 'enabled'
        ? 'enabled'
        : resolution.preview === 'disabled'
          ? 'disabled'
          : 'absent';
  }

  // Rows 5 and 6 — never both; not drawn until main answers.
  let program: { id: 'osDefaultProgram' | 'openProgram'; disabled: boolean } | null = null;
  if (resolution === null) {
    if (throngRows) {
      program = {
        id: applicable.executableByExtension ? 'openProgram' : 'osDefaultProgram',
        disabled: true,
      };
    }
  } else if (resolution !== 'pending' && resolution.kind === 'file') {
    program = { id: resolution.executable ? 'openProgram' : 'osDefaultProgram', disabled: false };
  }

  if (openIn !== 'absent') {
    const off = openIn === 'disabled';
    items.push(row('openInNew', 'New Editor', off, { submenu: OPEN_IN }));
    items.push(row('openInActive', 'Active Editor', off, { submenu: OPEN_IN }));
    for (const editor of ctx.openEditors) {
      items.push(row('openInEditor', editor.name, off, { submenu: OPEN_IN, editorId: editor.id }));
    }
  }
  if (preview !== 'absent') items.push(row('openPreview', 'Open Preview', preview === 'disabled'));
  // #714 — Find in File Explorer, beside Open in OS Explorer: the two "show me where this is" rows read together.
  if (find !== 'absent') items.push(findRow());
  // Row 4 needs no target (FR-170a) — enabled in every state.
  items.push(row('osExplorer', 'Open in OS Explorer', false));
  if (program !== null) {
    items.push(
      row(
        program.id,
        program.id === 'openProgram' ? 'Open Program' : 'Open in OS Default Program',
        program.disabled,
      ),
    );
  }
  items.push(copy);
  return items;
}

/**
 * #714 — Find in File Explorer reveals the target in throng's own tree, which holds only the project, so it
 * needs an existing target INSIDE the project, a file or a folder alike. Before main answers, and when the
 * link did not resolve, it follows rows 2/3's rule (FR-170a, FR-170c): drawn disabled when the link is in
 * the project by name, absent otherwise; an answer outside the project removes it.
 */
function findInExplorerState(resolution: LinkMenuContext['resolution'], applicable: LinkMenuApplicable): RowState {
  if (resolution === 'pending' || resolution === null) return applicable.inProjectByName ? 'disabled' : 'absent';
  return resolution.inProject ? 'enabled' : 'absent';
}

/**
 * 045 FR-054 — the family a Link menu row's run belongs to, read by `performLinkTarget`
 * (`packages/ui/src/renderer/links/link-actions.ts`) to route it. Four families, not `LinkMenuItemId`'s
 * finer rows: `LinkMenuItemId`'s `openInNew`/`openInActive`/`openInEditor` are three different Open In
 * ▸ rows FR-170 row 2 draws, but all three — like `openProgram` and `osDefaultProgram`, S8's split of
 * one route into two labels — perform the SAME family once a target is chosen.
 *
 * `fileLinkMenuItems` and `packages/core/src/links/targets.ts` (`LINK_TARGETS`, `linkTargetStates`)
 * were folded into `buildLinkMenu` above (T275); this is the one piece of that shape still needed
 * outside it (T277).
 */
export type LinkTarget = 'editor' | 'preview' | 'osExplorer' | 'osDefaultProgram';
