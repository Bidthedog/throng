import { describe, expect, it } from 'vitest';
import {
  LINUX_PATH_TRAITS,
  MACOS_PATH_TRAITS,
  WINDOWS_HOST_TRAITS,
  WINDOWS_PATH_TRAITS,
  hostTraits,
  linuxHostTraits,
  macosHostTraits,
  resolveIpcAddress,
  trashTerm,
} from '../../src/platform/host-traits.js';
import { withHostTraits } from '../../src/testing/with-host-traits.js';

describe('macOS host traits (070 data-model.md HostTraits, research R4)', () => {
  it('are case-insensitive, slash-only, NFC-compared and socket-based', () => {
    const traits = macosHostTraits('/var/folders/ab/T/throng', ['/Volumes/Work']);
    expect(traits).toEqual({
      os: 'macos',
      paths: {
        caseSensitive: false,
        backslashIsSeparator: false,
        caseSensitiveRoots: ['/Volumes/Work'],
        unicodeForm: 'NFC',
      },
      ipc: { kind: 'socket', dir: '/var/folders/ab/T/throng' },
    });
  });

  it('keep a copy of the roots, so a later change to the caller’s list cannot move them', () => {
    const roots = ['/Volumes/Work'];
    const traits = macosHostTraits('/tmp/throng', roots);
    roots.push('/Volumes/Other');
    expect(traits.paths.caseSensitiveRoots).toEqual(['/Volumes/Work']);
  });

  it('leave the Windows and Linux path traits without either new field, so their results cannot change (FR-039)', () => {
    for (const paths of [WINDOWS_PATH_TRAITS, LINUX_PATH_TRAITS, linuxHostTraits('/run/x').paths]) {
      expect(paths.caseSensitiveRoots).toBeUndefined();
      expect(paths.unicodeForm).toBeUndefined();
    }
    expect(MACOS_PATH_TRAITS.unicodeForm).toBe('NFC');
  });

  it('put a socket name under the IPC folder', () => {
    withHostTraits(macosHostTraits('/var/folders/ab/T/throng', []), () => {
      expect(resolveIpcAddress('\\\\.\\pipe\\throng.u.ab12.daemon')).toBe('/var/folders/ab/T/throng/throng.u.ab12.daemon.sock');
    });
  });

  it('call the bin the Trash', () => {
    expect(trashTerm('macos')).toBe('Trash');
  });
});

describe('withHostTraits by platform name', () => {
  it('runs under each platform’s standard test traits and restores the previous ones', () => {
    withHostTraits('macos', () => {
      expect(hostTraits().os).toBe('macos');
      expect(hostTraits().paths.unicodeForm).toBe('NFC');
      expect(hostTraits().ipc.kind).toBe('socket');
    });
    withHostTraits('linux', () => expect(hostTraits().paths).toEqual(LINUX_PATH_TRAITS));
    withHostTraits('windows', () => expect(hostTraits()).toEqual(WINDOWS_HOST_TRAITS));
    expect(hostTraits()).toEqual(WINDOWS_HOST_TRAITS);
  });
});
