/**
 * Every item's `public.file-url` on the general pasteboard, read through {@link objcRuntime} (070 FR-023, R7).
 *
 * Electron reads a raw type at the pasteboard level, which answers for the first item only. A copy of several files
 * puts one item per file, and on macOS 27 the pasteboard no longer adds `NSFilenamesPboardType` listing them all, so
 * without this a paste of several files from Finder would bring only the first.
 */
import { logCaught } from '@throng/core';
import { objcRuntime } from './objc-runtime.js';

const FILE_URL_TYPE = 'public.file-url';

/** The file URLs, item by item, in order; null where the pasteboard cannot be read. */
export function pasteboardFileUrls(): string[] | null {
  const rt = objcRuntime();
  if (!rt) return null;
  try {
    return rt.pooled(() => {
      const pasteboard = rt.sendId(rt.getClass('NSPasteboard'), rt.selector('generalPasteboard'));
      const items = rt.sendId(pasteboard, rt.selector('pasteboardItems'));
      if (!items) return [];
      const type = rt.string(FILE_URL_TYPE);
      const stringForType = rt.selector('stringForType:');
      const objectAtIndex = rt.selector('objectAtIndex:');
      const urls: string[] = [];
      const count = rt.sendLong(items, rt.selector('count'));
      for (let at = 0; at < count; at += 1) {
        const url = rt.text(rt.sendIdId(rt.sendIdIndex(items, objectAtIndex, at), stringForType, type));
        if (url) urls.push(url);
      }
      return urls;
    });
  } catch (error) {
    logCaught('pasteboard-file-urls: read the items', error);
    return null;
  }
}
