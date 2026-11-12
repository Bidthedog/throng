import { describe, expect, it } from 'vitest';
import { runFileListCodecContract } from '@throng/core/testing';
import { WindowsFileListCodec } from '../../src/windows-file-list-codec.js';

const codec = new WindowsFileListCodec();
const EFFECT = 'electron application/osclipboard;format="Preferred DropEffect"';
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('WindowsFileListCodec (067 FR-002, FR-003)', () => {
  it('passes the shared contract', async () => {
    await expect(
      runFileListCodecContract('WindowsFileListCodec', codec, [
        'C:\\work\\a b.txt',
        'D:\\données\\世界',
        '\\\\server\\share\\c.txt',
      ]),
    ).resolves.toBeUndefined();
  });

  it('marks a cut as DROPEFFECT_MOVE and a copy as copy-or-link, little-endian', () => {
    const cut = codec.encode({ paths: ['C:\\a'], intent: 'cut' })[EFFECT] as Uint8Array;
    const copy = codec.encode({ paths: ['C:\\a'], intent: 'copy' })[EFFECT] as Uint8Array;
    expect(Array.from(cut)).toEqual([2, 0, 0, 0]);
    expect(Array.from(copy)).toEqual([5, 0, 0, 0]);
  });

  it('writes the drive path as a file URI', () => {
    expect(codec.encode({ paths: ['C:\\a b\\c.txt'], intent: 'copy' })['text/uri-list']).toBe('file:///C:/a%20b/c.txt\r\n');
  });

  it('reads a file list with no drop effect as a copy', () => {
    expect(codec.decode({ 'text/uri-list': bytes('file:///C:/a.txt\r\n') })).toEqual({ paths: ['C:\\a.txt'], intent: 'copy' });
  });

  it('ignores a URI that is not a file', () => {
    expect(codec.decode({ 'text/uri-list': bytes('https://example.com/\r\n') })).toBeNull();
  });
});
