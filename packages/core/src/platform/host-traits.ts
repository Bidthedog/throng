import type { OsName } from '../abstractions/platform-info.js';

/**
 * What the pure rules in core need to know about the platform they run on (062 contracts/host-traits.md).
 *
 * Module-level state, set once per process at its composition root, and the plan's recorded Principle IX
 * exception: `samePath`, `defaultPipeName` and the shipped bindings are pure functions read from reducers, renderer
 * state and module-level constants, so threading a parameter through each would rewrite Windows code paths for no
 * Windows benefit. Inferring the rule from a path's spelling is not an alternative: macOS is POSIX-rooted and
 * case-insensitive by default, so the spelling does not decide it (FR-049).
 *
 * The default is Windows, the values every existing caller and test was written against, so Windows behaviour cannot
 * change through this module (FR-009). Nothing in core branches on the operating system: it branches on these facts.
 */
export interface PathTraits {
  /** Do two spellings differing only in case name two files? */
  readonly caseSensitive: boolean;
  /** Is `\` a separator, rather than a character a filename may contain? */
  readonly backslashIsSeparator: boolean;
}

export type IpcTraits =
  | { readonly kind: 'pipe' }
  /** `dir` is the owner-only runtime directory the sockets live in. */
  | { readonly kind: 'socket'; readonly dir: string };

export interface HostTraits {
  readonly os: OsName;
  readonly paths: PathTraits;
  readonly ipc: IpcTraits;
}

export const WINDOWS_PATH_TRAITS: PathTraits = { caseSensitive: false, backslashIsSeparator: true };
export const LINUX_PATH_TRAITS: PathTraits = { caseSensitive: true, backslashIsSeparator: false };

export const WINDOWS_HOST_TRAITS: HostTraits = { os: 'windows', paths: WINDOWS_PATH_TRAITS, ipc: { kind: 'pipe' } };

export function linuxHostTraits(ipcDir: string): HostTraits {
  return { os: 'linux', paths: LINUX_PATH_TRAITS, ipc: { kind: 'socket', dir: ipcDir } };
}

let current: HostTraits = WINDOWS_HOST_TRAITS;

/** Set this process's traits. Called once, by its composition root, before anything reads them. */
export function configureHostTraits(traits: HostTraits): void {
  current = traits;
}

export function hostTraits(): HostTraits {
  return current;
}

/** A socket path past this is at risk of `sun_path`'s 108-byte limit on Linux, and is shortened. */
const MAX_SOCKET_ADDRESS_BYTES = 100;
const PIPE_PREFIX = /^\\\\[.?]\\pipe\\/i;

function fnv1a(text: string, seed: number): string {
  let h = seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The address to `listen` on or `connect` to for a logical endpoint name. Every call site goes through here, so a
 * name (`THRONG_PIPE_NAME` included) means the same thing on every platform and the socket's length does not depend
 * on how deep the checkout is (FR-011).
 */
export function resolveIpcAddress(name: string): string {
  const { ipc } = current;
  if (ipc.kind === 'pipe') return name;
  if (name.startsWith('/')) return name;
  const safe = name.replace(PIPE_PREFIX, '').replace(/[^A-Za-z0-9._-]/g, '_');
  const full = `${ipc.dir}/${safe}.sock`;
  if (byteLength(full) <= MAX_SOCKET_ADDRESS_BYTES) return full;
  return `${ipc.dir}/${fnv1a(name, 0x811c9dc5)}${fnv1a(name, 0x01000193)}.sock`;
}

/** The platform's word for where deleted files go (FR-025). */
export function trashTerm(os: OsName = current.os): string {
  return os === 'windows' ? 'Recycle Bin' : 'Trash';
}
