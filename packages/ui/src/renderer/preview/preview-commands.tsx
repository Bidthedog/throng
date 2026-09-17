/**
 * The window's preview wiring (044 FR-005, FR-010, FR-012, FR-014; contracts/preview-ipc.md §2).
 *
 * Mounted once per window by `EditorChrome` — the main window and every sub-workspace window — because
 * each is a separate renderer realm and a command that worked in one and did nothing in the other is
 * the failure 033's Assumption 6 names. It holds six things and renders nothing:
 *
 * 1. **The `preview.open` command.** Registered as this window's opener (`registerPreviewOpener`), so
 *    the status-bar button, the editor's two menus and Files & Folders all run the same action (FR-005).
 * 2. **Its chord in an editor.** `preview.open` ships unbound; when a user binds it, the chord opens the
 *    preview of the focused editor's file. Files & Folders dispatches the same command for its own
 *    selection from its pane handler (`explorer-keybindings.ts`), which is where that selection lives.
 * 3. **`place` and `focus`** — main asking this window to put a preview beside a parent it holds, or to
 *    bring one forward (`open-preview.ts`).
 * 4. **`openChanged`** into `preview-open-store`, seeded from main's `openPaths` so a window created
 *    after a preview opened knows about it too. It is what draws the status-bar button pressed and
 *    Open Preview disabled for a preview opened in ANY window (FR-012, FR-014).
 * 5. **`preview.followLink`** (FR-096c) — scoped to `preview`, shipping as Ctrl+Enter: with a preview
 *    active, the link that has focus in it is followed exactly as a Ctrl+click follows it. The panel does
 *    the following (`preview-panel-handles.ts`); this only resolves the key.
 * 6. **`preview.toggleSyncScroll`** (FR-122d) — scoped to editors and previews, shipping unbound: flips the
 *    one global scroll-sync setting (`sync-scroll-toggle.ts`). It acts, and takes the key, only where the
 *    toggle is shown (FR-122a) — an editor whose preview affordance is not `absent` (so a switched-off
 *    provider still toggles), or a text preview. Anywhere else the key is left alone.
 */
import { useEffect, useRef } from 'react';
import {
  PREVIEW_KIND,
  collectPanels,
  effectiveActivePanelId,
  type Panel,
  type PreviewProviderRegistry,
  type PreviewSettings,
} from '@throng/core';
import { followFocusedPreviewLink } from './preview-panel-handles.js';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import { currentEditorPreviewAffordance } from '../editor/editor-preview.js';
import { getPreviewState } from './preview-store.js';
import { usePreviewProviders } from './provider-registry-context.js';
import { toggleSyncScroll } from './sync-scroll-toggle.js';
import { useProjects } from '../state/projects-store.js';
import { useWorkspace } from '../state/workspace-store.js';
import { resolveScoped } from '../keybindings/scope.js';
import { getActivePane } from '../workspace/active-pane.js';
import { getEditorState } from '../editor/editor-state.js';
import { listenForPreviewOpenChanged } from './preview-open-store.js';
import {
  handlePreviewFocus,
  handlePreviewPlace,
  openPreview,
  registerPreviewOpener,
  requestPreviewOpen,
  type PreviewPlacementWorkspace,
} from './open-preview.js';

/**
 * Whether `panel` shows the Synchronise Scrolling toggle (FR-122a), decided as its surfaces decide it: an
 * editor whose preview affordance is not `absent` — against the editor's OWN project root, none for a
 * sub-workspace-owned editor — or a preview whose provider draws text.
 */
function showsSyncToggle(panel: Panel, registry: PreviewProviderRegistry, settings: PreviewSettings): boolean {
  if (panel.kind === 'editor') {
    const editor = getEditorState(panel.id);
    if (!editor) return false;
    const affordance = currentEditorPreviewAffordance({
      registry,
      settings,
      filePath: editor.filePath,
      projectRoot: editor.ownerKind === 'subworkspace' ? null : editor.ownerRoot,
    });
    return affordance.state !== 'absent';
  }
  if (panel.kind === PREVIEW_KIND) {
    const state = getPreviewState(panel.id);
    const filePath = state?.filePath ?? (panel.config as { filePath?: string } | undefined)?.filePath;
    const provider = (state ? registry.get(state.providerId) : undefined) ?? (filePath ? registry.forPath(filePath) : undefined);
    return provider?.kind === 'text';
  }
  return false;
}

export function PreviewCommands(): null {
  const ws = useWorkspace();
  const { projects } = useProjects();
  const keybindings = useKeybindings();
  // Read through refs: the listeners below are installed once per window, and must act on the layout
  // and projects as they are when the message or the key arrives.
  const wsRef = useRef<PreviewPlacementWorkspace>(ws);
  wsRef.current = ws;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const settings = useAppSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const { registry } = usePreviewProviders();
  const registryRef = useRef(registry);
  registryRef.current = registry;

  // 1 — the command.
  useEffect(() => {
    registerPreviewOpener((intent) =>
      // A getter, not `wsRef.current`: main's answer arrives renders later, and the placement must read
      // the layout as it is then.
      openPreview({ ws: () => wsRef.current, bridge: window.throng?.preview, intent }).catch((error: unknown) => {
        // A bridge that threw is a broken bridge (failures are returned, never thrown, across it). The
        // affordance the user chose stays as it was; the cause goes to the console for diagnosis, and the
        // caller reads this exactly as a refusal — nothing opened (044 US4 fix round 1, item 5).
        console.error('[preview] open failed', error);
        return { kind: 'unavailable' } as const;
      }),
    );
    return () => registerPreviewOpener(null);
  }, []);

  // 3 and 4 — main's messages to this window.
  useEffect(() => {
    const bridge = window.throng?.preview;
    if (!bridge) return;
    const offPlace = bridge.onPlace((msg) => {
      handlePreviewPlace(wsRef.current, bridge, msg);
    });
    const offFocus = bridge.onFocus((msg) => {
      handlePreviewFocus(wsRef.current, msg);
    });
    const offOpenChanged = listenForPreviewOpenChanged(bridge);
    return () => {
      offPlace();
      offFocus();
      offOpenChanged();
    };
  }, []);

  // 2 — the chord, over the focused EDITOR.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // A key something closer to the focus already handled — a find bar, a picker, CodeMirror — is theirs.
      if (e.defaultPrevented) return;
      const layout = wsRef.current.layout;
      const action = resolveScoped(
        keybindings,
        { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
        { tabs: layout?.tabs, activeTabId: layout?.activeTabId ?? null },
      );
      // With Files & Folders active the tree's own handler owns the chord, for its selection.
      if (
        (action !== 'preview.open' && action !== 'preview.followLink' && action !== 'preview.toggleSyncScroll') ||
        !layout ||
        getActivePane() !== 'workspace'
      ) {
        return;
      }
      const tab = layout.tabs.find((t) => t.id === layout.activeTabId);
      const panelId = tab ? effectiveActivePanelId(tab) : undefined;
      const panel = tab && panelId ? (collectPanels(tab.root) as Panel[]).find((p) => p.id === panelId) : undefined;
      if (action === 'preview.toggleSyncScroll') {
        // 6 — FR-122d: only where a toggle is shown (FR-122a); otherwise the key stays with whoever wants it.
        if (!panel || !showsSyncToggle(panel, registryRef.current, settingsRef.current.editor.previews)) return;
        e.preventDefault();
        void toggleSyncScroll(settingsRef.current.editor.previews.syncScroll);
        return;
      }
      if (action === 'preview.followLink') {
        // 5 — FR-096c: Ctrl+click for the keyboard, on the link focused in the active preview. The key is
        // taken only when a link was followed, so Ctrl+Enter anywhere else in the preview is untouched.
        if (panel?.kind === PREVIEW_KIND && followFocusedPreviewLink(panel.id)) e.preventDefault();
        return;
      }
      if (panel?.kind !== 'editor') return;
      const filePath = getEditorState(panel.id)?.filePath;
      e.preventDefault();
      if (!filePath || !projectsRef.current.some((p) => p.id === panel.originProjectId)) return;
      void requestPreviewOpen({ absPath: filePath, projectId: panel.originProjectId, requesterPanelId: panel.id });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keybindings]);

  return null;
}
