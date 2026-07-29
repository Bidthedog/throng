import { describe, it, expect } from 'vitest';
import { BUILTIN_FLAVOUR_COMMAND_RECIPES, expandCommandRecipe } from '@throng/core';

/**
 * 025 FR-005 — interrupting the Startup Command must leave the shell at a live prompt.
 *
 * Reported from real use: pressing Ctrl+C to stop a `ping -t` in a Git Bash terminal killed the
 * terminal instead of returning to the prompt. A non-interactive `bash -c` script treats SIGINT
 * as fatal, so it died before ever reaching the `exec bash -i` that was supposed to leave an
 * interactive shell behind. Measured across all four built-in shells: cmd's `/K`, and
 * PowerShell's and pwsh's `-NoExit`, already survive it — only bash did not.
 *
 * The trap must be a HANDLER, not an ignore. `trap '' INT` would be inherited by the startup
 * command itself and make it un-interruptible, trading one broken Ctrl+C for another.
 */
describe('interrupting a Startup Command (025 FR-005)', () => {
  it("installs a no-op INT handler in git-bash's recipe, so SIGINT is not fatal", () => {
    const recipe = BUILTIN_FLAVOUR_COMMAND_RECIPES['git-bash'];
    const line = expandCommandRecipe(recipe, 'ping -t 127.0.0.1').join(' ');
    expect(line).toContain('trap : INT');
    // An IGNORED signal is inherited by children; a handler is not. This is the difference
    // between 'Ctrl+C stops the ping' and 'Ctrl+C does nothing at all'.
    expect(line).not.toContain("trap '' INT");
    expect(line).not.toContain(['trap ', '"', '"', ' INT'].join(''));
  });

  it('still runs the command and still leaves an interactive shell behind', () => {
    const recipe = BUILTIN_FLAVOUR_COMMAND_RECIPES['git-bash'];
    const line = expandCommandRecipe(recipe, 'ping -t 127.0.0.1').join(' ');
    expect(line).toContain('ping -t 127.0.0.1');
    expect(line).toContain('exec bash -i');
    // Order matters: the trap has to be in place BEFORE the command it protects.
    expect(line.indexOf('trap : INT')).toBeLessThan(line.indexOf('ping'));
  });

  it('leaves the shells that already survive SIGINT alone', () => {
    // cmd and both PowerShells return to their prompt on Ctrl+C unaided. Adding anything here
    // would be a change with no defect behind it.
    for (const id of ['cmd', 'windows-powershell', 'pwsh']) {
      const line = expandCommandRecipe(BUILTIN_FLAVOUR_COMMAND_RECIPES[id], 'ping -t').join(' ');
      expect(line, `${id} gained an interrupt workaround it never needed`).not.toContain('trap');
    }
  });
});
