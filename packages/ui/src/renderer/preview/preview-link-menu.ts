import type {
  LinkResolutionRequest,
  PreviewLink,
  PreviewProviderRegistry,
  PreviewSettings,
} from '@throng/core';
import { linkAddress } from './content-menu.js';
import type { LinkActionDeps } from '../links/link-actions.js';
import { openFileLinkMenu, openWebLinkMenu } from '../links/file-link-menu.js';
import type { LinkMenuOpener } from '../links/open-link-or-panel-menu.js';

/** The workspace slice `openFileLinkMenu` needs, for its Open In ▸ rows. */
type Ws = Parameters<typeof openFileLinkMenu>[0]['ws'];

/**
 * 045 FR-169 – FR-171, S6/S7 — the Markdown preview's Link menu, on the same `buildLinkMenu` path a
 * terminal and an editor already draw from (T277).
 *
 * ══ ONE MENU, THREE SURFACES (SC-025) ══
 *
 * `file` and `outside` PreviewLink kinds are file links exactly as a terminal or an editor sees one —
 * `openFileLinkMenu` sends the SAME menu-open `throng:links:resolve` and fills rows 2 – 6 from its
 * answer, never a preview-only shortcut. `external` (`http(s)` — web class — and `mailto:` — protocol
 * class) and `heading` (an in-document anchor, FR-169's note: "offers Open Link and Copy Link to
 * Clipboard only") need nothing from main, so they take `openWebLinkMenu` — its own `cls` value never
 * reaches a drawn row (`buildLinkMenu` branches only on `unc`/`onDevice` vs everything else), so
 * reusing it for a heading or a `mailto:` link draws exactly the two rows FR-169 asks for.
 *
 * ══ OPEN LINK IS 044'S OWN FOLLOW, UNCHANGED (S6) ══
 *
 * The preview's hover tooltip, its Ctrl+click, its status-bar readout and what each link does when
 * followed (044 FR-090 – FR-096) are unchanged by this feature — only how the Link menu is BUILT
 * moves onto the shared path. So Open Link, and the surface's own Ctrl+click, both run `onFollow`
 * unaltered: they can never diverge from what this panel already does for that link (FR-054).
 */
export interface PreviewLinkMenuArgs {
  readonly x: number;
  readonly y: number;
  readonly opener: LinkMenuOpener;
  readonly link: PreviewLink;
  /** The panel the link was seen in (`LinkResolutionRequest.panelId`). */
  readonly panelId: string;
  /** The panel's owning project — absent for a sub-workspace preview with none (M3). */
  readonly projectId?: string;
  readonly projectRoot: string | null;
  /** The previewed document's own path — a relative reference resolves against its directory. */
  readonly docPath: string;
  readonly previewRegistry: PreviewProviderRegistry;
  readonly previewSettings: PreviewSettings;
  /** The `preview.followLink` chord, only where one is bound (FR-169's note, FR-046). */
  readonly chord?: string;
  readonly ws: Ws;
  /** The two OS routes and this window's Open In / Open Preview performers (FR-054). */
  readonly deps: LinkActionDeps;
  /** 044's own follow (S6) — Open Link and Ctrl+click run exactly this. */
  readonly onFollow: (link: PreviewLink) => void;
}

/** The directory holding `docPath` — what a Markdown reference resolves against (`classifyPreviewLink`'s own rule). */
function docDirectory(docPath: string): string {
  const sep = docPath.includes('\\') ? '\\' : '/';
  const at = docPath.lastIndexOf(sep);
  return at <= 0 ? docPath : docPath.slice(0, at);
}

/**
 * Opens the Link menu for `link`. `false` for an `inert` link — FR-169's Link menu never applies to
 * one, so the caller's ordinary body menu opens instead, exactly as it does away from any link.
 */
export function openPreviewLinkMenu(args: PreviewLinkMenuArgs): boolean {
  const { link, x, y, opener, chord } = args;
  const openLink = (): void => args.onFollow(link);
  const withChord = chord !== undefined ? { chord } : {};

  switch (link.kind) {
    case 'inert':
      return false;
    case 'heading':
      openWebLinkMenu({
        x,
        y,
        opener,
        ...withChord,
        openLink,
        // FR-116 — a same-document heading copies THIS document's own path, then the fragment.
        copyLink: () =>
          void window.throng?.clipboard?.write({
            text: linkAddress(link, args.docPath),
            mode: 'verbatim',
          }),
      });
      return true;
    case 'external':
      openWebLinkMenu({
        x,
        y,
        opener,
        ...withChord,
        openLink,
        copyLink: () => void window.throng?.clipboard?.write({ text: link.url, mode: 'verbatim' }),
      });
      return true;
    case 'file':
    case 'outside': {
      const text = link.kind === 'file' ? link.absPath : link.target;
      const request: LinkResolutionRequest = {
        text,
        kind: 'fileHyperlink',
        panelId: args.panelId,
        baseDirectory: docDirectory(args.docPath),
        ...(args.projectId !== undefined ? { originProjectId: args.projectId } : {}),
      };
      openFileLinkMenu({
        x,
        y,
        opener,
        ws: args.ws,
        request,
        ...(link.kind === 'file' && link.fragment !== undefined
          ? { positionText: `#${link.fragment}` }
          : {}),
        projectRoot: args.projectRoot,
        previewRegistry: args.previewRegistry,
        previewSettings: args.previewSettings,
        ...withChord,
        openLink,
        deps: args.deps,
      });
      return true;
    }
  }
}
