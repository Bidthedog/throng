import { describe, expect, it } from 'vitest';
import {
  LINUX_PATH_TRAITS,
  WINDOWS_HOST_TRAITS,
  hostTraits,
  linuxHostTraits,
  resolveIpcAddress,
  trashTerm,
} from '../../src/platform/host-traits.js';
import { withHostTraits } from '../../src/testing/with-host-traits.js';
import {
  isUnderPath,
  normaliseForCompare,
  pathCompareKey,
  remainderUnder,
  samePath,
} from '../../src/fs/path-id.js';

const linux = linuxHostTraits('/run/user/1000/throng');

describe('host traits (062 contracts/host-traits.md)', () => {
  it('are the Windows values until a process configures them', () => {
    expect(hostTraits()).toEqual(WINDOWS_HOST_TRAITS);
  });

  it('are visible while configured, and restored afterwards', () => {
    withHostTraits(linux, () => {
      expect(hostTraits().os).toBe('linux');
      expect(hostTraits().paths).toEqual(LINUX_PATH_TRAITS);
    });
    expect(hostTraits()).toEqual(WINDOWS_HOST_TRAITS);
  });
});

describe('resolveIpcAddress', () => {
  it('leaves every name alone on Windows', () => {
    expect(resolveIpcAddress('\\\\.\\pipe\\throng.u.ab12.daemon')).toBe('\\\\.\\pipe\\throng.u.ab12.daemon');
    expect(resolveIpcAddress('anything')).toBe('anything');
  });

  it('turns a pipe-form name into a socket in the runtime directory on Linux', () => {
    withHostTraits(linux, () => {
      expect(resolveIpcAddress('\\\\.\\pipe\\throng.u.ab12.daemon.dev')).toBe(
        '/run/user/1000/throng/throng.u.ab12.daemon.dev.sock',
      );
    });
  });

  it('keeps an absolute path on Linux', () => {
    withHostTraits(linux, () => {
      expect(resolveIpcAddress('/tmp/x/y.sock')).toBe('/tmp/x/y.sock');
    });
  });

  it('replaces characters a socket name should not carry', () => {
    withHostTraits(linux, () => {
      expect(resolveIpcAddress('a b/c:d')).toBe('/run/user/1000/throng/a_b_c_d.sock');
    });
  });

  it('never yields an address past the socket limit, and stays distinct when it has to shorten', () => {
    withHostTraits(linux, () => {
      const a = resolveIpcAddress(`throng.${'x'.repeat(300)}.a`);
      const b = resolveIpcAddress(`throng.${'x'.repeat(300)}.b`);
      expect(Buffer.byteLength(a)).toBeLessThanOrEqual(100);
      expect(a).not.toBe(b);
      expect(a.startsWith('/run/user/1000/throng/')).toBe(true);
      expect(a.endsWith('.sock')).toBe(true);
    });
  });
});

describe('trashTerm', () => {
  it("names the platform's bin", () => {
    expect(trashTerm('windows')).toBe('Recycle Bin');
    expect(trashTerm('linux')).toBe('Trash');
    expect(trashTerm('macos')).toBe('Trash');
  });

  it('defaults to the host', () => {
    expect(trashTerm()).toBe('Recycle Bin');
    withHostTraits(linux, () => expect(trashTerm()).toBe('Trash'));
  });
});

describe('path identity follows the host (FR-020, FR-021)', () => {
  it('Windows: case and separators fold, as they always have', () => {
    expect(samePath('C:\\P\\Note.txt', 'c:/p/note.txt')).toBe(true);
    expect(normaliseForCompare('C:\\P\\')).toBe('c:/p');
    expect(pathCompareKey('C:\\P\\Note.txt')).toBe('c:/p/note.txt');
    expect(isUnderPath('C:\\A\\b.txt', 'c:/a')).toBe(true);
  });

  it('Linux: two files differing only by case are two files', () => {
    withHostTraits(linux, () => {
      expect(samePath('/p/README.md', '/p/readme.md')).toBe(false);
      expect(samePath('/p/README.md', '/p/README.md')).toBe(true);
      expect(isUnderPath('/P/a.txt', '/p')).toBe(false);
      expect(pathCompareKey('/P/Note.txt')).toBe('/P/Note.txt');
    });
  });

  it('Linux: a backslash is a filename character, never a separator', () => {
    withHostTraits(linux, () => {
      expect(samePath('/p/a\\b', '/p/a/b')).toBe(false);
      expect(isUnderPath('/p/a\\b', '/p/a')).toBe(false);
      expect(remainderUnder('/p/a\\b/c.txt', '/p')).toBe('/a\\b/c.txt');
    });
  });

  it('Linux: a trailing separator still does not change identity', () => {
    withHostTraits(linux, () => expect(samePath('/p/x/', '/p/x')).toBe(true));
  });
});
