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
  ipcMain.handle('throng:files:rename', (_event, relPath: unknown, newName: unknown) =>
    service.rename(asStr(relPath), asStr(newName)),
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
}
