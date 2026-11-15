import { describe, expect, it } from 'vitest';
import { WINDOWS_HOST_TRAITS, linuxHostTraits, macosHostTraits, samePath, type HostTraits } from '@throng/core';
import { withHostTraits } from '@throng/core/testing';
import { hostTraitsFromPreload } from '../../../ui/src/renderer/host-traits-from-preload.js';

/**
 * 070 FR-011, research R32: the renderer runs main's traits, whole, as preload hands them over. Electron's IPC carries
 * them by structured clone, so each platform's traits are cloned here exactly as `sendSync` would, and the renderer's
 * path rule must then agree with main's.
 */
const MAIN: readonly (readonly [string, HostTraits])[] = [
  ['Windows', WINDOWS_HOST_TRAITS],
  ['Linux', linuxHostTraits('/run/user/1000/throng')],
  ['macOS', macosHostTraits('/var/folders/ab/T/throng', ['/Volumes/Work'])],
];

describe('host traits from main to the renderer', () => {
  it.each(MAIN)('%s traits arrive whole', (_name, traits) => {
    expect(hostTraitsFromPreload(structuredClone(traits), traits.os)).toEqual(traits);
  });

  it('a macOS renderer keeps a case-sensitive volume case-sensitive and folds NFD to NFC, as main does', () => {
    const traits = MAIN[2]![1];
    const nfc = `caf${String.fromCharCode(0xe9)}`;
    const nfd = `cafe${String.fromCharCode(0x301)}`;
    const renderer = hostTraitsFromPreload(structuredClone(traits), 'macos');
    for (const t of [traits, renderer]) {
      withHostTraits(t, () => {
        expect(samePath('/Volumes/Work/A.md', '/Volumes/Work/a.md')).toBe(false);
        expect(samePath('/Users/dev/A.md', '/Users/dev/a.md')).toBe(true);
        expect(samePath(`/Users/dev/${nfd}`, `/Users/dev/${nfc}`)).toBe(true);
      });
    }
  });

  it('falls back to the OS family’s rules, never Windows’, when main sent nothing usable', () => {
    expect(hostTraitsFromPreload(undefined, 'macos').os).toBe('macos');
    expect(hostTraitsFromPreload({ os: 'macos' }, 'macos').paths.unicodeForm).toBe('NFC');
    expect(hostTraitsFromPreload(undefined, 'linux').os).toBe('linux');
    expect(hostTraitsFromPreload(undefined, undefined)).toEqual(WINDOWS_HOST_TRAITS);
  });
});
