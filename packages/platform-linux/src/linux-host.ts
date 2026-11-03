import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { linuxHostTraits, type HostTraits, type IUserDirectories } from '@throng/core';

type Env = Readonly<Record<string, string | undefined>>;

const usable = (value: string | undefined): value is string => value !== undefined && value.startsWith('/');

/** A folder only its owner may use. Refuses one that is someone else's, or a symlink (062 FR-011, FR-013). */
export function ensureOwnerOnlyDir(dir: string, uid: number | undefined = process.getuid?.()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const info = lstatSync(dir);
  if (!info.isDirectory()) throw new Error(`"${dir}" is not a folder, so throng cannot keep its data there.`);
  if (uid !== undefined && info.uid !== uid) {
    throw new Error(`"${dir}" belongs to another user, so throng cannot use it. Remove it, then start throng again.`);
  }
  if ((info.mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

/** The owner-only folder sockets live in: the session's runtime directory, or a per-user one under the temp folder. */
export function ipcDirectory(env: Env = process.env, uid: number | undefined = process.getuid?.()): string {
  const runtime = env.XDG_RUNTIME_DIR;
  return usable(runtime) ? join(runtime, 'throng') : join(tmpdir(), `throng-${uid ?? 'user'}`);
}

/** This process's traits, with the socket folder ready. Called once, at the composition root. */
export function linuxTraitsForThisProcess(env: Env = process.env): HostTraits {
  const dir = ipcDirectory(env);
  ensureOwnerOnlyDir(dir);
  return linuxHostTraits(dir);
}

/** The XDG folders (062 FR-013). `-dev` keeps a source run apart from an installed build (FR-005). */
export class LinuxUserDirectories implements IUserDirectories {
  constructor(
    private readonly env: Env = process.env,
    private readonly home: () => string = homedir,
  ) {}

  configRoot(devMode: boolean): string {
    const base = usable(this.env.XDG_CONFIG_HOME) ? this.env.XDG_CONFIG_HOME : join(this.home(), '.config');
    return join(base, devMode ? 'throng-dev' : 'throng');
  }

  dataDir(devMode: boolean): string {
    const base = usable(this.env.XDG_DATA_HOME) ? this.env.XDG_DATA_HOME : join(this.home(), '.local', 'share');
    return join(base, devMode ? 'throng-dev' : 'throng');
  }

  prepare(dir: string): void {
    ensureOwnerOnlyDir(dir);
  }
}
