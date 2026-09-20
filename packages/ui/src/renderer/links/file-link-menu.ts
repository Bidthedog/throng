import type {
  LinkMenuApplicable,
  LinkPosition,
  LinkResolutionRequest,
  PreviewProviderRegistry,
  PreviewSettings,
  ResolvedLink,
  ResolvedTarget,
} from '@throng/core';
import type { MenuAction } from '../workspace/context-menu.js';
import { positionRevealTarget } from '../editor/reveal-range.js';
import { clickTargetByName, folderByGrammarByName, previewStateByExtension } from './click-by-name.js';
import { copyLinkAddress, performLinkTarget, resolveLinkForMenu, type LinkActionDeps } from './link-actions.js';
import { linkMenuActions, type LinkMenuPerformers } from './link-menu.js';
import { currentLinkOpenInEditors, performLinkOpenIn } from './link-open-in-perform.js';
import { openLinkMenu, type LinkMenuOpener } from './open-link-or-panel-menu.js';

/**
 * 045 FR-169 – FR-171, FR-170a – FR-170c — opening the ONE Link menu over a link, for every surface
 * that has one (T277). A terminal and an editor call these two functions with their own Ctrl+click
 * as `openLink`, their own chord (the editor binds one, the terminal none — FR-169's note), and
 * nothing else of their own: which rows apply, how the menu updates when main answers and what each
 * row performs are decided once, here, so the two menus cannot drift (SC-025).
 */

type Ws = Parameters<typeof performLinkOpenIn>[0];

/** The rows a web, loopback or protocol link has: Open Link and Copy Link to Clipboard, from its class alone. */
const NO_FILE_TARGETS: LinkMenuApplicable = {
  inProjectByName: false,
  previewByExtension: 'none',
  executableByExtension: false,
  folderByGrammar: false,
};

/** A web-class link — nothing is asked of main, so the menu opens once, complete. */
export function openWebLinkMenu(args: {
  readonly x: number;
  readonly y: number;
  readonly opener: Pick<LinkMenuOpener, 'openMenu'>;
  readonly chord?: string;
  /** The surface's web route — the same one its Ctrl+click takes (FR-104). */
  readonly openLink: () => void;
  /** Copies the address exactly as written. */
  readonly copyLink: () => void | Promise<void>;
}): void {
  args.opener.openMenu(
    args.x,
    args.y,
    linkMenuActions(
      {
        cls: 'web',
        applicable: NO_FILE_TARGETS,
        ...(args.chord !== undefined ? { chord: args.chord } : {}),
        openLink: args.openLink,
        copyLink: args.copyLink,
      },
      null,
    ),
  );
}

/**
 * A file link, drawn by grammar (FR-155). Its `applicable` rows — in the project by name, not a folder
 * by grammar, a provider by extension — are decided here without the disk, so the menu never sits
 * empty while main is asked; rows 5 / 6 wait for main's answer (FR-170c). A folder by grammar
 * (FR-158c / FR-158d) never asks main at all — it opens with its own synthesised resolution.
 */
export function openFileLinkMenu(args: {
  readonly x: number;
  readonly y: number;
  readonly opener: LinkMenuOpener;
  readonly ws: Ws;
  readonly request: LinkResolutionRequest;
  readonly position?: LinkPosition;
  /** How the position was written — Copy Link to Clipboard pastes it back in this form (FR-032). */
  readonly positionText?: string;
  /** The owning project's root, by which "in the project" is judged by name. */
  readonly projectRoot: string | null;
  readonly previewRegistry: PreviewProviderRegistry;
  readonly previewSettings: PreviewSettings;
  /** The Open Link chord, only where the surface binds one (FR-046). */
  readonly chord?: string;
  /** The surface's own Ctrl+click (FR-054). */
  readonly openLink: () => void;
  /** The surface's performers, the two OS routes included. `openInEditor` is replaced per Open In row. */
  readonly deps: LinkActionDeps;
}): void {
  const { request, position, positionText, projectRoot, ws, deps } = args;
  const folderByGrammar = folderByGrammarByName(request.text, projectRoot);
  let applicable: LinkMenuApplicable = {
    inProjectByName: clickTargetByName(request.text, projectRoot, request.baseDirectory) !== 'osExplorer',
    previewByExtension: previewStateByExtension(args.previewRegistry, args.previewSettings, request.text),
    // Unused while `resolution` is 'pending' or the grammar's own folder answer (`buildLinkMenu` never
    // reads it there); refined from main's answer once it arrives (FR-170a).
    executableByExtension: false,
    folderByGrammar,
  };
  let resolvedLink: ResolvedLink | null = null;
  const stub = (path: string): ResolvedLink => ({
    path,
    kind: 'file',
    inProject: false,
    executable: false,
    preview: 'none',
  });
  const at = position === undefined ? {} : { position };

  const performers: LinkMenuPerformers = {
    // FR-170 row 2 — New Editor, Active Editor or a named editor, each its own route; still through
    // `performLinkTarget`, so FR-055's refusal of an out-of-project target stays below every caller.
    openInEditor: (target) => {
      if (!resolvedLink) return;
      void performLinkTarget({
        target: 'editor',
        link: resolvedLink,
        request,
        ...at,
        deps: {
          ...deps,
          openInEditor: (link, pos) =>
            performLinkOpenIn(ws, target, link.path, pos ? positionRevealTarget(pos.line, pos.column) : undefined),
        },
      });
    },
    openInPreview: () => {
      if (!resolvedLink) return;
      void performLinkTarget({ target: 'preview', link: resolvedLink, request, deps });
    },
    // The two OS routes act on the REQUEST, never on `link` (FR-035, FR-037), so a folder's
    // synthesised resolution needs no real path here.
    osExplorer: () =>
      void performLinkTarget({ target: 'osExplorer', link: resolvedLink ?? stub(request.text), request, deps }),
    osDefaultProgram: () => {
      if (!resolvedLink) return;
      void performLinkTarget({ target: 'osDefaultProgram', link: resolvedLink, request, deps });
    },
    // S8 — Open Program is the SAME route: opening an executable with its default handler runs it.
    openProgram: () => {
      if (!resolvedLink) return;
      void performLinkTarget({ target: 'osDefaultProgram', link: resolvedLink, request, deps });
    },
  };

  const buildItems = (resolution: ResolvedTarget | null | 'pending'): MenuAction[] =>
    linkMenuActions(
      {
        cls: 'onDevice',
        applicable,
        // FR-170 row 2 — one Open In row per open editor, read at each build so main's answer removes
        // the editor that turns out to hold the target.
        openEditors: currentLinkOpenInEditors(ws, resolvedLink?.path),
        ...(args.chord !== undefined ? { chord: args.chord } : {}),
        openLink: args.openLink,
        // FR-032 — the resolved absolute path once known; the text as written until then, which is the
        // best this row can do while it is the only one still enabled.
        copyLink: () =>
          void copyLinkAddress({
            link: resolvedLink ?? stub(request.text),
            ...(positionText === undefined ? {} : { positionText }),
          }),
        performers,
      },
      resolution,
    );

  if (folderByGrammar) {
    args.opener.openMenu(
      args.x,
      args.y,
      buildItems({ kind: 'folder', inProject: true, executable: false, preview: 'none' }),
    );
    return;
  }

  openLinkMenu({
    x: args.x,
    y: args.y,
    opener: args.opener,
    buildItems,
    // SC-021 — ONE `throng:links:resolve` per opening.
    resolve: async () => {
      const answer = await resolveLinkForMenu(request);
      if (answer.ok) {
        resolvedLink = answer.link;
        return {
          kind: answer.link.kind,
          inProject: answer.link.inProject,
          executable: answer.link.executable,
          preview: answer.link.preview,
        };
      }
      applicable = {
        ...applicable,
        executableByExtension: answer.executableByExtension ?? applicable.executableByExtension,
        previewByExtension: answer.previewByExtension ?? applicable.previewByExtension,
      };
      return null;
    },
  });
}
