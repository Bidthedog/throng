import type {
  FlavourOption,
  LinkMenuApplicable,
  LinkMenuItem,
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
import { currentLinkOpenInEditors, performLinkEditorTarget, performLinkOpenIn } from './link-open-in-perform.js';
import { openLinkMenu, type LinkMenuOpener } from './open-link-or-panel-menu.js';
import { binaryProviderClaims, logCaught, previewIconOf, relPathUnderRoot, resourceClass } from '@throng/core';
import { editorRefusesAsBinary } from '../editor/open-into-panel.js';
import { readOpenInFacts } from '../editor/open-in-perform.js';
import { describeOpenInTargets, openInMenuActions } from '../editor/open-in-targets.js';
import { openInRows, type OpenInOps } from '../explorer/open-in-rows.js';
import { requestFindInFiles } from '../find-in-files/open-find-in-files.js';
import { requestPreviewOpen } from '../preview/open-preview.js';
import { readPreviewOpenIn } from '../preview/preview-open-in.js';
import { linkFirstReadingByName } from './path-by-name.js';
import { openTerminalAt } from './open-terminal-at.js';
import { revealInFileExplorer } from '../explorer/reveal-in-tree.js';

/**
 * 045 FR-169 – FR-171, FR-170a – FR-170c — opening the ONE Link menu over a link, for every surface
 * that has one (T277). A terminal and an editor call these two functions with their own Ctrl+click
 * as `openLink`, their own chord (the editor binds one, the terminal none — FR-169's note), and
 * nothing else of their own: which rows apply, how the menu updates when main answers and what each
 * row performs are decided once, here, so the two menus cannot drift (SC-025).
 */

type Ws = Parameters<typeof performLinkOpenIn>[0];

const NO_SCHEMES: ReadonlySet<string> = new Set();

/**
 * The terminal flavour catalogue, read once per menu: the list `useFlavours()` holds for the File Explorer
 * (033 FR-030), read here without a hook because a link menu opens from a callback. Empty on failure, which
 * draws Terminal disabled (FR-035).
 */
async function readFlavours(): Promise<readonly FlavourOption[]> {
  try {
    const list = (await window.throng?.terminal?.listFlavours?.()) ?? [];
    return list.map((f) => ({
      value: f.id,
      label: f.label,
      defaultShellArguments: f.defaultShellArguments,
      reportsDirectory: f.reportsDirectory !== false,
    }));
  } catch (error) {
    logCaught('file-link-menu: list the terminal flavours for Open In ▸ Terminal', error);
    return [];
  }
}

/** The folder a terminal opened on `absPath` starts in: the folder itself, or a file's folder. */
function folderOf(absPath: string, kind: 'file' | 'folder'): string {
  if (kind === 'folder') return absPath;
  const cut = Math.max(absPath.lastIndexOf('/'), absPath.lastIndexOf('\\'));
  return cut > 0 ? absPath.slice(0, cut) : absPath;
}

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
  // #714 — a folder by grammar is never resolved (FR-158d), so where it lies is read by name: its first
  // reading, without the separator that marked it, and whether that is strictly inside the project.
  // The root itself is not: the tree IS the root, and has no row to reveal.
  const folderPath = folderByGrammar
    ? linkFirstReadingByName({ text: request.text, baseDirectory: request.baseDirectory, projectRoot }).replace(
        /(?<=.)[\\/]+$/,
        '',
      )
    : null;
  const folderInProject =
    folderPath !== null && projectRoot !== null && relPathUnderRoot(projectRoot, folderPath) !== null;
  let applicable: LinkMenuApplicable = {
    inProjectByName: clickTargetByName(request.text, projectRoot, request.baseDirectory) !== 'osExplorer',
    previewByExtension: previewStateByExtension(args.previewRegistry, args.previewSettings, request.text),
    // Unused while `resolution` is 'pending' or the grammar's own folder answer (`buildLinkMenu` never
    // reads it there); refined from main's answer once it arrives (FR-170a).
    executableByExtension: false,
    folderByGrammar,
    // 045 FR-170e (#719) — a PDF, an image or a spreadsheet has no editor: no Open In ▸ even before main answers.
    binaryByExtension: binaryProviderClaims(args.previewRegistry, request.text),
  };
  let resolvedLink: ResolvedLink | null = null;
  // 060 FR-045 — whether the resolved file is open in an editor anywhere (main's one-buffer answer),
  // folded into the same resolution so the Open In rows are right when the menu settles.
  let fileOpen = false;
  // 081 FR-054 — a UNC link keeps 045's menu; every other local link draws the File Explorer's Open In ▸.
  const unc = resourceClass(request.text, NO_SCHEMES, NO_SCHEMES) === 'unc';
  // 044 FR-012 — whether the resolved file already has its one preview, asked with the rest of the answer.
  let previewOpen = false;
  let flavours: readonly FlavourOption[] = [];
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
    // #714 — the panel header's Find in File Explorer, on the resolved target (or a folder by
    // grammar's own path). Drawn enabled only for a target inside the project (`buildLinkMenu`).
    findInExplorer: () => {
      const path = resolvedLink?.path ?? folderPath;
      if (path) revealInFileExplorer(path);
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

  /*
   * 081 FR-050 – FR-053 — the File Explorer's Open In ▸, built by its own `openInRows` from core's target
   * state, with the same editor targets (`describeOpenInTargets`) and preview targets (`readPreviewOpenIn`)
   * the explorer reads, sampled at each build. The performers act on the link's absolute path: the
   * resolved one once main answers, the first reading by name before (only OS File Explorer runs then,
   * and it acts on the REQUEST).
   */
  const openIn = (state: NonNullable<LinkMenuItem['openIn']>): MenuAction[] => {
    const absPath =
      resolvedLink?.path ??
      folderPath ??
      linkFirstReadingByName({ text: request.text, baseDirectory: request.baseDirectory, projectRoot });
    const projectId = request.originProjectId;
    const editorRows = openInMenuActions(describeOpenInTargets(readOpenInFacts(ws, absPath, fileOpen)), (target) => {
      if (!resolvedLink) return;
      // Through `performLinkTarget`, so FR-055's refusal of an out-of-project target stays below every caller.
      void performLinkTarget({
        target: 'editor',
        link: resolvedLink,
        request,
        ...at,
        deps: {
          ...deps,
          openInEditor: (link, pos) =>
            performLinkEditorTarget(ws, target, link.path, pos ? positionRevealTarget(pos.line, pos.column) : undefined),
        },
      });
    });
    const ops: OpenInOps = {
      osExplorer: () => void performers.osExplorer(),
      osDefaultProgram: () => void performers.osDefaultProgram(),
      editorRows,
      ...(projectRoot !== null && projectId !== undefined
        ? {
            preview: {
              ...readPreviewOpenIn({
                layout: ws.layout,
                registry: args.previewRegistry,
                settings: args.previewSettings,
                absPath,
                projectRoot,
                previewOpen,
              }),
              openLastActive: () => void requestPreviewOpen({ absPath, projectId, target: { mode: 'lastActive' }, flash: true }),
              openNew: () => void requestPreviewOpen({ absPath, projectId, target: { mode: 'new' }, flash: true }),
            },
          }
        : {}),
      flavours,
      openInTerminal: (path, flavour) => openTerminalAt(ws, folderOf(path, state.kind), flavour),
      ...(projectRoot !== null
        ? {
            findInFiles: (path: string, replace: boolean) =>
              void requestFindInFiles({
                route: 'contextMenu',
                replace,
                scopeSubPath: relPathUnderRoot(projectRoot, path) ?? '',
              }),
          }
        : {}),
    };
    return openInRows({ absPath, ...state }, ops);
  };

  const buildItems = (resolution: ResolvedTarget | null | 'pending'): MenuAction[] =>
    linkMenuActions(
      {
        cls: unc ? 'unc' : 'onDevice',
        openIn,
        applicable,
        // FR-170 row 2 — one Open In row per open editor, read at each build so main's answer removes
        // the editor that turns out to hold the target.
        openEditors: currentLinkOpenInEditors(ws, resolvedLink?.path),
        fileOpen,
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
        // 074 FR-103 — Open Preview wears the preview icon of the type the linked file previews as.
        previewIcon: previewIconOf(args.previewRegistry.forPath(resolvedLink?.path ?? request.text)),
      },
      resolution,
    );

  if (folderByGrammar) {
    const folder: ResolvedTarget = { kind: 'folder', inProject: folderInProject, executable: false, preview: 'none' };
    const opId = args.opener.openMenu(args.x, args.y, buildItems(folder));
    // Open In ▸ Terminal waits on the flavour catalogue, as the File Explorer's does: disabled until it arrives.
    if (!unc && folderInProject) {
      void readFlavours().then((list) => {
        flavours = list;
        args.opener.updateMenu(opId, buildItems(folder));
      });
    }
    return;
  }

  openLinkMenu({
    x: args.x,
    y: args.y,
    opener: args.opener,
    buildItems,
    // SC-021 — ONE `throng:links:resolve` per opening.
    resolve: async () => {
      const [answer, catalogue] = await Promise.all([
        resolveLinkForMenu(request),
        unc ? Promise.resolve<readonly FlavourOption[]>([]) : readFlavours(),
      ]);
      flavours = catalogue;
      if (answer.ok) {
        resolvedLink = answer.link;
        // 045 FR-170e (#719) — a file the editor refuses as binary gets no Open In ▸ row; asked only where one
        // could be drawn (an in-project file), in the same moment as the open question.
        let binary = false;
        if (answer.link.kind === 'file') {
          const path = answer.link.path;
          [fileOpen, binary, previewOpen] = await Promise.all([
            (async () => {
              try {
                return (await window.throng?.editor?.isOpen?.(path)) ?? false;
              } catch (error) {
                logCaught('file-link-menu: ask whether the linked file is open', error);
                return false;
              }
            })(),
            answer.link.inProject
              ? editorRefusesAsBinary(ws, path, args.previewRegistry, request.originProjectId)
              : Promise.resolve(false),
            // 044 FR-012 — the preview rows give way to Current Preview when the file has its one preview.
            answer.link.inProject && !unc
              ? (async () => {
                  try {
                    return (await window.throng?.preview?.isOpen?.(path)) ?? false;
                  } catch (error) {
                    logCaught('file-link-menu: ask whether the linked file has its preview', error);
                    return false;
                  }
                })()
              : Promise.resolve(false),
          ]);
        }
        return {
          kind: answer.link.kind,
          inProject: answer.link.inProject,
          executable: answer.link.executable,
          preview: answer.link.preview,
          ...(binary ? { binary } : {}),
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
