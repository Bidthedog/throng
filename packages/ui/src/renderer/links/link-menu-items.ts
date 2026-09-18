import { fileLinkMenuItems, type LinkPosition, type LinkResolutionRequest, type LinkTarget, type ResolvedLink } from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { copyLinkAddress, openWebLink, performLinkTarget, type LinkActionDeps } from './link-actions.js';

/**
 * 045 FR-031 — core's file-link shapes, turned into the rows a throng menu draws (T078).
 *
 * ══ ONE BUILDER, BOTH PANEL TYPES ══
 *
 * FR-031 requires the terminal's menu and the editor's menu to offer the same run over the same
 * link. Two builders would be two chances to disagree — about the order, about which item is absent
 * for a folder, about whether a disabled preview is drawn at all — so there is one, and the surfaces
 * differ in exactly the two inputs that genuinely differ: the chord (the terminal binds none,
 * FR-046) and what Open Link does (each surface's own default-action route).
 *
 * The labels, the order, the absences and the one disabled state are NOT decided here. They are
 * `fileLinkMenuItems` in `@throng/core`, which is pure and unit-tested clause by clause; this module
 * only attaches the icons, the section and the handlers — which is the part that needs a renderer.
 *
 * ══ EACH NAMED ITEM PERFORMS ITS OWN TARGET (FR-054) ══
 *
 * The preference picks what *Open Link* does. It decides nothing about the five items beside it: a
 * user who reaches past Open Link to *Open in OS Explorer* has said exactly what they want, and an
 * item that re-consulted the preference would ignore them. So every named row routes straight to
 * `performLinkTarget` with its OWN target, and only Open Link runs the surface's default route.
 *
 * ══ ICONS ══
 *
 * 023's rule, unchanged: an icon only where a token exists. Editor, preview, the file manager and
 * the copy glyph have one; *Open Link* and *Open in OS Default Program* do not, and inventing a
 * lookalike token would draw a blank cell in every theme that has not heard of it (#127).
 */

const TARGET_ICONS: Partial<Record<LinkTarget, string>> = {
  editor: 'editorPanel',
  preview: 'preview',
  osExplorer: 'folderOpen',
};

/** Everything a menu needs to draw and perform the run over ONE link. */
export interface FileLinkMenuContext {
  readonly link: ResolvedLink;
  /**
   * What main was asked. It travels to the two OS routes untouched, so they re-resolve the link
   * rather than acting on a path the renderer is holding (FR-037).
   */
  readonly request: LinkResolutionRequest;
  /** FR-004's position, when the link carried one. Ignored by everything but the editor (FR-034). */
  readonly position?: LinkPosition;
  /** How that position was WRITTEN — Copy Link Address pastes it back in this form (FR-032). */
  readonly positionText?: string;
  /** The chord bound to Open Link in this surface's scope. The terminal passes none (FR-046). */
  readonly chord?: string;
  /**
   * FR-054 — the surface's default-action route, the same one its Ctrl+click takes. Passed in
   * rather than computed here so the two can never resolve the preference differently.
   */
  readonly openLink: () => void | Promise<void>;
  readonly deps: LinkActionDeps;
}

/** Everything a menu needs to draw and perform the run over ONE web link (FR-103, S4). */
export interface WebLinkMenuContext {
  /** The address exactly as written — what Open Link opens and Copy Link Address copies. */
  readonly uri: string;
  /** The chord bound to Open Link in this surface's scope. The terminal passes none (FR-046). */
  readonly chord?: string;
  /** The surface's web route — the same one its Ctrl+click takes. Absent: {@link openWebLink}. */
  readonly openLink?: () => void | Promise<void>;
  /**
   * How this surface writes a plain address to the clipboard. Absent: the app clipboard, verbatim.
   * The terminal passes its own writer, which 024 shipped and this run keeps byte for byte.
   */
  readonly copyLinkAddress?: () => void | Promise<void>;
}

/**
 * 045 FR-103, FR-104 — the web-link pair, Open Link then Copy Link Address, for BOTH panel types.
 *
 * The terminal's pair was written out inline by 024; the editor needs the same two rows over the
 * same link, so they are built once here and the terminal's menu calls this rather than keeping its
 * own copy. Labels, test ids, icon and section are 024's, unchanged.
 */
export function webLinkMenuActions(context: WebLinkMenuContext | null): MenuAction[] {
  if (context === null) return [];
  const { uri, chord } = context;
  const open = context.openLink ?? ((): void => openWebLink(uri));
  const copy =
    context.copyLinkAddress ??
    (async (): Promise<void> => {
      // 'verbatim' — an address is not a line-wise or rectangular selection, so it pastes as written.
      await window.throng?.clipboard?.write({ text: uri, mode: 'verbatim' });
    });
  return [
    {
      // No icon: there is no link/open token, and 023's rule is "an icon only where a token
      // exists". "Copy Link Address" is a copy action, so it carries the shared copy glyph.
      label: 'Open Link',
      testId: 'menu-item-Open Link',
      section: 'contextual',
      ...(chord !== undefined && chord.length > 0 ? { shortcut: chord } : {}),
      onClick: () => void open(),
    },
    {
      label: 'Copy Link Address',
      icon: 'copy',
      testId: 'menu-item-Copy Link Address',
      section: 'contextual',
      onClick: () => void copy(),
    },
  ];
}

export function fileLinkMenuActions(context: FileLinkMenuContext | null): MenuAction[] {
  // FR-013: a candidate that resolved to nothing is a NON-link. No items — not six disabled ones,
  // which would tell the user throng knows about a file it has just failed to find.
  if (context === null) return [];

  const { link, request, position, positionText, chord, openLink, deps } = context;

  return fileLinkMenuItems(link, chord).map((item): MenuAction => {
    const id = item.id;
    const base = {
      label: item.label,
      testId: `menu-item-${item.label}`,
      section: item.section,
      ...(item.shortcut ? { shortcut: item.shortcut } : {}),
      ...(item.disabled ? { disabled: true } : {}),
    };

    if (id === 'openLink') return { ...base, onClick: () => void openLink() };
    if (id === 'copyLinkAddress') {
      return {
        ...base,
        icon: 'copy',
        onClick: () => void copyLinkAddress({ link, ...(positionText ? { positionText } : {}) }),
      };
    }

    const icon = TARGET_ICONS[id];
    return {
      ...base,
      ...(icon ? { icon } : {}),
      // A disabled row carries NO handler. The menu will not invoke one, and leaving it out means
      // there is nothing for a future caller to reach past the disabled state and run.
      ...(item.disabled
        ? {}
        : {
            onClick: () =>
              void performLinkTarget({
                target: id,
                link,
                request,
                ...(position === undefined ? {} : { position }),
                deps,
              }),
          }),
    };
  });
}
