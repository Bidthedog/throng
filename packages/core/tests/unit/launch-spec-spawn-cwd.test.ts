import { describe, it, expect } from 'vitest';
import {
  BASH_ENTER_START_DIR,
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  START_DIR_ENV,
  resolveLaunchSpec,
  resolveShellIntegration,
  resolveShellIntegrationEnv,
} from '@throng/core';

/**
 * #387 — Git for Windows' `bin\bash.exe` launcher never leaves the directory it was spawned in, so a
 * git-bash terminal is spawned in the launcher's own install folder and enters its start directory
 * itself. The integration test (`shell-leaves-start-dir`) shows the folder becomes deletable; these
 * pin the shape of the spec that achieves it.
 */

const gitBash = (integration: boolean) => ({
  id: 'git-bash',
  file: 'C:\\Program Files\\Git\\bin\\bash.exe',
  args: [] as string[],
  commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES['git-bash'],
  shellIntegration: resolveShellIntegration('git-bash', integration),
  shellIntegrationEnv: resolveShellIntegrationEnv('git-bash', integration),
});

describe('a git-bash terminal is spawned where its launcher lives (#387)', () => {
  it('spawns in the install folder and hands the start directory over in the environment', () => {
    const spec = resolveLaunchSpec(gitBash(true), '-i -l', 'D:\\repo\\wt');
    expect(spec.cwd).toBe('D:\\repo\\wt');
    expect(spec.spawnCwd).toBe('C:\\Program Files\\Git\\bin');
    expect(spec.env?.[START_DIR_ENV]).toBe('D:\\repo\\wt');
    // FR-006: an empty Startup Command still adds nothing to the command line.
    expect(spec.args).toEqual(['-i', '-l']);
  });

  it('enters the start directory before a Startup Command runs', () => {
    const spec = resolveLaunchSpec(gitBash(true), '-i -l', 'D:\\repo\\wt', 'npm run dev');
    const script = spec.args[spec.args.indexOf('-c') + 1];
    expect(script.indexOf(BASH_ENTER_START_DIR)).toBeGreaterThanOrEqual(0);
    expect(script.indexOf(BASH_ENTER_START_DIR)).toBeLessThan(script.indexOf('npm run dev'));
  });

  it('spawns in the start directory as before when shell integration is off — nothing could move it', () => {
    const spec = resolveLaunchSpec(gitBash(false), '-i -l', 'D:\\repo\\wt', 'npm run dev');
    expect(spec.spawnCwd).toBeUndefined();
    expect(spec.env?.[START_DIR_ENV]).toBeUndefined();
    expect(spec.args.join(' ')).not.toContain(START_DIR_ENV);
  });

  it('leaves every other flavour spawned in its start directory', () => {
    for (const id of ['windows-powershell', 'pwsh', 'cmd']) {
      const spec = resolveLaunchSpec(
        {
          id,
          file: `C:\\shells\\${id}.exe`,
          args: [],
          commandRecipe: BUILTIN_FLAVOUR_COMMAND_RECIPES[id],
          shellIntegration: resolveShellIntegration(id, true),
          shellIntegrationEnv: resolveShellIntegrationEnv(id, true),
        },
        '',
        'D:\\repo\\wt',
      );
      expect(spec.spawnCwd, id).toBeUndefined();
    }
  });
});
