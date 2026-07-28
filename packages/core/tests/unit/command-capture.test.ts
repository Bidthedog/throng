import { describe, it, expect } from 'vitest';
import {
  captureDecision,
  foregroundCommand,
  isCapturableCommand,
  MAX_CAPTURABLE_COMMAND_LENGTH,
  shouldNotifyCaptureOutcome,
  captureLogLine,
} from '@throng/core';
import type { ChildProcess } from '@throng/core';

const SHELL = 100;
const child = (over: Partial<ChildProcess> = {}): ChildProcess => ({
  pid: 200,
  ppid: SHELL,
  commandLine: 'npm run dev',
  startedAt: 1_000,
  ...over,
});

describe('foregroundCommand — which command had control (025 FR-022)', () => {
  it('returns null when the shell has no children (an idle prompt)', () => {
    expect(foregroundCommand(SHELL, [])).toBeNull();
  });

  it('returns the only direct child', () => {
    expect(foregroundCommand(SHELL, [child()])).toBe('npm run dev');
  });

  it('picks the MOST RECENTLY STARTED direct child when several run', () => {
    expect(
      foregroundCommand(SHELL, [
        child({ pid: 200, commandLine: 'npm run dev', startedAt: 1_000 }),
        child({ pid: 201, commandLine: 'ping -t bbc.co.uk', startedAt: 2_000 }),
      ]),
    ).toBe('ping -t bbc.co.uk');
  });

  it('ignores grandchildren — a command’s own helpers are not separate candidates (FR-022a)', () => {
    // node spawned by npm: newer than npm itself, but NOT a direct child of the shell.
    expect(
      foregroundCommand(SHELL, [
        child({ pid: 200, ppid: SHELL, commandLine: 'npm run dev', startedAt: 1_000 }),
        child({ pid: 300, ppid: 200, commandLine: 'node vite.js', startedAt: 5_000 }),
      ]),
    ).toBe('npm run dev');
  });

  it('treats a shell whose only live processes are grandchildren as idle (FR-022a)', () => {
    expect(foregroundCommand(SHELL, [child({ pid: 300, ppid: 999, startedAt: 5_000 })])).toBeNull();
  });

  it('skips a child whose command line could not be read', () => {
    expect(
      foregroundCommand(SHELL, [
        child({ pid: 200, commandLine: 'npm run dev', startedAt: 1_000 }),
        child({ pid: 201, commandLine: '', startedAt: 9_000 }),
      ]),
    ).toBe('npm run dev');
  });
});

describe('isCapturableCommand (025 FR-023)', () => {
  it('accepts an ordinary command', () => {
    expect(isCapturableCommand('ping -t bbc.co.uk')).toBe(true);
  });

  it('rejects empty and whitespace-only', () => {
    expect(isCapturableCommand('')).toBe(false);
    expect(isCapturableCommand('   ')).toBe(false);
  });

  it('rejects a multi-line command — it cannot round-trip through a single-line field', () => {
    expect(isCapturableCommand('npm run dev\nrm -rf /')).toBe(false);
  });

  it('rejects control characters and escape sequences', () => {
    expect(isCapturableCommand('npm run dev\u001b[31m')).toBe(false);
    expect(isCapturableCommand('a\u0000b')).toBe(false);
  });

  it('rejects an over-long command line', () => {
    expect(isCapturableCommand('x'.repeat(MAX_CAPTURABLE_COMMAND_LENGTH + 1))).toBe(false);
    expect(isCapturableCommand('x'.repeat(MAX_CAPTURABLE_COMMAND_LENGTH))).toBe(true);
  });
});

/**
 * The user's own worked examples, verbatim from the spec (US2 scenarios 1-6). If any of these
 * ever disagrees with the spec, the spec wins and this test is the thing that says so.
 */
describe('captureDecision — the six worked examples (025 US2)', () => {
  it('1. started with `npm run dev`, still running at kill -> stays `npm run dev`', () => {
    const d = captureDecision(true, 'npm run dev', 'npm run dev');
    expect(d.save).toBe(false); // already that value; nothing to write
    expect(d.reason).toBe('unchanged');
  });

  it('2. started empty, ran `npm run dev`, still running -> becomes `npm run dev`', () => {
    expect(captureDecision(true, '', 'npm run dev')).toEqual({
      save: true,
      reason: 'saved',
      value: 'npm run dev',
    });
  });

  it('3. started empty, ran then STOPPED `npm run dev` -> stays empty', () => {
    // Nothing running at the end, so there is no observation to promote.
    expect(captureDecision(true, '', null)).toEqual({ save: false, reason: 'nothing-running' });
  });

  it('4. started with `npm run dev`, stopped it -> stays `npm run dev` (never cleared)', () => {
    expect(captureDecision(true, 'npm run dev', null)).toEqual({
      save: false,
      reason: 'nothing-running',
    });
  });

  it('5. stopped `npm run dev`, started `ping -t bbc.co.uk` -> becomes the ping', () => {
    expect(captureDecision(true, 'npm run dev', 'ping -t bbc.co.uk')).toEqual({
      save: true,
      reason: 'saved',
      value: 'ping -t bbc.co.uk',
    });
  });

  it('6. memory OFF -> never updates, whatever is running', () => {
    expect(captureDecision(false, '', 'npm run dev')).toEqual({ save: false, reason: 'memory-off' });
    expect(captureDecision(false, 'npm run dev', 'ping -t bbc.co.uk')).toEqual({
      save: false,
      reason: 'memory-off',
    });
  });

  it('an uncapturable command leaves the saved value alone (FR-023)', () => {
    expect(captureDecision(true, 'npm run dev', 'a\nb')).toEqual({
      save: false,
      reason: 'not-capturable',
    });
  });

  it('trims before comparing, so whitespace alone never rewrites config', () => {
    expect(captureDecision(true, 'npm run dev', '  npm run dev  ').save).toBe(false);
  });
});

describe('observability of a capture (025 FR-026a/b/c)', () => {
  it('toasts ONLY when a running command was thrown away — the terminal never says that', () => {
    expect(shouldNotifyCaptureOutcome(captureDecision(true, 'x', 'a\nb'))).toBe(true);
  });

  it('never toasts the ordinary no-ops — that is designed behaviour, not an error', () => {
    expect(shouldNotifyCaptureOutcome(captureDecision(true, 'x', null))).toBe(false);
    expect(shouldNotifyCaptureOutcome(captureDecision(false, 'x', 'npm run dev'))).toBe(false);
    expect(shouldNotifyCaptureOutcome(captureDecision(true, 'x', 'x'))).toBe(false);
  });

  it('never toasts a success', () => {
    expect(shouldNotifyCaptureOutcome(captureDecision(true, '', 'npm run dev'))).toBe(false);
  });

  it('logs EVERY outcome, naming the rule that fired (FR-026a)', () => {
    expect(captureLogLine('p1', captureDecision(true, '', 'npm run dev'))).toContain('reason=saved');
    expect(captureLogLine('p1', captureDecision(true, '', null))).toContain('reason=nothing-running');
    expect(captureLogLine('p1', captureDecision(false, '', 'x'))).toContain('reason=memory-off');
    expect(captureLogLine('p1', captureDecision(true, '', 'npm run dev'))).toContain('panel=p1');
  });
});
