import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { logExpected, type Disposable, type IFileWatcher, type WatchBatch, type WatchOptions } from '@throng/core';

/**
 * The watcher `TerminalReconnect` arms its path-availability watches with (039 FR-030): ONE directory, its direct
 * entries only.
 *
 * ══ WHY NOT THE SHARED PROJECT WATCHER ══
 *
 * That watcher is recursive, and on Linux a recursive watch is a synchronous walk of the whole tree with one inotify
 * watch per directory (`directory-tree-watch.ts`, #585). What the reconnect watches is the nearest EXISTING ancestor of
 * a folder that has gone — for a missing project root that is wherever the path stops resolving: the home directory, a
 * mount point, `/`. Main walked all of it on its own event loop: about 90 s frozen on a cold hosted runner, 1.4 s on a
 * workstation, and every inotify watch the user had left (`terminal-reconnect-watch-cost.integration.test.ts`).
 *
 * The reconnect never needed the tree. It needs to hear that an entry appeared in the ancestor, which inotify reports
 * on the ancestor's own watch, and it re-targets itself when an intermediate folder is what appeared
 * (`TerminalReconnect`). So one watch, whatever the ancestor holds.
 */
export function reconnectWatcher(): IFileWatcher {
  return {
    watch(dir: string, onChange: (path: string, batch?: WatchBatch) => void, options?: WatchOptions): Disposable {
      let closed = false;
      let scheduled = false;
      const names = new Set<string>();
      const watcher: FSWatcher = watch(dir, { persistent: false }, (_event, name) => {
        if (closed) return;
        if (name !== null && name !== undefined) names.add(join(dir, name.toString()));
        if (scheduled) return;
        // One report per turn of the loop: a folder renamed back arrives as a burst, and the reconnect re-checks its
        // targets per report.
        scheduled = true;
        setImmediate(() => {
          scheduled = false;
          if (closed) return;
          const paths = [...names];
          names.clear();
          onChange(paths[0] ?? dir, { paths, complete: paths.length > 0 });
        });
      });
      watcher.on('error', (error: NodeJS.ErrnoException) => {
        if (closed) return;
        closed = true;
        watcher.close();
        logExpected('reconnect-watcher: watch', 'the watched folder can itself be removed; ↻ Retry stays the route back', error);
        options?.onFailed?.(error.code ?? error.message);
      });
      return {
        dispose: () => {
          if (closed) return;
          closed = true;
          watcher.close();
        },
      };
    },
  };
}
