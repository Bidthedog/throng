import {
  buildLinkMenu,
  type LinkMenuApplicable,
  type LinkMenuContext,
  type LinkMenuItem,
  type ResolvedTarget,
  type ResourceClass,
} from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import type { LinkOpenInTarget } from './link-open-in.js';

/**
 * 045 FR-169 – FR-171, FR-170a – FR-170c — the ONE Link menu, drawn from core's `buildLinkMenu`
 * (`packages/core/src/links/menu.ts`) by every surface that carries a link: a terminal, an editor,
 * the Markdown preview (T277).
 *
 * `buildLinkMenu` decides the whole shape — ids, labels, order, enablement, absence — pure and
 * unit-tested clause by clause. This module does only what needs a renderer: attach icons, group the
 * flat `Open In` rows into one ▸ submenu, and wire each row's RUN to the caller's own performers.
 *
 * ══ EACH NAMED ROW PERFORMS ITS OWN TARGET (FR-054) ══
 *
 * The preference picks what Open Link does. It decides nothing about the rows beside it — a user who
 * reaches past Open Link to Open in OS Explorer has said exactly what they want — so every row but
 * Open Link and Copy Link to Clipboard routes straight to its own performer.
 *
 * ══ A DISABLED ROW CARRIES NO HANDLER ══
 *
 * `buildLinkMenu` already marks a row disabled or absent; a disabled row here gets no `onClick` at
 * all, so there is nothing for a future caller to reach past the disabled state and run.
 */

/** The performers for the five rows that act on an actual resolved target (rows 2 – 6). Absent for a
 *  link class with no file targets at all (web, loopback, protocol, anchor) — see {@link LinkMenuBuildArgs}. */
export interface LinkMenuPerformers {
  /**
   * Rows `openInNew`, `openInActive` and every named `openInEditor` row (FR-033, FR-170 row 2), each
   * with its OWN target — New and Active are different routes, and a performer that could not tell
   * them apart would open both into the same place. `link-open-in-perform.ts` performs it.
   */
  readonly openInEditor: (target: LinkOpenInTarget) => void | Promise<void>;
  /** FR-034. */
  readonly openInPreview: () => void | Promise<void>;
  /** FR-035 / FR-035a. */
  readonly osExplorer: () => void | Promise<void>;
  /** FR-036. */
  readonly osDefaultProgram: () => void | Promise<void>;
  /** S8 — the SAME route as `osDefaultProgram`: opening an executable with its default handler runs it. */
  readonly openProgram: () => void | Promise<void>;
}

export interface LinkMenuBuildArgs {
  readonly cls: ResourceClass | 'anchor';
  readonly applicable: LinkMenuApplicable;
  /** One row per open editor, by name (FR-170's row 2). Empty: New Editor / Active Editor only. */
  readonly openEditors?: readonly { readonly id: string; readonly name: string }[];
  /** The Open Link chord, only where the surface binds one (FR-169's note, FR-046). */
  readonly chord?: string;
  /** The surface's own Ctrl+click (§16.11) — Open Link runs exactly this. */
  readonly openLink: () => void;
  /** FR-032, FR-175 — Copy Link to Clipboard's own action; what it copies is the caller's to decide. */
  readonly copyLink: () => void | Promise<void>;
  readonly performers?: LinkMenuPerformers;
}

const ICONS: Partial<Record<LinkMenuItem['id'], string>> = {
  // Open Link and Open in OS Default Program carry no icon: no open/link token exists (023's rule,
  // #127) — an icon only where a real token exists, never a lookalike.
  openInNew: 'editorPanel',
  openInActive: 'editorPanel',
  openInEditor: 'editorPanel',
  openPreview: 'preview',
  osExplorer: 'folderOpen',
  copyLink: 'copy',
};

function performerFor(
  id: LinkMenuItem['id'],
  editorId: string | undefined,
  performers: LinkMenuPerformers | undefined,
): (() => void) | undefined {
  if (performers === undefined) return undefined;
  switch (id) {
    case 'openInNew':
      return () => void performers.openInEditor({ kind: 'new' });
    case 'openInActive':
      return () => void performers.openInEditor({ kind: 'active' });
    case 'openInEditor':
      return editorId === undefined
        ? undefined
        : () => void performers.openInEditor({ kind: 'editor', editorId });
    case 'openPreview':
      return () => void performers.openInPreview();
    case 'osExplorer':
      return () => void performers.osExplorer();
    case 'osDefaultProgram':
      return () => void performers.osDefaultProgram();
    case 'openProgram':
      return () => void performers.openProgram();
    default:
      return undefined;
  }
}

/**
 * `buildLinkMenu`'s rows, turned into `MenuAction[]` — the flat `Open In` rows (`submenu: 'Open In'`)
 * grouped into ONE ▸ submenu row, everything else at the top level, in the order `buildLinkMenu` gave.
 */
export function linkMenuActions(
  args: LinkMenuBuildArgs,
  resolution: ResolvedTarget | null | 'pending',
): MenuAction[] {
  const ctx: LinkMenuContext = {
    cls: args.cls,
    resolution,
    applicable: args.applicable,
    openEditors: args.openEditors ?? [],
    openLink: args.openLink,
    ...(args.chord !== undefined && args.chord.length > 0 ? { chord: args.chord } : {}),
  };

  const toAction = (item: LinkMenuItem): MenuAction => ({
    label: item.label,
    section: item.section,
    disabled: item.disabled,
    ...(ICONS[item.id] !== undefined ? { icon: ICONS[item.id] } : {}),
    ...(item.shortcut !== undefined ? { shortcut: item.shortcut } : {}),
    ...(item.disabled
      ? {}
      : {
          onClick:
            item.id === 'openLink'
              ? () => item.run?.()
              : item.id === 'copyLink'
                ? () => void args.copyLink()
                : performerFor(item.id, item.editorId, args.performers),
        }),
  });

  const rows: MenuAction[] = [];
  let openIn: MenuAction[] | null = null;
  for (const item of buildLinkMenu(ctx)) {
    if (item.submenu === 'Open In') {
      if (openIn === null) {
        openIn = [];
        // `buildLinkMenu` gives every Open In row the SAME disabled state (its one `openIn` verdict),
        // so the ▸ parent carries it too — a disabled parent greys out and stops opening on hover or
        // Enter, which is what "drawn disabled" (FR-170a) has to mean for a submenu.
        rows.push({ label: 'Open In', section: item.section, disabled: item.disabled, submenu: openIn });
      }
      openIn.push(toAction(item));
      continue;
    }
    rows.push(toAction(item));
  }
  return rows;
}
