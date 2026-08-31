/**
 * files-ipc — wires the `files.*` preload bridge to the {@link FilesService}
 * (004, T014/T046, contracts/files-bridge.md). The renderer is sandboxed and
 * reaches the filesystem only through these channels; the service enforces
 * project-root confinement and returns `{ error }` envelopes (never throws).
 */
import { ipcMain } from 'electron';
import type { DeleteMode, FilesService } from './files-service.js';
import type { ExplorerWatcher } from './explorer-watcher.js';

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function registerFilesIpc(service: FilesService, watcher: ExplorerWatcher): void {
  // The renderer points the explorer at the active project's root folder (or
  // null when no project is open). Absolute path supplied by the renderer, which
  // already holds it from the projects store (research D1). The watcher follows
  // the same root so external changes push back to the renderer (US2).
  ipcMain.on('throng:files:setRoot', (_event, root: unknown) => {
    const abs = typeof root === 'string' && root.length > 0 ? root : null;
    service.setRoot(abs);
    watcher.setRoot(abs);
  });

  ipcMain.handle('throng:files:list', (_event, relDir: unknown) => service.list(asStr(relDir)));
  // The SENDING window is passed on so a named holder can say whether the panel is in a different
  // window from the one showing the notice (029, FR-013a). Rename is the only operation that names a
  // holder today, so it is the only one that needs it.
  ipcMain.handle('throng:files:rename', (event, relPath: unknown, newName: unknown) =>
    service.rename(asStr(relPath), asStr(newName), event.sender.id),
  );
  ipcMain.handle('throng:files:move', (_event, src: unknown, destDir: unknown) =>
    service.move(asStrArr(src), asStr(destDir)),
  );
  ipcMain.handle('throng:files:copy', (_event, src: unknown, destDir: unknown) =>
    service.copy(asStrArr(src), asStr(destDir)),
  );
  ipcMain.handle('throng:files:delete', (_event, paths: unknown, mode: unknown) =>
    service.delete(asStrArr(paths), (mode === 'permanent' ? 'permanent' : 'recycle') as DeleteMode),
  );
  ipcMain.handle('throng:files:newFolder', (_event, destDir: unknown) =>
    service.newFolder(asStr(destDir)),
  );
  ipcMain.handle('throng:files:newFile', (_event, destDir: unknown) =>
    service.newFile(asStr(destDir)),
  );
  ipcMain.handle('throng:files:reveal', (_event, relPath: unknown) =>
    service.reveal(asStr(relPath)),
  );
  // #273 — a Panel menu reveals its own file by ABSOLUTE path. The panel's file need not be under
  // the root this process last saw (a torn-out panel), and need not be under any root at all (a
  // rootless sub-workspace panel), so the open-document registry is what confines this, not a root.
  ipcMain.handle('throng:files:revealDocument', (_event, absPath: unknown) =>
    service.revealDocument(asStr(absPath)),
  );
  // 024 US3 (#85): does this path exist inside the project? The undo engine's world-check.
  ipcMain.handle('throng:files:exists', (_event, relPath: unknown) =>
    service.existsInProject(asStr(relPath)),
  );
  // 024 US3 (#85): undo of a delete — put a trashed item back at its original path.
  ipcMain.handle('throng:files:restore', (_event, relPath: unknown, deletedAt: unknown) =>
    service.restoreDeleted(asStr(relPath), typeof deletedAt === 'number' ? deletedAt : Date.now()),
  );
}
