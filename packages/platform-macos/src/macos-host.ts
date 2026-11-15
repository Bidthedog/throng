import { lstatSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path/posix';
import process from 'node:process';
import { logCaught, logExpected, macosHostTraits, type HostTraits } from '@throng/core';
import { ensureOwnerOnlyDir } from '@throng/platform-node';
import { PC_CASE_SENSITIVE, libSystem } from './libsystem.js';

type Env = Readonly<Record<string, string | undefined>>;

const absolute = (value: string | undefined): value is string => value !== undefined && value.startsWith('/');

/**
 * The owner-only folder sockets live in (070 FR-016, R4): `$TMPDIR/throng`. macOS gives each login its own `$TMPDIR`
 * under `/var/folders`, so the folder is per-user before the owner check runs, and its path is short whatever the
 * length of the home folder, which keeps every socket inside `sun_path`'s 104 bytes. Without a usable `$TMPDIR`, a
 * per-user folder under `/tmp`, as on Linux: a shared `/tmp/throng` would be refused for every user but the first.
 */
export function macosIpcDirectory(env: Env = process.env, uid: number | undefined = process.getuid?.()): string {
  const perUserTmp = join('/tmp', `throng-${uid ?? 'user'}`);
  if (!absolute(env.TMPDIR)) return perUserTmp;
  const dir = join(env.TMPDIR, 'throng');
  // A `$TMPDIR` so deep that even the hashed name (`/` + 16 hex + `.sock`) would not fit 100 bytes: a test harness's own
  // run folder, or a login with an unusual one. The short per-user folder keeps every socket bindable.
  return Buffer.byteLength(dir) + HASHED_SOCKET_NAME_BYTES > MAX_SOCKET_ADDRESS_BYTES ? perUserTmp : dir;
}

/** `resolveIpcAddress`'s cap and the length of its hashed fallback name, including the separating `/`. */
const MAX_SOCKET_ADDRESS_BYTES = 100;
const HASHED_SOCKET_NAME_BYTES = '/'.length + 16 + '.sock'.length;

/** How the case rule of a mounted volume is asked. Real: `pathconf(2)` through libSystem and the `/Volumes` listing. */
export interface VolumeCaseProbe {
  /** `pathconf(path, _PC_CASE_SENSITIVE)`: 1 case-sensitive, 0 not, -1 unknown. */
  pathconf(path: string): number;
  /** Mounted volumes under `/Volumes`, the boot volume's alias excluded. */
  volumes(): readonly string[];
}

/**
 * The volumes under `/Volumes` that are mount points. The boot volume appears there as a symlink to `/` (`Macintosh
 * HD`), and a plain folder someone made there is not a volume, so both are left out. Startup only, before anything
 * serves (051 FR-017's exception).
 */
export function mountedVolumes(dir = '/Volumes'): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    logExpected('macos-host: list /Volumes', 'a machine with no extra volumes may have no /Volumes folder', error);
    return [];
  }
  const parentDev = statSync(dir, { throwIfNoEntry: false })?.dev;
  return names
    .map((name) => join(dir, name))
    .filter((path) => {
      const link = lstatSync(path, { throwIfNoEntry: false });
      if (!link || link.isSymbolicLink() || !link.isDirectory()) return false;
      return link.dev !== parentDev;
    });
}

const realProbe: VolumeCaseProbe = {
  pathconf: (path) => {
    const lib = libSystem();
    return lib === null ? -1 : lib.pathconf(path, PC_CASE_SENSITIVE);
  },
  volumes: () => mountedVolumes(),
};

/**
 * `/` and each mounted volume that answers `_PC_CASE_SENSITIVE = 1` (070 FR-020). A volume that cannot be asked keeps
 * the default rule: case-insensitive, which is what a default APFS volume is.
 */
export function findCaseSensitiveRoots(probe: VolumeCaseProbe = realProbe): string[] {
  const roots: string[] = [];
  for (const root of ['/', ...probe.volumes()]) {
    let answer: number;
    try {
      answer = probe.pathconf(root);
    } catch (error) {
      logCaught(`macos-host: ask ${root} whether it is case-sensitive`, error);
      continue;
    }
    if (answer === 1) roots.push(root);
    else if (answer < 0) logCaught(`macos-host: ask ${root} whether it is case-sensitive`, new Error('pathconf gave -1'));
  }
  return roots;
}

/** This process's traits, with the socket folder ready. Called once, at the composition root. */
export function macosTraitsForThisProcess(env: Env = process.env, probe: VolumeCaseProbe = realProbe): HostTraits {
  const dir = macosIpcDirectory(env);
  ensureOwnerOnlyDir(dir);
  return macosHostTraits(dir, findCaseSensitiveRoots(probe));
}
