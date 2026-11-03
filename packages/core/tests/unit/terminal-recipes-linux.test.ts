import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  flavourReportsDirectory,
  isValidCommandRecipe,
  resolveShellIntegration,
} from '../../src/terminal/command-recipe.js';
import { resolveShellHistorySuppression } from '../../src/terminal/shell-history.js';

const LINUX_SHELLS = ['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'nu'] as const;

describe('Linux shell flavours (062 FR-015, FR-016)', () => {
  it.each(LINUX_SHELLS)('%s can carry a startup command', (id) => {
    expect(isValidCommandRecipe(BUILTIN_FLAVOUR_COMMAND_RECIPES[id])).toBe(true);
  });

  it.each(LINUX_SHELLS)('%s needs no integration to report its directory: the OS knows it', (id) => {
    expect(resolveShellIntegration(id, true)).toBeUndefined();
    expect(flavourReportsDirectory(id, false)).toBe(true);
  });

  it.each(['bash', 'zsh', 'fish', 'sh', 'ksh'])('%s can be asked to keep no history', (id) => {
    expect(resolveShellHistorySuppression(id, true).env).toBeDefined();
  });

  it('asks a shell to keep history only when suppression is on', () => {
    expect(resolveShellHistorySuppression('bash', false)).toEqual({});
  });

  it('leaves the Windows recipes exactly as they were', () => {
    expect(BUILTIN_FLAVOUR_COMMAND_RECIPES.cmd).toEqual(['/K', '{command}']);
    expect(BUILTIN_FLAVOUR_COMMAND_RECIPES['git-bash']).toEqual(['-c', 'trap : INT; {command}; exec bash -i']);
  });
});
