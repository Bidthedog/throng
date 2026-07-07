/**
 * Editor IPC (006, contracts/editor-bridge.md). Registers the `throng:editor:*`
 * ipcMain channels backing the sandboxed renderer's `editor.*` preload bridge —
 * a peer of `files.*`, NOT daemon RPC. Thin adapters over the {@link
 * EditorCoordinator}; the renderer never touches the filesystem or the lock.
 */
import { ipcMain, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron';
import type { SaveAllScope } from '@throng/core';
import { senderWebContentsId } from './broadcast.js';
import type { EditorCoordinator, DocMeta } from './editor-coordinator.js';

function windowIdOf(event: IpcMainInvokeEvent | IpcMainEvent): string {
  return String(senderWebContentsId(event.sender) ?? 0);
}

function webContentsIdOf(event: IpcMainInvokeEvent | IpcMainEvent): number {
  return senderWebContentsId(event.sender) ?? 0;
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

  ipcMain.on('throng:editor:notifyDirty', (event, raw: Record<string, unknown>) => {
    void coordinator.notifyDirty(webContentsIdOf(event), {
      ...toMeta(event, raw),
      dirty: raw.dirty === true,
      text: typeof raw.text === 'string' ? raw.text : '',
    });
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

  ipcMain.handle('throng:editor:subWsFiles', () => coordinator.openSubWorkspaceEditorFiles());

  ipcMain.on('throng:editor:destroy', (_event, panelId: unknown) => {
    if (typeof panelId === 'string') coordinator.destroy(panelId);
  });

  ipcMain.on('throng:editor:notifySync', (event, raw: Record<string, unknown>) => {
    if (typeof raw.panelId !== 'string') return;
    coordinator.notifySync(webContentsIdOf(event), {
      panelId: raw.panelId,
      text: typeof raw.text === 'string' ? raw.text : undefined,
      dirty: typeof raw.dirty === 'boolean' ? raw.dirty : undefined,
    });
  });
}
