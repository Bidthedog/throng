import { WINDOWS_HOST_TRAITS, linuxHostTraits, macosHostTraits, type HostTraits, type OsName } from '@throng/core';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Whether `v` has the shape main's `hostTraits()` sends: an OS name, path traits and IPC traits. */
function isHostTraits(v: unknown): v is HostTraits {
  if (!isRecord(v) || !isRecord(v.paths) || !isRecord(v.ipc)) return false;
  const os = v.os;
  return (
    (os === 'windows' || os === 'linux' || os === 'macos') &&
    typeof v.paths.caseSensitive === 'boolean' &&
    typeof v.paths.backslashIsSeparator === 'boolean' &&
    (v.ipc.kind === 'pipe' || (v.ipc.kind === 'socket' && typeof v.ipc.dir === 'string'))
  );
}

/**
 * The renderer's host traits (062 contracts/host-traits.md; 070 FR-011, research R32): main's own, whole, as preload
 * hands them over — so a macOS renderer compares paths with macOS's rules, case-sensitive volumes included, and reads
 * macOS's bindings. Only when main sent nothing usable does it fall back to the OS family's defaults. The renderer
 * opens no sockets, so a fallback names no socket folder.
 */
export function hostTraitsFromPreload(exposed: unknown, osName: OsName | undefined): HostTraits {
  if (isHostTraits(exposed)) return exposed;
  if (osName === 'macos') return macosHostTraits('', []);
  if (osName === 'linux') return linuxHostTraits('');
  return WINDOWS_HOST_TRAITS;
}
