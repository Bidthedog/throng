/**
 * Windows-specific environment hygiene for spawned shells (#367).
 *
 * `sanitizeSpawnEnv` in `@throng/core` drops every `THRONG_*` key, so a spawned shell does not
 * inherit this instance's identity. This is the same idea for the one variable core must not know
 * about, because it names a Windows concept and core is platform-abstracted (Principle II).
 *
 * ── The problem ────────────────────────────────────────────────────────────────────────────────
 *
 * **PowerShell 7 exports its own `PSModulePath` to every process it spawns**, with its own
 * directories first. Start throng from a `pwsh` session and that reaches the daemon, and the daemon
 * hands it to every terminal it opens. A `powershell.exe` panel then resolves modules to PS7-only
 * versions that Windows PowerShell 5.1 cannot load:
 *
 *   Set-PSReadLineOption : found in the module 'PSReadLine', but the module could not be loaded.
 *       + FullyQualifiedErrorId : CouldNotAutoloadMatchingModule
 *
 * The user does not see that message. They see a shell where Up recalls nothing, Tab completes
 * nothing, and there is no syntax colouring or multi-line editing — PSReadLine simply absent, with
 * no error to explain it.
 *
 * ── Why REMOVE rather than filter ──────────────────────────────────────────────────────────────
 *
 * The obvious fix is to strip PS7's entries and keep the rest. It is wrong, because **throng spawns
 * `pwsh` too**: filtering PS7's directories out would repair `powershell.exe` by breaking every
 * PowerShell 7 terminal instead.
 *
 * Removing the variable repairs both. Each PowerShell reconstructs the module path it should have
 * from the persisted user and machine values, which is precisely what a shell opened from Explorer
 * gets — the "same clean slate a bare OS shell has" that `sanitizeSpawnEnv` already promises. A
 * user's own persisted `PSModulePath` survives, because that is read from the registry rather than
 * inherited from whatever launched throng.
 *
 * Measured, one machine, same command under three environments:
 *
 *   WITH ps7 paths     FAILED
 *   WITHOUT ps7 paths  OK
 *   UNSET              OK
 *
 * ── Why not pattern-match the install layout ───────────────────────────────────────────────────
 *
 * A denylist was tried first, in CI, and failed on the second machine it met. It matched
 * `C:\Program Files\PowerShell\7\Modules` and missed the winget/MSIX layout,
 * `...\WindowsApps\Microsoft.PowerShell_7.6.5.0_x64__8wekyb3d8bbwe\Modules`. Excluding a thing
 * means enumerating every form it takes now and later; removing it entirely needs no such list.
 */

/**
 * Return a copy of `env` with any inherited PowerShell module path removed.
 *
 * Case-insensitive: Windows environment variable names fold case, so a parent may pass
 * `PSModulePath`, `PSMODULEPATH` or `psmodulepath` and all three must go. Never mutates the input.
 */
export function dropInheritedModulePath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PSMODULEPATH') continue;
    clean[key] = env[key];
  }
  return clean;
}
