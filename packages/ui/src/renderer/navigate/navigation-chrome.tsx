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
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  collectPanels,
  effectiveActivePanelId,
  resolveAction,
  type ActionId,
} from '@throng/core';
import { useTransientOverlay } from '../common/transient-overlay.js';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
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
import { GotoLine } from './goto-line.js';

const QUICK_OPEN: ActionId = 'navigate.quickOpen';
const GOTO_LINE: ActionId = 'navigate.gotoLine';

export function NavigationChrome(): ReactElement | null {
  const modal = useNavigationModal();
  const { projects, activeProject } = useProjects();
  const { layout } = useWorkspace();
  const keybindings = useKeybindings();
  const settings = useAppSettings();
  const subWin = useSubWorkspaceWindow();

  /*
   * FR-071 — this window's ONE transient-overlay slot (plan D1).
   *
   * ONE call covers both modals, because they already share one slot: `setNavigationModal` replaces
   * WITHIN it (FR-066), so `modal !== null` never flickers when Quick Open gives way to Go To Line
   * and the claim is never re-taken. Two calls, one per modal kind, would flicker on exactly that
   * transition — a release and a re-claim in the same commit — and the re-claim would dismiss
   * whatever the release had just let in.
   *
   * Nothing here imports `../workspace/`, and nothing there imports this module. That is FR-071a,
   * and `tests/unit/overlay-feature-isolation.test.ts` is what keeps it true.
   */
  useTransientOverlay(modal !== null, closeNavigationModal);

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
   *
   * ══ TWO SUBSCRIPTIONS, AND WHY THE STANDING ONE IS NEVER GIVEN UP (FR-069, plan D2) ══
   *
   * The exclusion state is part of the subscription KEY, so the toggle chooses between two indices
   * rather than changing one. `standing` is held at the SETTING's value for the window's lifetime —
   * that is what makes a keystroke free (R5). `flipped` exists only while the toggle differs from the
   * setting, and dies with the modal.
   *
   * Re-pointing the single subscription instead would dispose the default index the moment the toggle
   * moved (S9 drops a root on its last unsubscribe), and the NEXT invocation would re-walk the whole
   * project before it could answer — the stall FR-013 forbids, arriving as a side effect of a toggle
   * the user had already flipped back.
   */
  const defaultIncludeHidden = !settings.editor.navigation.quickOpenExcludeHidden; // FR-069b
  const [includeHidden, setIncludeHidden] = useState(defaultIncludeHidden);
  const standing = useFileIndex(root, root !== null, defaultIncludeHidden);
  const flipped = useFileIndex(
    root,
    root !== null && includeHidden !== defaultIncludeHidden,
    !defaultIncludeHidden,
  );
  const index = includeHidden === defaultIncludeHidden ? standing : flipped;

  /*
   * FR-069b — "the toggle changes the current modal; the setting decides where every modal starts."
   *
   * Reset on the TRANSITION into an open Quick Open, not by remounting `<QuickOpen>` on a `key`: a
   * remount would also discard the query the user has typed, on any re-render that happened to change
   * the key for another reason.
   */
  const quickOpenIsOpen = modal?.kind === 'quickOpen';
  useEffect(() => {
    if (quickOpenIsOpen) setIncludeHidden(defaultIncludeHidden);
  }, [quickOpenIsOpen, defaultIncludeHidden]);

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
  // The panel Go To Line acts on, read the same way — the listener below is installed once and must
  // not be re-subscribed every time the active panel changes.
  const activePanelIdRef = useRef(activePanelId);
  activePanelIdRef.current = activePanelId;

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
      if (action === QUICK_OPEN) {
        // Consumed whether or not it opens anything — a chord that reaches a terminal's shell after
        // the application has claimed it is FR-001's failure, not a fallback.
        e.preventDefault();
        e.stopPropagation();
        if (rootRef.current !== null && rootRef.current !== '') {
          setNavigationModal({ kind: 'quickOpen', invokedFrom: open.current() });
        }
        return;
      }
      /*
       * 033 US2 — Go To Line, in a sub-workspace window too (Assumption 6).
       *
       * `resolveAction` above is already scoped by the active panel's KIND, and the command is
       * EDITOR_ONLY — so reaching this branch means an editor panel is active and there is a panel
       * id to act on. A chord that worked in the main window and did nothing here is exactly the
       * failure that mounts this component in both shells.
       */
      if (action === GOTO_LINE && activePanelIdRef.current !== null) {
        e.preventDefault();
        e.stopPropagation();
        setNavigationModal({ kind: 'gotoLine', panelId: activePanelIdRef.current });
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isSubWorkspace, keybindings, activeKind]);

  /*
   * 033 US2 — Go To Line, from the same ONE slot (S1, S2).
   *
   * Rendered before Quick Open's guard rather than beside it, because the two have different
   * preconditions: Quick Open needs this window to have a project root, and Go To Line needs only the
   * panel id the slot is carrying. Sharing a `root === null` early return would have made the chord
   * dead in a rootless sub-workspace for no reason — a document has lines whether or not the window
   * knows which project it came from.
   */
  if (modal?.kind === 'gotoLine') {
    return <GotoLine panelId={modal.panelId} onDismiss={closeNavigationModal} />;
  }

  if (modal?.kind !== 'quickOpen' || root === null || root === '') return null;
  return (
    <QuickOpen
      root={root}
      index={index}
      invokedFrom={modal.invokedFrom}
      includeHidden={includeHidden}
      onIncludeHiddenChange={setIncludeHidden}
      onDismiss={closeNavigationModal}
    />
  );
}
