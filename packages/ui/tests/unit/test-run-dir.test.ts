import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error — plain-JS test-infrastructure script, imported for its pure reporting helper.
import { cleanupRunDir } from '../../../../scripts/test-run-dir.mjs';

/**
 * What the end-of-run message about a kept run folder is allowed to claim (issue #336).
 *
 * ══ THE MISTAKE THIS FILE EXISTS TO STOP, TWICE OVER ══
 *
 * `cleanupRunDir` keeps the run folder when it is not empty and prints a line saying where it is.
 * That line has now named a WRONG CAUSE twice: first "a test likely crashed", which sent people
 * looking for a crash that had not happened; then, after that was corrected, "a directory Windows
 * would not release, or a test that crashed before its cleanup" — which sent the next person
 * looking for a lock that was not there either.
 *
 * Both times the folder held the same thing: `throng-agent-<pid>.log` files. The de-elevated PTY
 * agent writes one per process to `%TEMP%` (`daemon/src/pty-agent-log.ts`), `%TEMP%` is redirected
 * into the run folder for the duration of a run, and no cleanup path removes them — so an ORDINARY
 * green run ends with a folder full of them. Measured on a 205-passed/0-failed run: 137 of 161
 * items were agent logs.
 *
 * So the rule these tests hold is not a wording preference. It is that the message may report what
 * is THERE and may not assert a cause it never checked — because a confident wrong diagnosis costs
 * more than no diagnosis, and this one has now cost it twice.
 *
 * ══ WHY THE LOGS ARE NOT SIMPLY DELETED ══
 *
 * They are the only record of an agent that dies after connecting back — `DEBUG-agent-crash.md`
 * sends developers to exactly these files — and they do not accumulate: `sweepStaleRunDirs`
 * (gate.mjs:137, playwright-global-setup.mjs:23) removes run folders older than six hours on every
 * run. Bounded diagnostics are worth keeping; the defect was only ever the sentence about them.
 */
describe('cleanupRunDir reports what is in a kept run folder, and asserts no cause (#336)', () => {
  const made: string[] = [];
  const seed = (names: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-rundir-'));
    made.push(dir);
    for (const name of names) writeFileSync(join(dir, name), 'x');
    return dir;
  };
  /** Everything `cleanupRunDir` printed, as one string. */
  const runAndCapture = (dir: string): string => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      cleanupRunDir(dir);
      return spy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
    } finally {
      spy.mockRestore();
    }
  };

  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('names neither a lock nor a crash when every leftover is an agent log', () => {
    const dir = seed(['throng-agent-101.log', 'throng-agent-202.log', 'throng-agent-303.log']);

    const printed = runAndCapture(dir);

    expect(printed, 'a lock was never established').not.toMatch(/would not release/i);
    expect(printed, 'a crash was never established').not.toMatch(/crash/i);
    expect(printed, 'says what is actually there').toMatch(/3 pty-agent log/);
    expect(printed).toContain(dir);
  });

  it('counts the agent logs and the rest separately when both are present', () => {
    const dir = seed(['throng-agent-101.log', 'throng-tfind-abc', 'throng-prefs-def']);

    const printed = runAndCapture(dir);

    expect(printed).toMatch(/1 pty-agent log/);
    expect(printed).toMatch(/2 other item/);
  });

  it('offers the two candidate causes only as candidates, and only for non-log leftovers', () => {
    const logsOnly = runAndCapture(seed(['throng-agent-101.log']));
    const withOther = runAndCapture(seed(['throng-agent-101.log', 'throng-tfind-abc']));

    // The wording that misled twice may appear only where it is a plausible guess — beside
    // something that is not an agent log — and only ever as a guess.
    expect(logsOnly, 'nothing unexplained here, so nothing to speculate about').not.toMatch(
      /would not release/i,
    );
    expect(withOther).toMatch(/would not release/i);
    expect(withOther, 'flagged as unestablished').toMatch(/has been established|open it and look/i);
  });

  it('still removes a folder the run emptied, and says nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-rundir-'));
    made.push(dir);

    const printed = runAndCapture(dir);

    expect(printed, 'a clean run is not news').toBe('');
    expect(() => mkdirSync(dir)).not.toThrow(); // it is gone, so it can be made again
    rmSync(dir, { recursive: true, force: true });
  });
});
