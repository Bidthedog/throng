import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnonymiser, type Anonymiser } from '@throng/core';
import { CRASH_DIR_NAME, createFileLog, writeCrashReport } from '@throng/platform-node';

/**
 * #123, 066 — the sink, against a real directory.
 *
 * The rules it applies are unit-tested without a disk (core/diagnostics). What can only be proved
 * here is that they reach the disk: that a line survives, that roll-over renames and retention
 * deletes, that a crash report is a file a user can attach — and that none of it throws when the
 * directory is hostile, because a logger that takes down the process it is observing is worse than
 * no logger at all.
 *
 * Moved from platform-windows (where Linux CI never ran it): nothing here is Windows-specific.
 */

const MB = 1024 * 1024;

describe('createFileLog (durable diagnostics)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'throng-log-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* already gone */
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const read = (name = 'main.log'): string => readFileSync(join(dir, name), 'utf8');

  it('writes durable, level-filtered records and creates its directory', () => {
    const nested = join(dir, 'logs');
    const log = createFileLog({
      dir: nested,
      fileName: 'main.log',
      component: 'ui-main',
      level: 'info',
      mirrorToConsole: false,
    });
    log.info('started');
    log.debug('not at this threshold');
    log.error('boom');

    const text = readFileSync(join(nested, 'main.log'), 'utf8');
    expect(text).toContain('INFO  [ui-main] started');
    expect(text).toContain('ERROR [ui-main] boom');
    expect(text).not.toContain('not at this threshold');
    // One record, one line — so the file can be tailed and pasted into a bug report.
    expect(text.trimEnd().split('\n')).toHaveLength(2);
    expect(log.path).toBe(join(nested, 'main.log'));
  });

  it('honours a level raised at runtime, so a settings change needs no restart', () => {
    const log = createFileLog({
      dir, fileName: 'main.log', component: 'ui-main', level: 'error', mirrorToConsole: false,
    });
    log.info('invisible');
    log.setLevel('debug');
    log.debug('now visible');
    expect(read()).not.toContain('invisible');
    expect(read()).toContain('now visible');
  });

  it('writes through the threshold on logAlways, which an ordinary write cannot (030 FR-006b)', () => {
    const log = createFileLog({
      dir, fileName: 'main.log', component: 'ui-main', level: 'error', mirrorToConsole: false,
    });
    log.info('an ordinary write, below the threshold');
    log.logAlways('info', 'a notice record, below the same threshold');
    log.logAlways('warn', 'a warning notice record');

    const text = read();
    expect(text).not.toContain('an ordinary write');
    expect(text).toContain('INFO  [ui-main] a notice record, below the same threshold');
    expect(text).toContain('WARN  [ui-main] a warning notice record');
  });

  it('066 FR-009a: writes a fatal record under every threshold, fatal included', () => {
    const log = createFileLog({
      dir, fileName: 'main.log', component: 'ui-main', level: 'fatal', mirrorToConsole: false,
    });
    log.error('below a fatal threshold');
    log.log('fatal', 'the renderer crashed');
    const text = read();
    expect(text).not.toContain('below a fatal threshold');
    expect(text).toContain('FATAL [ui-main] the renderer crashed');
  });

  it('keeps one record on one line, however many newlines the record contains', () => {
    const log = createFileLog({
      dir, fileName: 'main.log', component: 'renderer-notice', level: 'error', mirrorToConsole: false,
    });
    log.logAlways('error', 'detail | EPERM: first\r\nsecond line\nthird line');
    const lines = read().trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('detail | EPERM: first\\nsecond line\\nthird line');
  });

  it('lets one record name its own component, so renderer notices are findable in the file', () => {
    const log = createFileLog({
      dir, fileName: 'main.log', component: 'ui-main', level: 'debug', mirrorToConsole: false,
    });
    log.logAlways('error', 'severity=error | Could not rename the file.', 'renderer-notice');
    log.error('main is still main');
    const text = read();
    expect(text).toContain('ERROR [renderer-notice] severity=error | Could not rename the file.');
    expect(text).toContain('ERROR [ui-main] main is still main');
  });

  it('066 FR-018: rolls over at the file size to the next generation, deleting nothing', () => {
    const log = createFileLog({
      dir,
      fileName: 'daemon.log',
      component: 'daemon',
      level: 'debug',
      mirrorToConsole: false,
      retention: { maxFileBytes: 1024 },
    });
    for (let i = 0; i < 40; i += 1) log.info(`record ${i} ${'x'.repeat(100)}`);

    const files = readdirSync(dir).sort();
    expect(files.length).toBeGreaterThan(3);
    expect(files).toContain('daemon.1.log');
    expect(files).toContain('daemon.2.log');
    for (const f of files) expect(statSync(join(dir, f)).size).toBeLessThanOrEqual(1024 + 200);
    // The live file holds the NEWEST records; the first generation the oldest, all still present.
    expect(read('daemon.log')).toContain('record 39');
    expect(read('daemon.1.log')).toContain('record 0 ');
  });

  it('rolls a threshold-bypassing record like any other — logAlways skips the level, not the policy', () => {
    const log = createFileLog({
      dir, fileName: 'main.log', component: 'ui-main', level: 'error', mirrorToConsole: false,
      retention: { maxFileBytes: 1024 },
    });
    for (let i = 0; i < 20; i += 1) log.logAlways('info', `notice ${i} ${'x'.repeat(100)}`);
    expect(readdirSync(dir)).toContain('main.1.log');
    expect(statSync(join(dir, 'main.log')).size).toBeLessThanOrEqual(1024 + 200);
  });

  describe('066 FR-019 / FR-019a: retention on start and on a new day', () => {
    const DAY = 24 * 60 * 60 * 1000;
    // Noon of the REAL local day: files the logger itself writes carry the real clock's mtime, so the
    // injected clock must agree with it about which day it is. Seeded ages stay well inside a day.
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const today = noon.getTime();
    const seed = (name: string, ageDays: number, bytes = 10): void => {
      const path = join(dir, name);
      writeFileSync(path, Buffer.alloc(bytes, 'x'));
      const t = (today - ageDays * DAY) / 1000;
      utimesSync(path, t, t);
    };

    it('keeps the last 3 active days and records what it removed (SC-007)', () => {
      seed('daemon-20261020-1.log', 17);
      seed('main-20261025-2.log', 12);
      seed('main-20261101-3.log', 5);
      seed('daemon-20261104-4.log', 2);
      seed('main-20261105-5.log', 1);

      const log = createFileLog({
        dir, fileName: 'main-20261106-6.log', component: 'ui-main', mirrorToConsole: false, now: () => today,
      });
      log.info('started');

      expect(readdirSync(dir).sort()).toEqual(['daemon-20261104-4.log', 'main-20261105-5.log', 'main-20261106-6.log']);
      expect(read('main-20261106-6.log')).toMatch(/INFO {2}\[ui-main\] log retention trimmed 3 files \(0\.0 MB\) to stay under 100 MB/);
    });

    it('trims the oldest first to the folder cap and never touches a file live today (SC-008)', () => {
      seed('crashloop-a.1.log', 0.3, 30 * MB);
      seed('crashloop-a.2.log', 0.2, 30 * MB);
      seed('other-live.log', 0.1, 30 * MB); // another process's live file, written today

      const log = createFileLog({
        dir, fileName: 'main.log', component: 'ui-main', mirrorToConsole: false, now: () => today,
        retention: { maxTotalBytes: 50 * MB },
      });
      log.info('started');

      expect(readdirSync(dir).sort()).toEqual(['main.log', 'other-live.log']);
      expect(read()).toContain('log retention trimmed 2 files (60.0 MB) to stay under 50 MB');
    });

    it('prunes again on the first write of a new day, so a week-long daemon still sheds old days', () => {
      let clock = today;
      seed('old-1.log', 2);
      seed('old-2.log', 1);
      const log = createFileLog({
        dir, fileName: 'daemon.log', component: 'daemon', mirrorToConsole: false, now: () => clock,
        retention: { keepDays: 2 },
      });
      log.info('day one');
      expect(readdirSync(dir)).toContain('old-2.log');
      clock = today + DAY;
      log.info('day two');
      expect(readdirSync(dir)).not.toContain('old-2.log');
    });

    it("keeps a running process's quiet log and a fixed-name log, and prunes a dead process's (review)", () => {
      const deadPid = 2_147_483_000; // above any pid the OS hands out
      seed(`collector-20261001-000000-${process.pid}.log`, 10);
      seed(`collector-20261001-000000-${deadPid}.log`, 10);
      seed('daemon-startup.log', 10);
      createFileLog({ dir, fileName: 'main.log', component: 'ui-main', mirrorToConsole: false, now: () => today, retention: { keepDays: 1 } }).info('x');
      expect(readdirSync(dir).sort()).toEqual([`collector-20261001-000000-${process.pid}.log`, 'daemon-startup.log', 'main.log'].sort());
    });

    it('counts crash reports towards the cap', () => {
      mkdirSync(join(dir, CRASH_DIR_NAME));
      writeFileSync(join(dir, CRASH_DIR_NAME, 'crash-old.log'), Buffer.alloc(60 * MB, 'x'));
      const t = (today - 0.3 * DAY) / 1000;
      utimesSync(join(dir, CRASH_DIR_NAME, 'crash-old.log'), t, t);
      createFileLog({
        dir, fileName: 'main.log', component: 'ui-main', mirrorToConsole: false, now: () => today,
        retention: { maxTotalBytes: 50 * MB },
      }).info('x');
      expect(readdirSync(join(dir, CRASH_DIR_NAME))).toEqual([]);
    });
  });

  describe('066 FR-015: repeats are summarised, not repeated', () => {
    it('collapses an identical line within 60 s and flushes the count on the next different line', () => {
      let clock = 0;
      const log = createFileLog({ dir, fileName: 'main.log', component: 'c', mirrorToConsole: false, now: () => clock });
      for (let i = 0; i < 5; i += 1) {
        log.warn('poll failed');
        clock += 1000;
      }
      log.info('recovered');
      const lines = read().trimEnd().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('WARN  [c] poll failed');
      expect(lines[1]).toContain('WARN  [c] poll failed (repeated 4 times in 4s)');
      expect(lines[2]).toContain('INFO  [c] recovered');
    });

    it('flushes the count when the window ends with no further record, stamped at the last repeat (review)', () => {
      vi.useFakeTimers({ now: 0 });
      try {
        const log = createFileLog({ dir, fileName: 'main.log', component: 'c', mirrorToConsole: false, now: () => Date.now() });
        log.warn('poll failed');
        vi.advanceTimersByTime(1000);
        log.warn('poll failed');
        vi.advanceTimersByTime(1000);
        log.warn('poll failed');
        vi.advanceTimersByTime(60_000); // the failure stopped: nothing else is ever written
        const lines = read().trimEnd().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[1]).toBe('1970-01-01T00:00:02.000Z WARN  [c] poll failed (repeated 2 times in 2s)');
      } finally {
        vi.useRealTimers();
      }
    });

    it('flushes the count on close()', () => {
      const log = createFileLog({ dir, fileName: 'main.log', component: 'c', mirrorToConsole: false, now: () => 0 });
      log.warn('x');
      log.warn('x');
      log.close();
      expect(read()).toContain('x (repeated 1 times in 0s)');
    });

    it('SC-005: an hour of one-a-second failures stays under 61 lines and every one is counted', () => {
      let clock = 0;
      const log = createFileLog({ dir, fileName: 'main.log', component: 'c', mirrorToConsole: false, now: () => clock });
      for (let i = 0; i < 3600; i += 1) {
        log.warn('helper failed');
        clock += 1000;
      }
      log.close();
      const lines = read().trimEnd().split('\n');
      expect(lines.length).toBeLessThanOrEqual(61);
      const counted = lines
        .map((l) => /repeated (\d+) times/.exec(l)?.[1])
        .reduce((sum, n) => sum + (n ? Number(n) : 1), 0);
      expect(counted).toBe(3600);
    });
  });

  it('tees console output into the log, and maps a [FATAL] console.error to the fatal level', () => {
    const log = createFileLog({
      dir, fileName: 'main.log', component: 'ui-main', level: 'debug', mirrorToConsole: false,
    });
    const restore = log.attachConsole();
    try {
      console.log('[throng-ui] plain');
      console.warn('careful', { a: 1 });
      console.error(new Error('with a stack'));
      console.error('[FATAL] panel crashed: boom');
    } finally {
      restore();
    }
    const text = read();
    expect(text).toContain('INFO  [ui-main] [throng-ui] plain');
    expect(text).toContain('WARN  [ui-main] careful {"a":1}');
    expect(text).toContain('ERROR [ui-main] Error: with a stack');
    expect(text).toContain('FATAL [ui-main] panel crashed: boom');
    console.log('after restore');
    expect(read()).not.toContain('after restore');
  });

  it('writes one crash report per crash, beside the logs', () => {
    const path = writeCrashReport(dir, {
      component: 'renderer',
      at: new Date('2026-07-26T09:15:00.000Z'),
      reason: 'crashed',
      exitCode: 133,
      version: '1.2.3',
      buildId: 'abc123',
      output: 'stack here',
    });
    expect(path).not.toBeNull();
    const contents = readFileSync(path as string, 'utf8');
    expect(contents).toContain('throng crash report');
    expect(contents).toContain('build:     abc123');
    expect(contents).toContain('stack here');
    expect(readdirSync(join(dir, CRASH_DIR_NAME))).toHaveLength(1);

    writeCrashReport(dir, {
      component: 'renderer',
      at: new Date('2026-07-26T09:16:00.000Z'),
      reason: 'oom',
      version: '1.2.3',
      buildId: 'abc123',
    });
    expect(readdirSync(join(dir, CRASH_DIR_NAME))).toHaveLength(2);
  });

  it('FR-016: never throws when the destination is unusable, and says so on stderr', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'not a directory');
    const log = createFileLog({
      dir: blocked, fileName: 'main.log', component: 'ui-main', mirrorToConsole: false,
    });
    expect(() => log.error('still not fatal')).not.toThrow();
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toMatch(/^throng log: /m);
    expect(writeCrashReport(blocked, {
      component: 'ui-main', at: new Date(), reason: 'x', version: '1', buildId: '1',
    })).toBeNull();
  });

  it('FR-016: a folder deleted mid-session throws nothing', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const sub = join(dir, 'logs');
    const log = createFileLog({ dir: sub, fileName: 'main.log', component: 'c', mirrorToConsole: false });
    log.info('one');
    rmSync(sub, { recursive: true, force: true });
    expect(() => log.info('two')).not.toThrow();
  });
});

/**
 * 068 FR-034a to FR-034f (#623) — the sink applies the anonymiser, so no registered or recognisable
 * path, name or machine identity reaches the disk, in a line, a repeat summary or a crash report.
 *
 * Layer: integration — what only a real file can show is that the text on disk, not the text handed
 * to the logger, is clean; the replacement rules themselves are unit-tested in core.
 */
describe('createFileLog with an anonymiser (068)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'throng-anon-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const hmac = (salt: string, value: string): string => createHmac('sha256', salt).update(value).digest('hex');
  const anonymiser = (salt = 'install-salt'): Anonymiser => {
    const anon = createAnonymiser({ salt, os: 'linux', hash: hmac });
    anon.register('home', '/home/alice');
    anon.register('user', 'alice');
    anon.register('projectRoot', '/work/secret-app', 'p-1');
    anon.register('projectName', 'Secret App', 'p-1');
    return anon;
  };
  const sink = (anon: Anonymiser, now?: () => number) =>
    createFileLog({
      dir, fileName: 'main.log', component: 'ui-main', mirrorToConsole: false, anonymiser: anon, now,
    });
  const text = (): string => readFileSync(join(dir, 'main.log'), 'utf8');

  it('writes no registered value and no unregistered absolute path', () => {
    const log = sink(anonymiser());
    log.info('opened /work/secret-app/src/a.ts for alice in /home/alice/docs');
    log.error('Secret App failed: ENOENT: no such file or directory, open \'/srv/other/x.txt\'');
    log.logAlways('warn', 'stray /opt/elsewhere/file.js:3:4', 'renderer');
    const out = text();
    expect(out).not.toMatch(/alice|secret-app|Secret App|\/work|\/home|\/srv|\/opt|other|elsewhere/);
    expect(out).toContain('<project:p-1>');
  });

  it('collapses repeats on the anonymised text', () => {
    let clock = 1_000;
    const log = sink(anonymiser(), () => clock);
    for (let i = 0; i < 3; i++) {
      log.info('again /home/alice/x');
      clock += 10;
    }
    log.close();
    const out = text();
    expect(out).toContain('(repeated 2 times in');
    expect(out).not.toMatch(/alice/);
  });

  it('anonymises a crash report reason, output and context', () => {
    const path = writeCrashReport(
      dir,
      {
        component: 'daemon', at: new Date('2026-11-12T09:00:00.000Z'), reason: 'died in /home/alice/app',
        version: '1', buildId: 'b', output: 'at /work/secret-app/src/x.ts:1:2', context: { data: '/home/alice/.data' },
      },
      anonymiser(),
    );
    const out = readFileSync(path as string, 'utf8');
    expect(out).not.toMatch(/alice|secret-app|\/home|\/work/);
    expect(out).toContain('<project:p-1>');
  });

  it('gives the same token across two sinks sharing a salt and a file', () => {
    sink(anonymiser('shared')).info('by alice');
    sink(anonymiser('shared')).info('by alice');
    const lines = text().trimEnd().split('\n');
    const tokens = lines.map((l) => /<user-[0-9a-f]{8}>/.exec(l)?.[0]);
    expect(tokens[0]).toBeDefined();
    expect(tokens[0]).toBe(tokens[1]);
  });
});
