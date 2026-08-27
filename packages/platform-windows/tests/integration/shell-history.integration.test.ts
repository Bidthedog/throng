import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  resolveLaunchSpec,
  resolveShellHistorySuppression,
  resolveShellIntegration,
} from '@throng/core';

/**
 * #339 — a shell throng launches FOR A TEST must not write the developer's shell history.
 *
 * The E2E suite types real commands into real PowerShell sessions. PSReadLine persists every one
 * of them to a single per-user file shared with every PowerShell the developer runs by hand, and
 * caps it at `MaximumHistoryCount` (4096) — so a suite run does not merely add noise, it EVICTS
 * the developer's own commands. Measured on a working machine before the fix: 1,853 of 7,398
 * lines were E2E probes, and a shell launched by throng reported
 * `HistorySaveStyle: SaveIncrementally` against `…\PSReadLine\ConsoleHost_history.txt`.
 *
 * This is the hazard `MemoryClipboard` (016 FR-013a) fixed one seam out — the OS clipboard is one
 * global resource, and so is the history file.
 *
 * These spawn a REAL PowerShell rather than asserting on a string, because the claim is about the
 * shell's BEHAVIOUR, not throng's argv. A string assertion would pass just as happily against a
 * snippet that silently did nothing — and the first candidate fix, redirecting `APPDATA`, is
 * exactly such a snippet: PSReadLine resolves its path through the known-folder API, so the
 * environment variable has no effect at all. Only running the shell catches that.
 */

/** The suppression fields for a flavour, shaped for spreading into a launch flavour. */
function suppressionParts(id: string, enabled: boolean) {
  const suppression = resolveShellHistorySuppression(id, enabled);
  return { historySuppression: suppression.snippet, historySuppressionEnv: suppression.env };
}

/** The `windows-powershell` flavour as `terminal-ipc` assembles it. */
function powershellFlavour(historyOff: boolean): Parameters<typeof resolveLaunchSpec>[0] {
  return {
    id: 'windows-powershell',
    file: 'powershell.exe',
    args: ['-NoLogo'],
    commandRecipe: ['-NoExit', '-Command', '{command}'] as readonly string[],
    // Shell integration defaults to ON, so this is the shipped composition.
    shellIntegration: resolveShellIntegration('windows-powershell', true),
    ...suppressionParts('windows-powershell', historyOff),
  };
}

/**
 * Run the `-Command` payload throng builds, then ask the session what it will save.
 *
 * `-NoExit` is dropped so the process terminates — it governs whether the interactive REPL
 * follows, not what the script did to the session.
 */
function historySaveStyleOf(spec: ReturnType<typeof resolveLaunchSpec>): string {
  const at = spec.args.indexOf('-Command');
  expect(at, 'the launch spec carries no -Command payload to run').toBeGreaterThan(-1);
  const out = execFileSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `${spec.args[at + 1]}; (Get-PSReadLineOption).HistorySaveStyle`,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return out.trim().split(/\r?\n/).pop() ?? '';
}

describe('#339 a test-launched shell does not persist the developer history', () => {
  it('leaves PowerShell saving NOTHING to disk when suppression is on', () => {
    const spec = resolveLaunchSpec(powershellFlavour(true), '', 'C:/proj');
    expect(historySaveStyleOf(spec)).toBe('SaveNothing');
  });

  it('suppresses BEFORE anything else throng runs, so no statement of ours is recorded', () => {
    const spec = resolveLaunchSpec(powershellFlavour(true), '', 'C:/proj', 'npm run dev');
    const command = spec.args[spec.args.indexOf('-Command') + 1];
    // PSReadLine saves incrementally, so anything composed ahead of the suppression would already
    // be on the developer's disk by the time it took effect.
    expect(command.indexOf('SaveNothing')).toBeLessThan(command.indexOf('__throngPrior'));
    expect(command.indexOf('SaveNothing')).toBeLessThan(command.indexOf('npm run dev'));
  });

  it('points a bash-family shell at a throwaway history file', () => {
    const spec = resolveLaunchSpec(
      { id: 'git-bash', file: 'bash.exe', args: ['-i'], ...suppressionParts('git-bash', true) },
      '',
      'C:/proj',
    );
    expect(spec.env?.HISTFILE).toBe('/dev/null');
  });

  it('is OFF by default, so a REAL terminal still records the user history', () => {
    expect(resolveShellHistorySuppression('windows-powershell', false)).toEqual({});
    // A shipped shell keeps saving — the behaviour users rely on for recall and Ctrl+R.
    const spec = resolveLaunchSpec(powershellFlavour(false), '', 'C:/proj');
    expect(historySaveStyleOf(spec)).toBe('SaveIncrementally');
    expect(spec.env).toBeUndefined();
  });
});
