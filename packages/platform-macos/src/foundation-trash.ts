/**
 * `NSFileManager trashItemAtURL:resultingItemURL:error:`, called in process through {@link objcRuntime} (070 R6).
 * Electron's `shell.trashItem` makes the same call and drops the resulting URL, which is the one fact a restore needs:
 * Finder renames an item that collides with one already in the Trash.
 *
 * It replaced a JXA script run by `osascript`, whose ObjC bridge was killed by SIGSEGV on the hosted macOS runners,
 * sometimes after moving the item and sometimes before, under Electron and plain Node alike.
 */
import { objcRuntime, type ObjcRuntime } from './objc-runtime.js';

/** Where the Trash put one item, or the system's reason it did not. */
export type TrashAnswer = { ok: true; path: string } | { ok: false; code: number; message: string };

export interface FoundationTrash {
  /** Synchronous: within a volume the Trash is a rename. */
  trashItem(path: string): TrashAnswer;
}

let bound: FoundationTrash | null | undefined;

function bind(rt: ObjcRuntime): FoundationTrash {
  const fileManager = rt.getClass('NSFileManager');
  const nsUrl = rt.getClass('NSURL');
  if (!fileManager || !nsUrl) throw new Error('Foundation did not register NSFileManager and NSURL');
  const sel = {
    defaultManager: rt.selector('defaultManager'),
    fileURLWithPath: rt.selector('fileURLWithPath:'),
    trash: rt.selector('trashItemAtURL:resultingItemURL:error:'),
    path: rt.selector('path'),
    code: rt.selector('code'),
    localizedDescription: rt.selector('localizedDescription'),
  };
  return {
    trashItem: (path) =>
      rt.pooled((): TrashAnswer => {
        const manager = rt.sendId(fileManager, sel.defaultManager);
        const url = rt.sendIdId(nsUrl, sel.fileURLWithPath, rt.string(path));
        const into: unknown[] = [null];
        const error: unknown[] = [null];
        if (rt.sendTrash(manager, sel.trash, url, into, error) && into[0]) return { ok: true, path: rt.text(rt.sendId(into[0], sel.path)) };
        const cause = error[0];
        return cause
          ? { ok: false, code: rt.sendLong(cause, sel.code), message: rt.text(rt.sendId(cause, sel.localizedDescription)) }
          : { ok: false, code: -1, message: 'macOS gave no reason' };
      }),
  };
}

/** The Trash call, bound once. Null where the runtime cannot be loaded, which {@link objcRuntime} logs. */
export function foundationTrash(): FoundationTrash | null {
  if (bound !== undefined) return bound;
  const rt = objcRuntime();
  bound = rt ? bind(rt) : null;
  return bound;
}
