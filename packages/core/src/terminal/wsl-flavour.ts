/**
 * "Is this flavour WSL?" — 045 FR-144, FR-151 (contracts/platform-ports.md §6.2).
 *
 * ONE answer serves both requirements, so they cannot disagree about which terminals are WSL: a WSL
 * terminal has no link base directory (FR-144 — a Linux `cd` never moves the Windows-side process
 * directory, so the cwd store holds only the stale launch directory), and its link requests skip Git's
 * mount table (FR-151).
 *
 * ══ WHY THIS IS HERE AND NOT IN `platform-windows` ══
 *
 * The question is asked by the RENDERER, at hover time, about a user-defined flavour it already holds
 * in settings — and the renderer has no route to `platform-windows`, nor a synchronous bridge to main.
 * It is a pure reading of an executable path, which is the same kind of shell fact this folder already
 * keeps (`flavourReportsDirectory` names `cmd`, `pwsh` and `git-bash`). The built-in shell
 * detection never offers WSL — it skips `System32\bash.exe` precisely so it is not mislabelled Git
 * Bash — so only a user-defined flavour can be WSL.
 *
 * Recognised: an executable named `wsl` / `wsl.exe` anywhere, and `bash` / `bash.exe` directly inside
 * a `System32` or `Sysnative` folder (WSL's legacy launcher). Any other `bash.exe` — Git's, MSYS2's,
 * Cygwin's — is not WSL.
 */
export function isWslExecutable(file: string | undefined): boolean {
  if (file === undefined) return false;
  const trimmed = file.trim().replace(/^"(.*)"$/, '$1');
  const parts = trimmed.split(/[\\/]+/).filter((p) => p.length > 0);
  const name = (parts[parts.length - 1] ?? '').toLowerCase();
  if (name === 'wsl' || name === 'wsl.exe') return true;
  if (name !== 'bash' && name !== 'bash.exe') return false;
  const parent = (parts[parts.length - 2] ?? '').toLowerCase();
  return parent === 'system32' || parent === 'sysnative';
}
