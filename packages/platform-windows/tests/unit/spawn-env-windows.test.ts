import { describe, it, expect } from 'vitest';
import { dropInheritedModulePath } from '../../src/spawn-env-windows.js';

/**
 * #367 — a shell throng spawns must not inherit the LAUNCHER's PowerShell module path.
 *
 * PowerShell 7 exports its own `PSModulePath` to every process it starts, with its directories
 * FIRST. So throng launched from a `pwsh` session passes that down to the daemon and on to every
 * terminal — and a `powershell.exe` panel then resolves modules to PS7-only versions that Windows
 * PowerShell 5.1 cannot load:
 *
 *   Set-PSReadLineOption : found in the module 'PSReadLine', but the module could not be loaded.
 *       + FullyQualifiedErrorId : CouldNotAutoloadMatchingModule
 *
 * What the user sees is a shell with no history recall, no tab completion, no syntax colouring and
 * no multi-line editing — every feature PSReadLine provides, missing, with no error to explain it.
 *
 * Measured, one machine, same command under three environments:
 *
 *   WITH ps7 paths     FAILED
 *   WITHOUT ps7 paths  OK
 *   UNSET              OK
 *
 * REMOVING the variable is the fix rather than filtering it, and the difference matters because
 * throng spawns `pwsh` too. Filtering PS7's entries out would fix `powershell.exe` by breaking
 * `pwsh`. Removed, each shell reconstructs the module path it should have from the persisted
 * user and machine values — which is exactly the "same clean slate a bare OS shell has" that
 * `sanitizeSpawnEnv` already promises, extended to the one variable it did not know about.
 *
 * A denylist was tried first, in the CI workflow, and failed on the SECOND machine it met: it
 * matched `C:\Program Files\PowerShell\7\Modules` and not the winget/MSIX layout
 * `...\WindowsApps\Microsoft.PowerShell_7.6.5.0_x64__8wekyb3d8bbwe\Modules`. That is the argument
 * against pattern-matching install layouts at all.
 */
describe('dropInheritedModulePath', () => {
  it('removes PSModulePath so each shell computes its own', () => {
    const clean = dropInheritedModulePath({
      PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules',
      PATH: 'C:\\Windows',
    });
    expect(clean).toEqual({ PATH: 'C:\\Windows' });
  });

  it('removes it whatever the PS7 install layout, because it matches no layout at all', () => {
    const msix = dropInheritedModulePath({
      PSModulePath:
        'c:\\program files\\windowsapps\\microsoft.powershell_7.6.5.0_x64__8wekyb3d8bbwe\\Modules',
    });
    expect(msix).toEqual({});
  });

  it('is case-insensitive, because Windows environment names fold case', () => {
    const clean = dropInheritedModulePath({ psmodulepath: 'x', PATH: 'C:\\Windows' });
    expect(clean).toEqual({ PATH: 'C:\\Windows' });
  });

  it('leaves an environment that never had one untouched', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/x' };
    expect(dropInheritedModulePath(env)).toEqual(env);
  });

  it('does not mutate the caller’s environment', () => {
    const env = { PSModulePath: 'x', PATH: 'C:\\Windows' };
    dropInheritedModulePath(env);
    expect(env.PSModulePath).toBe('x');
  });
});
