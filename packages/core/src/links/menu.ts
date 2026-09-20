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
 */
export type LinkMenuItemId =
  | 'openLink'
  | 'openInNew'
  | 'openInActive'
  | 'openInEditor'
  | 'openPreview'
  | 'osExplorer'
  | 'osDefaultProgram'
  | 'openProgram'
  | 'copyLink';

/** §16.22: names §16.7's inline `resolution` object — a {@link ResolvedLink} without its path. */
export type ResolvedTarget = Pick<ResolvedLink, 'kind' | 'inProject' | 'executable' | 'preview'>;

/** §16.12 / §16.16: what the grammar and the extension decide without the disk (FR-170a). */
export interface LinkMenuApplicable {
  readonly inProjectByName: boolean;
  readonly previewByExtension: 'enabled' | 'disabled' | 'none';
  readonly executableByExtension: boolean;
  /** A path ending in a separator, or the project root itself (FR-168b): no Open In ▸, no preview. */
  readonly folderByGrammar: boolean;
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
  const throngRows = !applicable.folderByGrammar;

  // Rows 2 and 3 — throng's own destinations.
  let openIn: RowState;
  let preview: RowState;
  if (resolution === 'pending' || resolution === null) {
    const byName = throngRows && applicable.inProjectByName;
    openIn = byName ? 'disabled' : 'absent';
    preview = byName && applicable.previewByExtension !== 'none' ? 'disabled' : 'absent';
  } else {
    const canOpen = throngRows && resolution.kind === 'file' && resolution.inProject;
    openIn = canOpen ? 'enabled' : 'absent';
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
