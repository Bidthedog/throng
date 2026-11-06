import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETENTION,
  logDayOf,
  logFilePid,
  nextRotatedName,
  normaliseRetention,
  retentionPlan,
  sessionFileName,
  type LogFileInfo,
} from '@throng/core';

/**
 * 066 FR-018 – FR-020 — what the logs folder keeps. Every process's log rolls over at a size; the folder
 * keeps the last N ACTIVE days (days throng actually ran, so a fortnight away does not empty it) under a
 * total cap; and a file another process may still be writing is never deleted.
 *
 * Dates are built in local time: a "day" is the user's calendar day, not UTC's.
 */

const MB = 1024 * 1024;
const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime();
const file = (name: string, modifiedMs: number, bytes = 1000): LogFileInfo => ({ name, bytes, modifiedMs });
const policy = (over: Partial<typeof DEFAULT_RETENTION> = {}) => normaliseRetention({ ...DEFAULT_RETENTION, ...over });

describe('session file names', () => {
  it('names a session by component, local start time and pid', () => {
    expect(sessionFileName('daemon', new Date(2026, 10, 6, 9, 5, 7), 42)).toBe('daemon-20261106-090507-42.log');
  });

  it("dates a file by the local day it was last written, so a live file is always today's", () => {
    expect(logDayOf(new Date(2026, 10, 6, 23, 59).getTime())).toBe('20261106');
    expect(logDayOf(new Date(2026, 10, 7, 0, 1).getTime())).toBe('20261107');
  });

  it('rolls over to the next unused generation rather than shifting older ones along', () => {
    expect(nextRotatedName('main-20261106-090507-1.log', [])).toBe('main-20261106-090507-1.1.log');
    expect(
      nextRotatedName('main-20261106-090507-1.log', ['main-20261106-090507-1.1.log', 'main-20261106-090507-1.2.log', 'other.3.log']),
    ).toBe('main-20261106-090507-1.3.log');
  });
});

describe('retention by active day (FR-019)', () => {
  it('keeps the last 3 days throng ran on, however far apart they were (SC-007)', () => {
    const files = [
      file('daemon-20261020-1.log', at(2026, 10, 20)),
      file('daemon-20261025-2.log', at(2026, 10, 25)),
      file('main-20261101-3.log', at(2026, 11, 1)),
      file('daemon-20261101-4.1.log', at(2026, 11, 1)),
      file('daemon-20261104-5.log', at(2026, 11, 4)),
      file('main-20261106-6.log', at(2026, 11, 6)),
    ];
    const plan = retentionPlan(files, policy({ keepDays: 3 }), '20261106');
    expect([...plan.delete].sort()).toEqual(['daemon-20261020-1.log', 'daemon-20261025-2.log']);
    expect(plan.trimmedBytes).toBe(2000);
  });

  it('keeps a long-running session that started days ago, because it was written today', () => {
    const files = [file('daemon-20261020-1.log', at(2026, 11, 6)), file('main-20261105-2.log', at(2026, 11, 5))];
    expect(retentionPlan(files, policy({ keepDays: 1 }), '20261106').delete).toEqual(['main-20261105-2.log']);
  });

  it('counts today as an active day before anything has been written today', () => {
    const files = [file('a-1.log', at(2026, 11, 5)), file('a-2.log', at(2026, 11, 4))];
    expect(retentionPlan(files, policy({ keepDays: 2 }), '20261106').delete).toEqual(['a-2.log']);
  });

  it('dates legacy names (main.log, throng-agent-123.log) by their last write too', () => {
    const files = [file('main.log', at(2026, 10, 1)), file('throng-agent-123.log', at(2026, 11, 6))];
    expect(retentionPlan(files, policy({ keepDays: 1 }), '20261106').delete).toEqual(['main.log']);
  });
});

describe('the total cap (FR-019a)', () => {
  it('deletes oldest first until the folder is under the cap (SC-008)', () => {
    const files = [
      file('a-1.1.log', at(2026, 11, 6, 1), 40 * MB),
      file('a-1.2.log', at(2026, 11, 6, 2), 40 * MB),
      file('a-1.3.log', at(2026, 11, 6, 3), 40 * MB),
      file('a-1.log', at(2026, 11, 6, 4), 1 * MB),
    ];
    const plan = retentionPlan(files, policy({ maxTotalBytes: 100 * MB }), '20261106');
    expect(plan.delete).toEqual(['a-1.1.log']);
    expect(plan.trimmedBytes).toBe(40 * MB);
  });

  it("never deletes an un-rotated file written today — it may be any process's live file", () => {
    const files = [
      file('daemon-1.log', at(2026, 11, 6, 1), 80 * MB),
      file('main-2.log', at(2026, 11, 6, 2), 80 * MB),
      file('main-2.1.log', at(2026, 11, 6, 3), 5 * MB),
    ];
    const plan = retentionPlan(files, policy({ maxTotalBytes: 50 * MB }), '20261106');
    // Only the rolled file is eligible; the folder stays over the cap rather than lose a live file.
    expect(plan.delete).toEqual(['main-2.1.log']);
  });

  it('keeps a file a running process still holds, however long ago it last wrote (review: a quiet live file)', () => {
    const files = [
      file('daemon-startup.log', at(2026, 10, 20), 1 * MB), // handed to a daemon that has run for weeks
      file('collector-20261020-090000-42.log', at(2026, 10, 20), 1 * MB),
      file('collector-20261020-090000-43.log', at(2026, 10, 20), 1 * MB),
    ];
    const live = (name: string): boolean => name === 'daemon-startup.log' || logFilePid(name) === 42;
    expect(retentionPlan(files, policy({ keepDays: 1 }), '20261106', live).delete).toEqual(['collector-20261020-090000-43.log']);
  });

  it('reads the owning pid from a session name or a legacy agent name, and none from a fixed name', () => {
    expect(logFilePid('pty-agent-20261106-090507-4242.log')).toBe(4242);
    expect(logFilePid('throng-agent-123.log')).toBe(123);
    expect(logFilePid('pty-agent-20261106-090507-4242.1.log')).toBe(4242);
    expect(logFilePid('main.log')).toBeUndefined();
    expect(logFilePid('daemon-startup.log')).toBeUndefined();
  });

  it('a crash report is closed the moment it is written, so it is eligible today', () => {
    const files = [file('crashes/crash-x.log', at(2026, 11, 6, 1), 80 * MB), file('main-1.log', at(2026, 11, 6, 2), 1 * MB)];
    expect(retentionPlan(files, policy({ maxTotalBytes: 50 * MB }), '20261106').delete).toEqual(['crashes/crash-x.log']);
  });

  it('an un-rotated file from an earlier day is closed, so it is eligible', () => {
    const files = [file('main-1.log', at(2026, 11, 5), 80 * MB), file('main-2.log', at(2026, 11, 6), 80 * MB)];
    expect(retentionPlan(files, policy({ maxTotalBytes: 100 * MB }), '20261106').delete).toEqual(['main-1.log']);
  });
});

describe('the policy cannot be configured into misbehaving', () => {
  it('defaults to 3 active days, a 100 MB folder and 1 MiB files', () => {
    expect(DEFAULT_RETENTION).toEqual({ keepDays: 3, maxTotalBytes: 100 * MB, maxFileBytes: 1_048_576 });
    expect(normaliseRetention(undefined)).toEqual(DEFAULT_RETENTION);
  });

  it('clamps keepDays to 1–30, the cap to 50 MB – 65536 MB (the hard maximum) and files to at least 1 KiB', () => {
    expect(normaliseRetention({ keepDays: 0 }).keepDays).toBe(1);
    expect(normaliseRetention({ keepDays: 99 }).keepDays).toBe(30);
    expect(normaliseRetention({ keepDays: 2.7 }).keepDays).toBe(2);
    expect(normaliseRetention({ maxTotalBytes: 1 }).maxTotalBytes).toBe(50 * MB);
    expect(normaliseRetention({ maxTotalBytes: 1e15 }).maxTotalBytes).toBe(65_536 * MB);
    expect(normaliseRetention({ maxFileBytes: 10 }).maxFileBytes).toBe(1024);
    expect(normaliseRetention({ keepDays: Number.NaN }).keepDays).toBe(3);
  });
});
