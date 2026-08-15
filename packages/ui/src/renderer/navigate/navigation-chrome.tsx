/**
 * The navigation modals' mount point (033, contracts/navigation-modals.md §1).
 *
 * Mounted in **both** window shells — beside `EditorChrome` in `app.tsx` and in
 * `subworkspace-app.tsx`. Assumption 6 rejects a chord that works in one window and silently does
 * nothing in the other, and a sub-workspace window is a separate renderer realm with its own React
 * root: nothing mounted in the main window is present here.
 *
 * ══ THE ONE COMPONENT THAT KNOWS THIS WINDOW'S ROOT ══
 *
 * It resolves the project root by the rule `workspace/panel-body.tsx` already applies — the ACTIVE
 * PANEL'S ORIGIN PROJECT, falling back to the window's active project (R6, FR-017). Never the main
 * window's active project as such: a sub-workspace may hold panels from several projects, and
 * Quick Open in that window must offer the files of the project whose panel the user is standing in.
 *
 * That is also why the chord's route in is a REGISTRATION rather than a direct call. The window-level
 * keydown listener in `app.tsx` has no route into component state, and opening is conditional on the
 * root existing (FR-018, A5) — so the listener asks (`requestQuickOpen`) and this component answers.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import {
  collectPanels,
  effectiveActivePanelId,
  resolveAction,
  type ActionId,
} from '@throng/core';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useKeybindings } from '../config/config-store.js';
import { getActivePane } from '../workspace/active-pane.js';
import { scopeFromKind } from '../keybindings/scope.js';
import { useSubWorkspaceWindow } from '../workspace/subworkspace-window-context.js';
import {
  closeNavigationModal,
  registerQuickOpen,
  setNavigationModal,
  useNavigationModal,
} from './navigation-store.js';
import { useFileIndex } from './use-file-index.js';
import { QuickOpen } from './quick-open.js';

const QUICK_OPEN: ActionId = 'navigate.quickOpen';

export function NavigationChrome(): ReactElement | null {
  const modal = useNavigationModal();
  const { projects, activeProject } = useProjects();
  const { layout } = useWorkspace();
  const keybindings = useKeybindings();
  const subWin = useSubWorkspaceWindow();

  const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  const activePanelId = tab ? (effectiveActivePanelId(tab) ?? null) : null;
  const activePanel =
    tab && activePanelId ? collectPanels(tab.root).find((p) => p.id === activePanelId) : undefined;

  /*
   * R6 / FR-017 — the root, by `panel-body.tsx`'s rule.
   *
   * A panel created INSIDE a sub-workspace has no owning project ("rootless"), and must not fall
   * back to some unrelated active project's root: that would offer the user a different project's
   * files under this window's name. `null` here means Quick Open does not open at all (A5).
   */
  const originProject = projects.find((p) => p.id === activePanel?.originProjectId);
  const ownedBySub = subWin !== null && originProject === undefined;
  const root = ownedBySub ? null : (originProject?.rootFolder ?? activeProject?.rootFolder ?? null);

  /*
   * Subscribed here — in the component that is mounted for the WINDOW's lifetime — rather than
   * inside the modal (R1, R3).
   *
   * The index is a live mirror of the filesystem, kept current by the deltas main pushes (FR-016),
   * and it is what makes a keystroke cost nothing (R5). Subscribing only while the modal was open
   * would drop it on every close — UI-main disposes a root's index on its last unsubscribe (S9) —
   * so each invocation would re-walk the whole project before it could answer. `root === null`
   * subscribes to nothing and reports `idle`.
   */
  const index = useFileIndex(root, root !== null);

  /*
   * FR-011 — was the chord pressed from inside an EDITOR panel? That, and only that, decides whether
   * the target control is drawn, and it is captured at OPEN time (data-model.md §7). The active pane
   * matters as much as the panel kind: with the Files & Folders pane active the user is in the tree,
   * whatever panel the workspace last had.
   */
  const openFrom = (): { editorPanelId: string } | null =>
    getActivePane() === 'workspace' && activePanel?.kind === 'editor' && activePanelId !== null
      ? { editorPanelId: activePanelId }
      : null;

  // Read through a ref so the registration below is not re-installed on every layout change.
  const open = useRef(openFrom);
  open.current = openFrom;
  const rootRef = useRef(root);
  rootRef.current = root;

  useEffect(() => {
    const opener = (): boolean => {
      // A5 — no root for this window means the modal does not open, and never lists a previous
      // project's files. The command is still resolved and still swallowed; it simply does nothing.
      if (rootRef.current === null || rootRef.current === '') return false;
      setNavigationModal({ kind: 'quickOpen', invokedFrom: open.current() });
      return true;
    };
    registerQuickOpen(opener);
    return () => registerQuickOpen(null);
  }, []);

  /*
   * The sub-workspace window's missing half of `KeybindingsHandler`.
   *
   * `app.tsx` mounts the window-level chord dispatcher; `subworkspace-app.tsx` does not, and never
   * has — its shell carries `SearchKeybindings` and nothing else. So without this listener the
   * Quick Open chord would be live in the main window and dead in every sub-workspace, which is
   * exactly the failure Assumption 6 names. Installed ONLY here, so the main window keeps a single
   * dispatcher and cannot handle the chord twice.
   */
  const isSubWorkspace = subWin !== null;
  const activeKind = activePanel?.kind;
  useEffect(() => {
    if (!isSubWorkspace) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      const action = resolveAction(
        keybindings,
        { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
        scopeFromKind(activeKind),
      );
      if (action !== QUICK_OPEN) return;
      // Consumed whether or not it opens anything — a chord that reaches a terminal's shell after
      // the application has claimed it is FR-001's failure, not a fallback.
      e.preventDefault();
      e.stopPropagation();
      if (rootRef.current !== null && rootRef.current !== '') {
        setNavigationModal({ kind: 'quickOpen', invokedFrom: open.current() });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isSubWorkspace, keybindings, activeKind]);

  if (modal?.kind !== 'quickOpen' || root === null || root === '') return null;
  return (
    <QuickOpen
      root={root}
      index={index}
      invokedFrom={modal.invokedFrom}
      onDismiss={closeNavigationModal}
    />
  );
}
