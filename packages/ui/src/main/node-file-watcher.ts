/**
 * NodeFileWatcher — the UI-main concrete {@link IFileWatcher} (T029). Watches a
 * directory (recursively) for create/modify/delete and reports changes, debounced,
 * to drive config hot-reload (research D3). Uses node's `fs.watch` with
 * `{ recursive: true }` (supported on Windows, the first target) so no extra
 * dependency is needed; the OS detail stays behind the IFileWatcher abstraction
 * (Principle II).
 */
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { Disposable, IFileWatcher } from '@throng/core';

export class NodeFileWatcher implements IFileWatcher {
  constructor(private readonly debounceMs = 100) {}

  watch(dir: string, onChange: (path: string) => void): Disposable {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPath = dir;
    let watcher: FSWatcher | null = null;

    const fire = (): void => {
      timer = null;
      onChange(lastPath);
    };

    try {
      watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (filename) lastPath = join(dir, filename.toString());
        if (timer) clearTimeout(timer);
        timer = setTimeout(fire, this.debounceMs); // coalesce rapid successive writes
      });
      // fs.watch reports RUNTIME failures via an 'error' event, not the try/catch
      // (which only guards synchronous creation). Windows commonly emits EPERM/ENOENT
      // when a watched directory is renamed or removed underneath a recursive watch
      // (churning temp dirs, heavy load). With no listener Node re-throws it as an
      // uncaught exception that crashes the main process — so swallow it and degrade
      // to "no further events" instead.
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      // The directory may not exist yet; callers ensure it exists first. A failed
      // watch degrades to "no events" rather than crashing the app.
    }

    return {
      dispose: () => {
        if (timer) clearTimeout(timer);
        timer = null;
        watcher?.close();
        watcher = null;
      },
    };
  }
}
