import { access, constants, readFile, realpath } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, delimiter, join } from 'node:path/posix';
import process from 'node:process';
import { logCaught, logExpected, type DetectedShell, type IShellDetection } from '@throng/core';

/** Interactive shells throng knows, by file name. `/etc/shells` also lists `rbash`, `git-shell` and `tmux`. */
const KNOWN: readonly { readonly id: string; readonly label: string; readonly names: readonly string[] }[] = [
  { id: 'bash', label: 'Bash', names: ['bash'] },
  { id: 'zsh', label: 'Zsh', names: ['zsh'] },
  { id: 'fish', label: 'fish', names: ['fish'] },
  { id: 'sh', label: 'POSIX sh', names: ['sh'] },
  { id: 'dash', label: 'Dash', names: ['dash'] },
  { id: 'ksh', label: 'KornShell', names: ['ksh', 'ksh93', 'mksh'] },
  { id: 'tcsh', label: 'tcsh', names: ['tcsh', 'csh'] },
  { id: 'pwsh', label: 'PowerShell', names: ['pwsh'] },
  { id: 'nu', label: 'Nushell', names: ['nu'] },
];

/**
 * Where Homebrew puts shells on macOS: `/opt/homebrew/bin` on Apple silicon, `/usr/local/bin` on Intel and for
 * hand-built ones (070 R9). An app started from the Dock gets launchd's short `PATH`, which names neither, so a
 * `brew install fish` would otherwise go unseen until the user also listed it in `/etc/shells`.
 */
export const MACOS_SHELL_SEARCH_DIRS: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin'];

export interface PosixShellDetectionDeps {
  readonly readShellsFile?: () => Promise<string>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The passwd entry's shell, used when `$SHELL` is unset. */
  readonly passwdShell?: () => string | undefined;
  /** Folders searched after `PATH`, for shells a platform installs outside it. None by default. */
  readonly extraSearchDirs?: readonly string[];
}

const isExecutable = (file: string): Promise<boolean> =>
  access(file, constants.X_OK).then(
    () => true,
    () => false,
  );

/**
 * The shells installed on this machine, the user's login shell first (062 FR-014, 070 FR-017).
 *
 * `/etc/shells` is the system's own list and `PATH` catches a shell installed outside it. A path is reported only if it
 * is executable now, and `/bin/bash` and `/usr/bin/bash` are one shell.
 */
export class PosixShellDetection implements IShellDetection {
  private readonly readShellsFile: () => Promise<string>;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly passwdShell: () => string | undefined;
  private readonly extraSearchDirs: readonly string[];

  constructor(deps: PosixShellDetectionDeps = {}) {
    this.readShellsFile = deps.readShellsFile ?? (() => readFile('/etc/shells', 'utf8'));
    this.env = deps.env ?? process.env;
    this.passwdShell = deps.passwdShell ?? (() => userInfo().shell ?? undefined);
    this.extraSearchDirs = deps.extraSearchDirs ?? [];
  }

  /** `PATH`'s folders, then the platform's extra ones not already on it. */
  searchDirs(): string[] {
    const onPath = (this.env.PATH ?? '').split(delimiter).filter(Boolean);
    return [...onPath, ...this.extraSearchDirs.filter((dir) => !onPath.includes(dir))];
  }

  async detectInstalledShells(): Promise<DetectedShell[]> {
    const listed = await this.readShellsFile().catch((error: unknown) => {
      logExpected('posix-shell-detection: read /etc/shells', 'a minimal system may have no /etc/shells; PATH is searched instead', error);
      return '';
    });
    const login = this.env.SHELL || this.passwdShell();
    // The first file for a shell wins, so the login shell's own file goes first: after `chsh -s /opt/homebrew/bin/bash`
    // the user's bash is Homebrew's, though /etc/shells lists `/bin/bash` above it.
    const candidates = login?.startsWith('/') ? [login] : [];
    candidates.push(
      ...listed
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('/')),
    );
    for (const dir of this.searchDirs()) {
      for (const known of KNOWN) for (const name of known.names) candidates.push(join(dir, name));
    }

    const byId = new Map<string, DetectedShell>();
    const realOf = new Map<string, string>();
    for (const file of candidates) {
      const known = KNOWN.find((k) => k.names.includes(basename(file)));
      if (!known || byId.has(known.id) || !(await isExecutable(file))) continue;
      const real = await realpath(file).catch((error: unknown) => {
        logCaught('posix-shell-detection: resolve shell path', error);
        return file;
      });
      realOf.set(known.id, real);
      byId.set(known.id, { id: known.id, label: known.label, file, defaultArgs: [] });
    }

    const loginReal = login
      ? await realpath(login).catch((error: unknown) => {
          logExpected('posix-shell-detection: resolve login shell', '$SHELL may name a shell that is no longer installed', error);
          return login;
        })
      : undefined;
    const shells = [...byId.values()];
    const first = shells.find((s) => s.file === login || realOf.get(s.id) === loginReal);
    return first ? [first, ...shells.filter((s) => s !== first)] : shells;
  }
}
