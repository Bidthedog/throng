import { describe, it, expect } from 'vitest';
import { foregroundCommand } from '@throng/core';
import type { ChildProcess } from '@throng/core';

/**
 * Issue #280 — a terminal can remember a command from an unrelated process.
 *
 * Caught by `terminal-startup-command.e2e.ts:216` during a `npm run gate` run: a **cmd.exe**
 * terminal with the startup command `echo PREFILL_MARKER` pre-filled instead with
 *
 *   "E:\tools\Git\usr\bin\bash.exe" "/c/Program Files/nodejs/npm" --prefix D:\git\throng\... run gate
 *
 * — the command line of the gate process that launched the test run. A `bash.exe`, captured by a
 * terminal whose shell was `cmd.exe`. The two are unrelated processes.
 *
 * WHY IT IS RARE, AND WHY THAT IS THE DIAGNOSIS RATHER THAN A DETAIL. It surfaced once in ~250
 * parallel-tier tests and a targeted re-run did not reproduce it. The shape of the test is what
 * makes it possible at all: the spec EXITS the terminal before asserting the pre-fill, so the
 * shell's pid is released — and Windows recycles pids briskly on a loaded machine, while leaving
 * a dead parent's `ParentProcessId` stale on any process that outlives it. A long-running
 * process whose real parent has gone therefore ends up advertising a `ppid` that now names the
 * terminal's freed shell pid, and the capture walk has no way to tell that apart from a genuine
 * child.
 *
 * The discriminator is start time, and it is decisive: a process that started BEFORE the shell
 * did cannot be a child of that shell. The gate's `bash.exe` is the ancestor of the whole test
 * run — it predates the terminal by minutes.
 *
 * The repo already solved this exact problem next door. `findOrphans`
 * (`packages/daemon/src/reap-orphans.ts:47`) treats a parent that started AFTER its supposed
 * child as a pid-reuse impostor:
 *
 *   const parentGone = !parent || parent.createdMs > p.createdMs;
 *
 * `foregroundCommand` needs the same test and does not have it. It filters candidates on
 * `ppid === effectiveShell` alone (`command-capture.ts:53`) and never asks whether the candidate
 * could plausibly be the shell's child at all.
 */
describe('foregroundCommand — a pid-reuse impostor is not the terminal’s command (#280)', () => {
  /** When the terminal's shell was spawned. Everything it runs starts after this. */
  const SHELL_STARTED_AT = 5_000_000;
  const SHELL_PID = 4242;

  /** The gate's bash — started long before the terminal existed, now advertising a stale ppid
   *  that happens to name the shell's recycled pid. */
  const GATE_BASH: ChildProcess = {
    pid: 9001,
    ppid: SHELL_PID,
    commandLine:
      '"E:\\tools\\Git\\usr\\bin\\bash.exe" "/c/Program Files/nodejs/npm" --prefix D:\\git\\throng run gate',
    startedAt: SHELL_STARTED_AT - 600_000, // ten minutes before the shell was spawned
  };

  it('does not capture a process that started before the shell did', () => {
    // The reported case exactly: nothing was running in the terminal, and the only candidate
    // the OS offers is an impostor that predates the shell. Nothing qualifies, so the panel's
    // saved command must be left alone (FR-017) — which `foregroundCommand` signals with null.
    expect(foregroundCommand(SHELL_PID, [GATE_BASH], 'cmd.exe', SHELL_STARTED_AT)).toBeNull();
  });

  it('still captures a genuine child, which necessarily started after the shell', () => {
    // The guard must not cost the feature its actual job: a real command run in the terminal
    // starts after the shell and is captured exactly as before.
    const real: ChildProcess = {
      pid: 9002,
      ppid: SHELL_PID,
      commandLine: 'echo PREFILL_MARKER',
      startedAt: SHELL_STARTED_AT + 30_000,
    };
    expect(foregroundCommand(SHELL_PID, [real], 'cmd.exe', SHELL_STARTED_AT)).toBe(
      'echo PREFILL_MARKER',
    );
  });

  it('prefers the genuine child over an impostor that started earlier but sorts later', () => {
    // Both advertise the shell as their parent. Without the guard the impostor is a live
    // candidate and only start-time ordering keeps it out — which is luck, not a rule. Here the
    // impostor is the more recently *observed* row, so ordering alone would not save us.
    const real: ChildProcess = {
      pid: 9002,
      ppid: SHELL_PID,
      commandLine: 'echo PREFILL_MARKER',
      startedAt: SHELL_STARTED_AT + 30_000,
    };
    expect(foregroundCommand(SHELL_PID, [real, GATE_BASH], 'cmd.exe', SHELL_STARTED_AT)).toBe(
      'echo PREFILL_MARKER',
    );
  });

  it('captures as before when the shell’s start time is unknown', () => {
    // The parameter is optional so every existing caller and test keeps its meaning: with no
    // start time there is nothing to compare against and the old behaviour stands.
    expect(foregroundCommand(SHELL_PID, [GATE_BASH], 'cmd.exe')).toBe(
      '"E:\\tools\\Git\\usr\\bin\\bash.exe" "/c/Program Files/nodejs/npm" --prefix D:\\git\\throng run gate',
    );
  });
});
