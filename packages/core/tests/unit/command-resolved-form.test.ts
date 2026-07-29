import { describe, it, expect } from 'vitest';
import { captureDecision, isResolvedForm, normaliseCommand } from '@throng/core';

/**
 * 025 FR-017 — a command is not 'new' just because the OS spelled it differently.
 *
 * Reported from real use, and the worst kind of defect: the feature broke the thing it was
 * supposed to preserve. A user typed `ping -t bbc.co.uk` into the Startup Command box; the shell
 * resolved it to its image before spawning, so the observation read
 * `C:\\WINDOWS\\system32\\PING.EXE -t bbc.co.uk`; memory saw a different string and replaced what the
 * user had written. In Git Bash the replacement did not even run — bash strips the backslashes
 * out of an unquoted Windows path, giving `bash: C:WINDOWSsystem32ping.exe: command not found`.
 * The terminal broke itself by remembering.
 */

const PING = 'C:\\WINDOWS\\system32\\PING.EXE';

describe('a resolved executable path is the same command (025 FR-017)', () => {
  it('recognises the resolved form of what the user typed', () => {
    expect(isResolvedForm(PING + ' -t bbc.co.uk', 'ping -t bbc.co.uk')).toBe(true);
  });

  it('does NOT overwrite what the user typed with it', () => {
    const d = captureDecision(true, 'ping -t bbc.co.uk', PING + ' -t bbc.co.uk');
    expect(d.save).toBe(false);
    expect(d.reason).toBe('unchanged');
  });

  it('still treats a genuinely different command as a change', () => {
    expect(isResolvedForm(PING + ' -t google.com', 'ping -t bbc.co.uk')).toBe(false);
    expect(isResolvedForm('claude agents', 'ping -t bbc.co.uk')).toBe(false);
    expect(captureDecision(true, 'ping -t bbc.co.uk', 'claude agents').save).toBe(true);
  });

  it('matches on the bare name, so .EXE and case are not differences', () => {
    expect(isResolvedForm(PING, 'PING')).toBe(true);
    expect(isResolvedForm(PING, 'ping.exe')).toBe(true);
  });
});

describe('a captured path must be replayable by any shell', () => {
  it('quotes a Windows path, which is what makes it run in bash', () => {
    // Measured: bare fails with 'command not found'; quoted runs in bash, cmd and both
    // PowerShells alike.
    expect(normaliseCommand(PING + ' -t bbc.co.uk')).toBe('"' + PING + '" -t bbc.co.uk');
  });

  it('leaves a plain command alone, and does not double-quote an already-quoted one', () => {
    expect(normaliseCommand('npm  run   dev')).toBe('npm run dev');
    expect(normaliseCommand('"' + PING + '" -t x')).toBe('"' + PING + '" -t x');
  });
});
