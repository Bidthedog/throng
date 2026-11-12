import { describe, expect, it } from 'vitest';
import { runFileListCodecContract } from '@throng/core/testing';
import { LinuxFileListCodec } from '../../src/linux-file-list-codec.js';

const codec = new LinuxFileListCodec();
const GNOME = 'electron application/osclipboard;format="x-special/gnome-copied-files"';
const KDE = 'electron application/osclipboard;format="application/x-kde-cutselection"';
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('LinuxFileListCodec (067 FR-002, FR-003)', () => {
  it('passes the shared contract', async () => {
    await expect(
      runFileListCodecContract('LinuxFileListCodec', codec, ['/home/u/a b.txt', '/srv/données/世界']),
    ).resolves.toBeUndefined();
  });

  it('writes the GNOME list with its verb, and the KDE marker only for a cut', () => {
    const cut = codec.encode({ paths: ['/a b', '/c'], intent: 'cut' });
    expect(cut[GNOME]).toBe('cut\nfile:///a%20b\nfile:///c');
    expect(cut[KDE]).toBe('1');
    const copy = codec.encode({ paths: ['/a'], intent: 'copy' });
    expect(copy[GNOME]).toBe('copy\nfile:///a');
    expect(copy[KDE]).toBeUndefined();
  });

  it('reads a GNOME cut', () => {
    expect(codec.decode({ [GNOME]: bytes('cut\nfile:///a\nfile:///b%20c') })).toEqual({ paths: ['/a', '/b c'], intent: 'cut' });
  });

  it('reads a KDE cut from the URI list and the marker', () => {
    expect(codec.decode({ 'text/uri-list': bytes('file:///a\r\n'), [KDE]: bytes('1') })).toEqual({ paths: ['/a'], intent: 'cut' });
  });

  it('reads a plain URI list as a copy', () => {
    expect(codec.decode({ 'text/uri-list': bytes('file:///a\r\n') })).toEqual({ paths: ['/a'], intent: 'copy' });
  });

  it('ignores URIs that are not local files', () => {
    expect(codec.decode({ 'text/uri-list': bytes('https://example.com/\r\n') })).toBeNull();
  });
});
