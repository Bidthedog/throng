/**
 * The renderer's host traits come whole from main through preload (070 FR-011, research R32), so a macOS renderer
 * gets macOS traits — case-insensitive paths with their case-sensitive volumes, Cmd bindings — not Windows ones.
 */
import { describe, expect, it } from 'vitest';
import { WINDOWS_HOST_TRAITS, linuxHostTraits, macosHostTraits } from '@throng/core';
import { hostTraitsFromPreload } from '../../src/renderer/host-traits-from-preload.js';

describe('hostTraitsFromPreload', () => {
  it('takes main’s traits whole, macOS included', () => {
    const mac = macosHostTraits('/var/folders/x/T/throng', ['/Volumes/Code']);
    expect(hostTraitsFromPreload(JSON.parse(JSON.stringify(mac)), 'macos')).toEqual(mac);
    const linux = linuxHostTraits('/run/user/1000/throng');
    expect(hostTraitsFromPreload(linux, 'linux')).toEqual(linux);
    expect(hostTraitsFromPreload(WINDOWS_HOST_TRAITS, 'windows')).toEqual(WINDOWS_HOST_TRAITS);
  });

  it('falls back to the OS family’s own traits when main sent nothing usable', () => {
    expect(hostTraitsFromPreload(undefined, 'macos').os).toBe('macos');
    expect(hostTraitsFromPreload({ os: 'macos' }, 'macos')).toEqual(macosHostTraits('', []));
    expect(hostTraitsFromPreload(undefined, 'linux')).toEqual(linuxHostTraits(''));
    expect(hostTraitsFromPreload(undefined, 'windows')).toEqual(WINDOWS_HOST_TRAITS);
    expect(hostTraitsFromPreload(undefined, undefined)).toEqual(WINDOWS_HOST_TRAITS);
  });
});
