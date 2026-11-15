import { logExpected, type FileListSnapshot, type IFileListCodec } from '@throng/core';
import { pasteboardFileUrls } from './pasteboard-file-urls.js';
import { escapeXml, unescapeXml } from './xml-text.js';

const raw = (type: string): string => `electron application/osclipboard;format="${type}"`;
/** Finder's own file list: an XML property list of absolute paths (070 R7). */
const FILENAMES = raw('NSFilenamesPboardType');
/** The modern single-file type, which every Cocoa app reads. Carries the first file. */
const FILE_URL = raw('public.file-url');
/**
 * throng's own marker that the list was cut. Finder has no cut for files (it moves on paste with Option held), so only
 * throng reads it; anyone else pastes a copy, which loses nothing.
 */
const CUT = raw('com.throng.throng.cut');

function plistOf(paths: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<array>',
    ...paths.map((p) => `\t<string>${escapeXml(p)}</string>`),
    '</array>',
    '</plist>',
    '',
  ].join('\n');
}

/** The `<string>` entries of a plist's top-level array that are absolute paths. */
function pathsOfPlist(xml: string): string[] {
  const array = /<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? '';
  return [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1]!)).filter((p) => p.startsWith('/'));
}

function pathToUri(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

function uriToPath(uri: string): string | null {
  const match = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(uri.trim());
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch (error) {
    logExpected('file-list codec: decode a URI', 'a malformed escape names no file, so the entry is dropped', error);
    return null;
  }
}

/** macOS's file-list pasteboard types (067 FR-013, 070 FR-023, R7): Finder's plist plus `public.file-url`. */
export class MacosFileListCodec implements IFileListCodec {
  readonly formats = [FILENAMES, FILE_URL, CUT];

  /**
   * @param itemFileUrls every pasteboard item's file URL, in order, for a copy that carries no Finder list (macOS 27
   *   adds none); the real pasteboard on macOS, nothing elsewhere.
   */
  constructor(
    private readonly itemFileUrls: () => string[] | null = process.platform === 'darwin' ? pasteboardFileUrls : () => null,
  ) {}

  encode(list: FileListSnapshot): Record<string, string | Uint8Array> {
    const out: Record<string, string> = { [FILENAMES]: plistOf(list.paths) };
    const first = list.paths[0];
    if (first !== undefined) out[FILE_URL] = pathToUri(first);
    if (list.intent === 'cut') out[CUT] = '1';
    return out;
  }

  decode(payloads: Readonly<Record<string, Uint8Array>>): FileListSnapshot | null {
    const text = (format: string): string | null => {
      const bytes = payloads[format];
      return bytes === undefined ? null : new TextDecoder().decode(bytes);
    };
    const intent = text(CUT)?.trim() === '1' ? 'cut' : 'copy';
    const plist = text(FILENAMES);
    const listed = plist === null ? [] : pathsOfPlist(plist);
    if (listed.length > 0) return { paths: listed, intent };
    const url = text(FILE_URL);
    const single = url === null ? null : uriToPath(url);
    if (single === null) return null;
    // The payload is the first item's. The rest are read from the pasteboard, and trusted only when they begin with the
    // same file: a pasteboard that changed since the payload was read is not this copy.
    const items = (this.itemFileUrls() ?? []).map(uriToPath).filter((p): p is string => p !== null);
    return { paths: items[0] === single ? items : [single], intent };
  }
}
