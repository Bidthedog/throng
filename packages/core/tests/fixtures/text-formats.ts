/**
 * Byte-exact text-format fixtures (059 T001, SC-001–SC-003).
 *
 * Built in code rather than committed as files: a binary fixture in the repo is invisible to review
 * and to `git diff`, and every one of these is short enough to state as the bytes it is.
 */

const utf8 = new TextEncoder();

export function concat(...parts: (Uint8Array | readonly number[] | string)[]): Uint8Array {
  const chunks = parts.map((p) =>
    typeof p === 'string' ? utf8.encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** UTF-16 code units of `s`, written in the given byte order. */
export function utf16(s: string, order: 'le' | 'be'): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    out[i * 2] = order === 'le' ? u & 0xff : u >> 8;
    out[i * 2 + 1] = order === 'le' ? u >> 8 : u & 0xff;
  }
  return out;
}

export const BOM_UTF8 = [0xef, 0xbb, 0xbf] as const;
export const BOM_UTF16LE = [0xff, 0xfe] as const;
export const BOM_UTF16BE = [0xfe, 0xff] as const;

/** The text the UTF-16 fixtures carry: ASCII, Latin-1, a Greek letter and CRLF endings. */
export const SAMPLE = 'héllo wörld\r\nσ line two\r\n';

/** `café £5 €` then CRLF, in Windows-1252 — `é` 0xE9, `£` 0xA3, `€` 0x80. No NUL anywhere. */
export const CP1252_SAMPLE = Uint8Array.from([
  0x63, 0x61, 0x66, 0xe9, 0x20, 0xa3, 0x35, 0x20, 0x80, 0x0d, 0x0a,
]);
export const CP1252_SAMPLE_TEXT = 'café £5 €\n';

/** Every byte value 0x01–0xFF, then a line break: the FR-013 round trip. No NUL, so not binary. */
export const CP1252_ALL_BYTES = (() => {
  const out = new Uint8Array(256);
  for (let i = 1; i < 256; i++) out[i - 1] = i;
  out[255] = 0x0a;
  return out;
})();

export const TEXT_FIXTURES = {
  utf8: { bytes: concat(SAMPLE), encoding: 'utf8', hasBom: false },
  utf8Bom: { bytes: concat(BOM_UTF8, SAMPLE), encoding: 'utf8', hasBom: true },
  utf16leBom: { bytes: concat(BOM_UTF16LE, utf16(SAMPLE, 'le')), encoding: 'utf16le', hasBom: true },
  utf16beBom: { bytes: concat(BOM_UTF16BE, utf16(SAMPLE, 'be')), encoding: 'utf16be', hasBom: true },
  utf16leNoBom: { bytes: utf16(SAMPLE, 'le'), encoding: 'utf16le', hasBom: false },
  utf16beNoBom: { bytes: utf16(SAMPLE, 'be'), encoding: 'utf16be', hasBom: false },
  cp1252: { bytes: CP1252_SAMPLE, encoding: 'windows1252', hasBom: false },
  cp1252AllBytes: { bytes: CP1252_ALL_BYTES, encoding: 'windows1252', hasBom: false },
  /** PowerShell 5.1 `"héllo" > f.txt`: UTF-16 LE, BOM, CRLF. */
  powershell: {
    bytes: concat(BOM_UTF16LE, utf16('héllo\r\n', 'le')),
    encoding: 'utf16le',
    hasBom: true,
  },
} as const;

export const UTF32LE = Uint8Array.from([0xff, 0xfe, 0x00, 0x00, 0x68, 0x00, 0x00, 0x00]);
export const UTF32BE = Uint8Array.from([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x68]);

/**
 * Real-world binary headers, padded with the kind of content that follows them. Each must be
 * classified binary, never UTF-16 text (SC-003).
 */
export const BINARY_FIXTURES: Record<string, Uint8Array> = {
  png: concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52],
    [0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0x06, 0x00, 0x00, 0x00, 0x5c, 0x72, 0xa8],
  ),
  exe: concat(
    [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00],
    [0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  ),
  zip: concat(
    [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x21, 0x5b, 0x34, 0x59, 0x00, 0x00],
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x61, 0x2e],
  ),
  javaClass: concat(
    [0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41, 0x00, 0x1d, 0x0a, 0x00, 0x02, 0x00, 0x03, 0x07],
    [0x00, 0x04, 0x0c, 0x00, 0x05, 0x00, 0x06, 0x01, 0x00, 0x10, 0x6a, 0x61, 0x76, 0x61, 0x2f, 0x6c],
  ),
  /** Little-endian 32-bit integers 0..63 — zeros on BOTH sides of every pair. */
  int32Table: (() => {
    const out = new Uint8Array(256);
    for (let i = 0; i < 64; i++) out[i * 4] = i;
    return out;
  })(),
};
