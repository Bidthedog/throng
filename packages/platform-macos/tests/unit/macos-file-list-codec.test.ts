import { describe, expect, it } from 'vitest';
import { runFileListCodecContract } from '@throng/core/testing';
import { MacosFileListCodec } from '../../src/macos-file-list-codec.js';

const FILENAMES = 'electron application/osclipboard;format="NSFilenamesPboardType"';
const FILE_URL = 'electron application/osclipboard;format="public.file-url"';
const text = (value: string | Uint8Array | undefined): string => (typeof value === 'string' ? value : new TextDecoder().decode(value));
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('MacosFileListCodec (070 FR-023, research R7)', () => {
  const codec = new MacosFileListCodec();

  it('passes the shared file-list codec contract', async () => {
    await runFileListCodecContract('MacosFileListCodec', codec, ['/Users/dev/My Project/a.txt', '/Users/dev/café/b & c.md', '/Volumes/Work/d']);
  });

  it('writes the paths as Finder’s NSFilenamesPboardType plist, escaped', () => {
    const plist = text(codec.encode({ paths: ['/Users/dev/a&b.txt', '/Users/dev/<c>'], intent: 'copy' })[FILENAMES]);
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain('<string>/Users/dev/a&amp;b.txt</string>');
    expect(plist).toContain('<string>/Users/dev/&lt;c&gt;</string>');
  });

  it('writes the first file as a public.file-url', () => {
    expect(text(codec.encode({ paths: ['/Users/dev/My File.txt', '/x'], intent: 'copy' })[FILE_URL])).toBe('file:///Users/dev/My%20File.txt');
  });

  it('reads a list Finder copied, which carries only the plist', () => {
    const finder = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
	<string>/Users/dev/one.txt</string>
	<string>/Users/dev/t&amp;wo.txt</string>
</array>
</plist>`;
    expect(codec.decode({ [FILENAMES]: bytes(finder) })).toEqual({ paths: ['/Users/dev/one.txt', '/Users/dev/t&wo.txt'], intent: 'copy' });
  });

  it('reads a single file URL when there is no plist', () => {
    expect(codec.decode({ [FILE_URL]: bytes('file:///Users/dev/caf%C3%A9.txt') })).toEqual({ paths: ['/Users/dev/café.txt'], intent: 'copy' });
  });

  it('reads every item’s file when the copy carries no plist, as macOS 27 writes one (070)', () => {
    const items = () => ['file:///Users/dev/a.txt', 'file:///Users/dev/b%20c.txt'];
    expect(new MacosFileListCodec(items).decode({ [FILE_URL]: bytes('file:///Users/dev/a.txt') })).toEqual({
      paths: ['/Users/dev/a.txt', '/Users/dev/b c.txt'],
      intent: 'copy',
    });
  });

  it('keeps to the payload’s one file when the pasteboard no longer starts with it, or cannot be read', () => {
    const payload = { [FILE_URL]: bytes('file:///Users/dev/a.txt') };
    expect(new MacosFileListCodec(() => ['file:///Users/dev/other.txt', 'file:///Users/dev/b.txt']).decode(payload)?.paths).toEqual(['/Users/dev/a.txt']);
    expect(new MacosFileListCodec(() => null).decode(payload)?.paths).toEqual(['/Users/dev/a.txt']);
  });

  it('ignores a URL that names no local file', () => {
    expect(codec.decode({ [FILE_URL]: bytes('https://example.com/x') })).toBeNull();
  });
});
