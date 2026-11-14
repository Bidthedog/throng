import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, hostname, tmpdir, userInfo } from 'node:os';
import { createAnonymiser, logExpected, type Anonymiser } from '@throng/core';
import { reportOwnFailure } from './node-file-log.js';

/**
 * 068 FR-034a to FR-034f — what only Node can supply to the pure anonymiser in core: the keyed hash,
 * the per-install salt file, and the identity of the machine the process is running on.
 */

/**
 * The salt file's name, in the USER DATA folder — never the logs folder, which is what a user zips
 * into a bug report: with the salt, an 8-hex token of a short name can be reversed by guessing.
 */
export const ANON_SALT_FILE = 'anon-salt';

/** Where an earlier build kept it, inside the logs folder; found, moved out and removed on first run. */
export const LEGACY_ANON_SALT_FILE = '.anon-salt';

/** HMAC-SHA256, hex — injected into `createAnonymiser` so core imports no Node builtin. */
export function hmacHash(salt: string, value: string): string {
  return createHmac('sha256', salt).update(value).digest('hex');
}

/**
 * The install's salt: 32 random bytes, hex, created once in `saltDir` (the user data folder) and read
 * back by every later run. Creation is exclusive (`wx`), so two processes racing at first start agree
 * on one value. Where the folder cannot be written the salt is still returned, so tokens stay stable
 * for the process, just not across runs — a lost run-to-run correlation, never a leaked value.
 *
 * `legacyLogDir`: an earlier build kept the salt in the logs folder. It is moved to `saltDir` so
 * tokens stay stable, and no copy is left behind — also when the new file already exists.
 */
export function readOrCreateSalt(saltDir: string, legacyLogDir?: string): string {
  const path = join(saltDir, ANON_SALT_FILE);
  const legacy = legacyLogDir ? join(legacyLogDir, LEGACY_ANON_SALT_FILE) : undefined;
  let legacyValue: string | null = null;
  if (legacy && existsSync(legacy)) {
    try {
      legacyValue = readFileSync(legacy, 'utf8').trim() || null;
    } catch (error) {
      reportOwnFailure(`cannot read ${legacy}`, error);
    }
  }
  const dropLegacy = (): void => {
    if (!legacy || !existsSync(legacy)) return;
    try {
      rmSync(legacy, { force: true });
    } catch (error) {
      reportOwnFailure(`cannot remove ${legacy}`, error);
    }
  };
  const read = (): string | null => {
    // A first run has no salt file; that is not a failure to report.
    if (!existsSync(path)) return null;
    try {
      const value = readFileSync(path, 'utf8').trim();
      return value || null;
    } catch (error) {
      logExpected('machine-identity: read the salt file', 'an unreadable salt file is replaced by a fresh one, so tokens restart', error);
      return null;
    }
  };
  const existing = read();
  if (existing) {
    dropLegacy();
    return existing;
  }
  const fresh = legacyValue ?? randomBytes(32).toString('hex');
  try {
    mkdirSync(saltDir, { recursive: true });
    writeFileSync(path, fresh, { flag: 'wx', mode: 0o600 });
    dropLegacy();
    return fresh;
  } catch (error) {
    // Another process won the exclusive create (its salt is read back), or the folder is unwritable
    // (the salt then lives for this process only). Said on stderr: the log is not open yet.
    reportOwnFailure(`cannot create ${path}`, error);
    return read() ?? fresh;
  }
}

export interface MachineIdentityOptions {
  /** The folder the application is installed in; its relative file and line survive in a stack. */
  installDir?: string;
  /** The user data folder, where the process knows it. */
  userDataDir?: string;
  /** Further folders worth hiding, such as the config root. */
  extraDirs?: readonly string[];
}

/** Environment variables that name a folder under the user's profile. */
const FOLDER_ENV = [
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'TEMP', 'TMP', 'TMPDIR',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
] as const;

/** Register everything this machine and process knows about the person using it. */
export function registerMachineIdentity(anon: Anonymiser, options: MachineIdentityOptions = {}): void {
  const safely = (read: () => string | undefined, kind: Parameters<Anonymiser['register']>[0]): void => {
    try {
      const value = read();
      if (value) anon.register(kind, value);
    } catch (error) {
      logExpected('machine-identity: read the machine identity', 'an identity we cannot read is one the pattern pass can still catch', error);
    }
  };
  safely(() => homedir(), 'home');
  safely(() => userInfo().username, 'user');
  safely(() => hostname(), 'host');
  safely(() => tmpdir(), 'path');
  for (const name of FOLDER_ENV) safely(() => process.env[name], 'path');
  safely(() => process.env.USERNAME, 'user');
  safely(() => process.env.USER, 'user');
  safely(() => process.env.COMPUTERNAME, 'host');
  safely(() => options.userDataDir, 'userData');
  for (const dir of options.extraDirs ?? []) safely(() => dir, 'path');
  safely(() => options.installDir ?? dirname(process.execPath), 'install');
  safely(() => process.execPath, 'path');
}

export interface ProcessAnonymiserOptions extends MachineIdentityOptions {
  /** The logs folder; only consulted to move away a salt file an earlier build left in it. */
  logDir?: string;
  /**
   * The folder that keeps the salt file: the user data folder. Only UI main has it; the other
   * processes are handed the salt and have no folder of their own for it.
   */
  saltDir?: string;
  /** A salt handed down by the parent (`THRONG_LOG_SALT`, or the PTY agent's argv). */
  salt?: string;
}

/**
 * The anonymiser one process owns: the salt from its parent, else from the salt file in the user
 * data folder, else a random one for this process alone (tokens then differ from other processes'
 * but nothing is written, least of all into the logs folder). Machine identity registered. Every
 * composition root builds exactly one (Principle IX).
 */
export function createProcessAnonymiser(options: ProcessAnonymiserOptions): { anonymiser: Anonymiser; salt: string } {
  const salt =
    options.salt?.trim() ||
    (options.saltDir ? readOrCreateSalt(options.saltDir, options.logDir) : randomBytes(32).toString('hex'));
  const anonymiser = createAnonymiser({
    salt,
    os: process.platform === 'win32' ? 'windows' : 'linux',
    hash: hmacHash,
  });
  registerMachineIdentity(anonymiser, options);
  return { anonymiser, salt };
}
