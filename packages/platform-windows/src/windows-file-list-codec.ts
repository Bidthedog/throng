import { logExpected, type FileListSnapshot, type IFileListCodec } from '@throng/core';

const URI_LIST = 'text/uri-list';
const DROP_EFFECT = 'electron application/osclipboard;format="Preferred DropEffect"';
const DROPEFFECT_MOVE = 2;
const DROPEFFECT_COPY_OR_LINK = 5;

/** Windows' file-list clipboard formats (067 research D1). Chromium turns `text/uri-list` into `CF_HDROP`. */
export class WindowsFileListCodec implements IFileListCodec {
  readonly formats = [URI_LIST, DROP_EFFECT];

  encode(list: FileListSnapshot): Record<string, string | Uint8Array> {
    const effect = new Uint8Array(4);
    new DataView(effect.buffer).setUint32(0, list.intent === 'cut' ? DROPEFFECT_MOVE : DROPEFFECT_COPY_OR_LINK, true);
    return { [URI_LIST]: list.paths.map((p) => `${pathToUri(p)}\r\n`).join(''), [DROP_EFFECT]: effect };
  }

  decode(payloads: Readonly<Record<string, Uint8Array>>): FileListSnapshot | null {
    const raw = payloads[URI_LIST];
    if (raw === undefined) return null;
    const paths = new TextDecoder()
      .decode(raw)
      .split(/\r?\n/)
      .flatMap((line) => uriToPath(line.trim()) ?? []);
    if (paths.length === 0) return null;
    const effect = payloads[DROP_EFFECT];
    const move =
      effect !== undefined &&
      effect.byteLength >= 4 &&
      (new DataView(effect.buffer, effect.byteOffset, 4).getUint32(0, true) & DROPEFFECT_MOVE) !== 0;
    return { paths, intent: move ? 'cut' : 'copy' };
  }
}

const encodeSegment = (segment: string): string => encodeURIComponent(segment);

function pathToUri(path: string): string {
  const unc = /^\\\\([^\\]+)\\(.*)$/.exec(path);
  if (unc) return `file://${unc[1]}/${unc[2]!.split('\\').map(encodeSegment).join('/')}`;
  const [drive, ...rest] = path.split('\\');
  return `file:///${drive}/${rest.map(encodeSegment).join('/')}`;
}

function uriToPath(uri: string): string | null {
  if (!uri.toLowerCase().startsWith('file:')) return null;
  const rest = uri.slice('file:'.length).replace(/^\/\//, '');
  try {
    const decoded = decodeURIComponent(rest);
    if (decoded.startsWith('/')) return decoded.slice(1).split('/').join('\\');
    return `\\\\${decoded.split('/').join('\\')}`;
  } catch (error) {
    logExpected('file-list codec: decode a URI', 'a malformed escape names no file, so the entry is dropped', error);
    return null;
  }
}
