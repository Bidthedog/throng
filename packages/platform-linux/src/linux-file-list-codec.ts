import { logExpected, type FileListSnapshot, type IFileListCodec } from '@throng/core';

const URI_LIST = 'text/uri-list';
const raw = (format: string): string => `electron application/osclipboard;format="${format}"`;
const GNOME = raw('x-special/gnome-copied-files');
const KDE_CUT = raw('application/x-kde-cutselection');

/** Linux file managers' clipboard formats (067 research D1): GNOME Files and Nemo share one, Dolphin adds a marker. */
export class LinuxFileListCodec implements IFileListCodec {
  readonly formats = [URI_LIST, GNOME, KDE_CUT];

  encode(list: FileListSnapshot): Record<string, string | Uint8Array> {
    const uris = list.paths.map(pathToUri);
    const out: Record<string, string> = {
      [URI_LIST]: uris.map((u) => `${u}\r\n`).join(''),
      [GNOME]: [list.intent, ...uris].join('\n'),
    };
    if (list.intent === 'cut') out[KDE_CUT] = '1';
    return out;
  }

  decode(payloads: Readonly<Record<string, Uint8Array>>): FileListSnapshot | null {
    const text = (format: string): string | null => {
      const bytes = payloads[format];
      return bytes === undefined ? null : new TextDecoder().decode(bytes);
    };
    const gnome = text(GNOME);
    if (gnome !== null) {
      const [verb, ...lines] = gnome.split(/\r?\n/);
      const paths = lines.flatMap((line) => uriToPath(line.trim()) ?? []);
      if (paths.length > 0) return { paths, intent: verb === 'cut' ? 'cut' : 'copy' };
    }
    const list = text(URI_LIST);
    if (list === null) return null;
    const paths = list.split(/\r?\n/).flatMap((line) => uriToPath(line.trim()) ?? []);
    if (paths.length === 0) return null;
    return { paths, intent: text(KDE_CUT)?.trim() === '1' ? 'cut' : 'copy' };
  }
}

function pathToUri(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

function uriToPath(uri: string): string | null {
  // A local file only: `file:///x`, or `file://localhost/x` as some managers write it.
  const match = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(uri);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch (error) {
    logExpected('file-list codec: decode a URI', 'a malformed escape names no file, so the entry is dropped', error);
    return null;
  }
}
