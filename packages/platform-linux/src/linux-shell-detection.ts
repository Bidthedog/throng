import { access, constants, readFile, realpath } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import type { DetectedShell, IShellDetection } from '@throng/core';

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

export interface LinuxShellDetectionDeps {
  readonly readShellsFile?: () => Promise<string>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The passwd entry's shell, used when `$SHELL` is unset. */
  readonly passwdShell?: () => string | undefined;
}

const isExecutable = (file: string): Promise<boolean> =>
  access(file, constants.X_OK).then(
    () => true,
    () => false,
  );

/**
 * The shells installed on this machine, the user's login shell first (062 FR-014).
 *
 * `/etc/shells` is the system's own list and `PATH` catches a shell installed outside it. A path is reported only if it
 * is executable now, and `/bin/bash` and `/usr/bin/bash` are one shell.
 */
export class LinuxShellDetection implements IShellDetection {
  private readonly readShellsFile: () => Promise<string>;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly passwdShell: () => string | undefined;

  constructor(deps: LinuxShellDetectionDeps = {}) {
    this.readShellsFile = deps.readShellsFile ?? (() => readFile('/etc/shells', 'utf8'));
    this.env = deps.env ?? process.env;
    this.passwdShell = deps.passwdShell ?? (() => userInfo().shell ?? undefined);
  }

  async detectInstalledShells(): Promise<DetectedShell[]> {
    const listed = await this.readShellsFile().catch(() => '');
    const candidates = listed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('/'));
    for (const dir of (this.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const known of KNOWN) for (const name of known.names) candidates.push(join(dir, name));
    }

    const login = this.env.SHELL || this.passwdShell();
    const byId = new Map<string, DetectedShell>();
    const realOf = new Map<string, string>();
    for (const file of candidates) {
      const known = KNOWN.find((k) => k.names.includes(basename(file)));
      if (!known || byId.has(known.id) || !(await isExecutable(file))) continue;
      const real = await realpath(file).catch(() => file);
      realOf.set(known.id, real);
      byId.set(known.id, { id: known.id, label: known.label, file, defaultArgs: [] });
    }

    const loginReal = login ? await realpath(login).catch(() => login) : undefined;
    const shells = [...byId.values()];
    const first = shells.find((s) => s.file === login || realOf.get(s.id) === loginReal);
    return first ? [first, ...shells.filter((s) => s !== first)] : shells;
  }
}
