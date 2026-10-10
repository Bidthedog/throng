/**
 * The window's Find in Files chrome (043 T069) — one registration, mounted once per window realm.
 *
 * Opening a Find in Files panel needs three things no chord listener and no toolbar button has: the
 * workspace store, the project list, and the live preferences. `navigate/navigation-store.ts`
 * solves the identical problem the identical way, and its reasoning applies unchanged here — the
 * window-level capture listener in `app.tsx` has no route into a component's state, and the
 * explorer toolbar is rendered by a pane that holds no workspace store.
 *
 * So this component holds all three and registers HOW to open; the chord, the toolbar control and
 * the folder context menu each ask. One opener rather than three that must be kept in step.
 */
import { useEffect, type ReactElement } from 'react';
import { defaultOpenActionFor, normaliseForCompare } from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { requestPreviewOpen } from '../preview/open-preview.js';
import { usePreviewProviders } from '../preview/provider-registry-context.js';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { initialFindInFilesGrouping } from './find-in-files-store.js';
import {
  openFindInFiles,
  registerFindInFilesOpener,
  type FindInFilesRequest,
} from './open-find-in-files.js';
import {
  listResultOpenTargets,
  openResultRow,
  registerResultOpener,
  registerResultOpenTargets,
  resolveResultPath,
  type ResultOpenRequest,
} from './result-open.js';

export function FindInFilesChrome(): ReactElement | null {
  const ws = useWorkspace();
  const { projects, activeProject } = useProjects();
  /*
   * FR-021 / FR-033a / FR-033b — read by NAME, and the section is named in this file too.
   *
   * `settings-inertness-043.test.ts` requires both: a reader must read the leaf AND mention
   * `inFiles`, because `openTarget` is already a leaf of `editor` and leaf-only matching would
   * report this preference as live before a line of the feature existed. Pulling the section out
   * first is the idiom that guard accepts, and it is also the honest one — these three belong to
   * the same section and are read at the same moment.
   */
  const inFiles = useAppSettings().search.inFiles;
  const openTarget = inFiles.openTarget;
  const defaultGrouping = inFiles.defaultGrouping;
  const rememberGrouping = inFiles.rememberGrouping;

  /*
   * The project the panel will search — this window's ACTIVE project.
   *
   * `null` is a real state and not an error: no project open. The opener treats it as FR-029e's
   * "the chord does nothing", so nothing here has to branch on it.
   */
  const projectId = ws.layout?.projectId ?? activeProject?.id ?? null;
  const projectRoot = projects.find((p) => p.id === projectId)?.rootFolder ?? null;

  /*
   * FR-037 — the "Open files in" preference, read here for the same reason `openTarget` above is:
   * a result row's double-click must land the file exactly where a click in the file tree would.
   * `EditorOpenListener` reads this same key for the tree's own opens.
   */
  const editorOpenTarget = useAppSettings().editor.openTarget;
  /** 054 FR-030 — what decides whether a result opens as a preview: the file's provider and its default. */
  const previewSettings = useAppSettings().editor.previews;
  const previewProviders = usePreviewProviders();

  /*
   * FR-037 and FR-087 in ONE effect, registered and torn down together.
   *
   * They are two registrations because they answer two different questions — how to open a row, and
   * what the targets for a row's file currently are — but they depend on exactly the same three
   * things and describe the same panel. Registering them apart would let one outlive the other
   * across a project change, and the failure that produces is a menu listing targets for the file it
   * was about to stop being able to open.
   */
  /*
   * 043 T236 — registered UNCONDITIONALLY, and each request answered against the root of the PANEL
   * that sent it.
   *
   * This used to register nothing when the WINDOW had no project root — and a sub-workspace window
   * never has one of its own: its layout's project id is the synthetic `subworkspace:<id>`, which
   * matches no project. So in that window double-click, Enter and Open In on a result row did
   * nothing at all, on rows FR-078 had just mirrored there. The panel knows its own root, a
   * sub-workspace can hold panels from several projects, and so the root travels with the request;
   * the window's root is only the fallback for a caller that sends none.
   */
  useEffect(() => {
    const open = (request: ResultOpenRequest): void => {
      const root = request.projectRoot ?? projectRoot;
      if (root === null || root === '') return;
      const inEditor = (): void => {
        void openResultRow({ ws, projectRoot: root, openTarget: editorOpenTarget, request });
      };
      /*
       * 054 FR-030 (supersedes 044 FR-054) — a row with no named destination opens where the reader reads
       * the file: its preview when its provider's default open action is Preview, through the one
       * `preview.open` every entry point uses (Last Active reuse, New Preview Panel, an existing preview
       * focused — FR-004). The match travels with it as a pending reveal; a match the preview cannot show,
       * or a preview main refuses, opens the editor at the match instead (FR-032). An Open In row names
       * its own destination, which wins (044 FR-055).
       */
      const absPath = resolveResultPath(root, request.relPath);
      const owner = projects.find((p) => normaliseForCompare(p.rootFolder) === normaliseForCompare(root))?.id;
      if (
        request.target === undefined &&
        owner !== undefined &&
        defaultOpenActionFor(previewProviders.registry, previewSettings, absPath) === 'preview'
      ) {
        void requestPreviewOpen({
          absPath,
          projectId: owner,
          reveal: { from: request.from, to: request.to, text: request.text ?? '', line: request.line ?? null, fallback: inEditor },
        }).then((opened) => {
          if (!opened) inEditor();
        });
        return;
      }
      inEditor();
    };
    registerResultOpener(open);
    // No `editorOpenTarget` here on purpose: the preference decides where a DOUBLE-CLICK lands, and
    // a named target overrides it, so listing the targets never consults it.
    registerResultOpenTargets((relPath, panelRoot) => {
      const root = panelRoot ?? projectRoot;
      if (root === null || root === '') return Promise.resolve([]);
      return listResultOpenTargets({ ws, projectRoot: root, relPath });
    });
    return () => {
      registerResultOpener(null);
      registerResultOpenTargets(null);
    };
  }, [ws, projectRoot, projects, editorOpenTarget, previewProviders, previewSettings]);

  useEffect(() => {
    const open = (request: FindInFilesRequest): boolean =>
      openFindInFiles({
        ...request,
        ws,
        projectId,
        projectRoot,
        openTarget,
        // Resolved here, at the moment of opening, so a new panel's grouping honours both
        // preferences and the per-project memory without the panel opening in one grouping and
        // correcting itself in an effect.
        grouping: initialFindInFilesGrouping(projectId, { defaultGrouping, rememberGrouping }),
      }) !== null;
    registerFindInFilesOpener(open);
    return () => registerFindInFilesOpener(null);
  }, [ws, projectId, projectRoot, openTarget, defaultGrouping, rememberGrouping]);

  return null;
}
