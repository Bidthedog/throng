/**
 * Editor IPC (006, contracts/editor-bridge.md). Registers the `throng:editor:*`
 * ipcMain channels backing the sandboxed renderer's `editor.*` preload bridge —
 * a peer of `files.*`, NOT daemon RPC. Thin adapters over the {@link
 * EditorCoordinator}; the renderer never touches the filesystem or the lock.
 */
import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import type { SaveAllScope, SerialisedHistory } from '@throng/core';
import { senderWebContentsId } from './broadcast.js';
import type { EditorCoordinator, DocMeta } from './editor-coordinator.js';

function windowIdOf(event: IpcMainInvokeEvent | IpcMainEvent): string {
  return String(senderWebContentsId(event.sender) ?? 0);
}

/** Build a DocMeta from a renderer payload, stamping the sender's window id. */
function toMeta(event: IpcMainInvokeEvent | IpcMainEvent, raw: Record<string, unknown>): DocMeta {
  return {
    panelId: String(raw.panelId),
    windowId: windowIdOf(event),
    ownerKind: raw.ownerKind === 'subworkspace' ? 'subworkspace' : 'project',
    ownerProjectId: typeof raw.ownerProjectId === 'string' ? raw.ownerProjectId : undefined,
    ownerRoot: typeof raw.ownerRoot === 'string' ? raw.ownerRoot : null,
    allProjectRoots: Array.isArray(raw.allProjectRoots)
      ? raw.allProjectRoots.filter((r): r is string => typeof r === 'string')
      : [],
    tabId: typeof raw.tabId === 'string' ? raw.tabId : null,
    absPath: typeof raw.absPath === 'string' ? raw.absPath : null,
    encoding: 'utf8',
    hasBom: raw.hasBom === true,
    lineEnding: raw.lineEnding === 'crlf' ? 'crlf' : raw.lineEnding === 'cr' ? 'cr' : 'lf',
  };
}

export function registerEditorIpc(coordinator: EditorCoordinator): void {
  ipcMain.handle('throng:editor:load', (event, raw: Record<string, unknown>) => {
    const meta = toMeta(event, raw);
    if (!meta.absPath) return { ok: false, reason: 'io', error: 'No path to load.' };
    return coordinator.load({
      panelId: meta.panelId,
      windowId: meta.windowId,
      ownerKind: meta.ownerKind,
      ownerProjectId: meta.ownerProjectId,
      ownerRoot: meta.ownerRoot,
      allProjectRoots: meta.allProjectRoots,
      tabId: meta.tabId,
      absPath: meta.absPath,
    });
  });

  ipcMain.on('throng:editor:register', (event, raw: Record<string, unknown>) => {
    const text = typeof raw.text === 'string' ? raw.text : '';
    coordinator.register(toMeta(event, raw), text);
  });

  /**
   * A view dispatches an edit it has ALREADY shown its user (016, FR-028f).
   *
   * The metadata rides along because it is mutable — projects come and go, a Save-As
   * re-points the file — and the authority's owner must not act on a stale copy of it.
   * It replaces 006's `notifyDirty`, which pushed the WHOLE DOCUMENT on every keystroke.
   */
  ipcMain.on('throng:editor:dispatch', (event, raw: Record<string, unknown>) => {
    if (typeof raw.panelId !== 'string' || typeof raw.viewId !== 'string') return;
    if (typeof raw.baseVersion !== 'number') return;
    coordinator.dispatchChange(toMeta(event, raw), {
      documentId: raw.panelId,
      viewId: raw.viewId,
      changes: raw.changes,
      baseVersion: raw.baseVersion,
      selectionBefore: raw.selectionBefore ?? null,
      mergeClass:
        raw.mergeClass === 'type' || raw.mergeClass === 'delete' ? raw.mergeClass : null,
    });
  });

  // Undo/redo are performed by the AUTHORITY, not the view: the stack belongs to the
  // document, so an Undo pressed in one mirrored view must revert an edit made in the
  // other (FR-026c). A view-local history could never do that.
  ipcMain.on('throng:editor:undo', (_event, raw: Record<string, unknown>) => {
    if (typeof raw.panelId !== 'string' || typeof raw.viewId !== 'string') return;
    coordinator.undo(raw.panelId, raw.viewId);
  });

  ipcMain.on('throng:editor:redo', (_event, raw: Record<string, unknown>) => {
    if (typeof raw.panelId !== 'string' || typeof raw.viewId !== 'string') return;
    coordinator.redo(raw.panelId, raw.viewId);
  });

  ipcMain.handle('throng:editor:revert', (_event, panelId: unknown) =>
    typeof panelId === 'string' ? coordinator.revert(panelId) : false,
  );

  ipcMain.handle('throng:editor:resync', (_event, panelId: unknown) =>
    typeof panelId === 'string' ? coordinator.resync(panelId) : null,
  );

  // Crash-recovered content goes into the AUTHORITY, not into the view that found it (FR-102) —
  // and so does its undo history, so the past the user is restored to is the one they had when the
  // app died, not an empty one (FR-027a).
  ipcMain.handle('throng:editor:restoreRecovered', (_event, raw: Record<string, unknown>) => {
    if (typeof raw.panelId !== 'string' || typeof raw.text !== 'string') return;
    coordinator.restoreRecovered(
      raw.panelId,
      raw.text,
      (raw.history as SerialisedHistory | undefined) ?? undefined,
    );
  });

  ipcMain.handle('throng:editor:save', (_event, raw: Record<string, unknown>) =>
    coordinator.save({
      panelId: String(raw.panelId),
      absPath: typeof raw.absPath === 'string' ? raw.absPath : undefined,
      lineEnding:
        raw.lineEnding === 'crlf' ? 'crlf' : raw.lineEnding === 'cr' ? 'cr' : raw.lineEnding === 'lf' ? 'lf' : undefined,
      ownerKind: raw.ownerKind === 'subworkspace' ? 'subworkspace' : raw.ownerKind === 'project' ? 'project' : undefined,
      ownerRoot: typeof raw.ownerRoot === 'string' ? raw.ownerRoot : raw.ownerRoot === null ? null : undefined,
      allProjectRoots: Array.isArray(raw.allProjectRoots)
        ? raw.allProjectRoots.filter((r): r is string => typeof r === 'string')
        : undefined,
    }),
  );

  ipcMain.handle('throng:editor:saveAll', (_event, raw: Record<string, unknown>) => {
    const scope: SaveAllScope =
      raw.scope === 'tab' || raw.scope === 'all' ? raw.scope : 'project';
    return coordinator.saveAll(scope, {
      activeTabId: typeof raw.activeTabId === 'string' ? raw.activeTabId : null,
      activeProjectId: typeof raw.activeProjectId === 'string' ? raw.activeProjectId : null,
    });
  });

  ipcMain.handle('throng:editor:openInto', (_event, raw: Record<string, unknown>) => {
    const absPath = String(raw.absPath);
    const decision = coordinator.openInto(absPath);
    if (decision.action === 'focus') coordinator.focusExisting(decision.windowId, decision.panelId);
    return decision;
  });

  ipcMain.handle('throng:editor:isOpen', (_event, absPath: unknown) =>
    coordinator.isOpen(String(absPath)),
  );

  ipcMain.handle('throng:editor:getContent', (_event, panelId: unknown) =>
    coordinator.getContent(String(panelId)),
  );

  ipcMain.handle('throng:editor:list', () => coordinator.list());

  ipcMain.handle('throng:editor:recover', () => coordinator.recover());

  // One panel's snapshot. A view has no business holding the deleted text of documents it is not
  // showing (016, FR-027b).
  ipcMain.handle('throng:editor:recoverOne', (_event, panelId: unknown) =>
    typeof panelId === 'string' ? coordinator.recoverOne(panelId) : null,
  );

  ipcMain.handle('throng:editor:subWsFiles', () => coordinator.openSubWorkspaceEditorFiles());

  ipcMain.on('throng:editor:destroy', (_event, panelId: unknown) => {
    if (typeof panelId === 'string') coordinator.destroy(panelId);
  });
}
