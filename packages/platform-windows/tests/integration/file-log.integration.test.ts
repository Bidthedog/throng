import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CRASH_DIR_NAME, createFileLog, writeCrashReport } from '@throng/platform-windows';

/**
 * #123 — the sink, against a real directory.
 *
 * The rules it applies are unit-tested without a disk (core/diagnostics). What can only be proved
 * here is that they reach the disk: that a line survives, that rotation actually renames and
 * deletes, that a crash report is a file a user can attach — and that none of it throws when the
 * directory is hostile, because a logger that takes down the process it is observing is worse than
 * no logger at all.
 */
describe('createFileLog (durable diagnostics)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'throng-log-'));
  });
  afterEach(() => {
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

  it('rotates and retains, so a long-lived daemon cannot fill the disk', () => {
    const log = createFileLog({
      dir,
      fileName: 'daemon.log',
      component: 'daemon',
      level: 'debug',
      mirrorToConsole: false,
      policy: { maxBytes: 1024, keep: 3 },
    });
    // Well past the cap: ~200 records of >100 bytes each.
    for (let i = 0; i < 200; i += 1) log.info(`record ${i} ${'x'.repeat(100)}`);

    const files = readdirSync(dir).sort();
    expect(files).toEqual(['daemon.1.log', 'daemon.2.log', 'daemon.log']);
    // Retention is a REAL bound, not a hopeful one.
    for (const f of files) expect(statSync(join(dir, f)).size).toBeLessThanOrEqual(1024 + 200);
    // The live file holds the NEWEST records — the ones a crash report will be about.
    expect(read('daemon.log')).toContain('record 199');
  });

  it('tees console output into the log, which is what makes existing diagnostics durable', () => {
    const log = createFileLog({
      dir, fileName: 'main.log', component: 'ui-main', level: 'debug', mirrorToConsole: false,
    });
    const restore = log.attachConsole();
    try {
      console.log('[throng-ui] plain');
      console.warn('careful', { a: 1 });
      console.error(new Error('with a stack'));
    } finally {
      restore();
    }
    const text = read();
    expect(text).toContain('INFO  [ui-main] [throng-ui] plain');
    expect(text).toContain('WARN  [ui-main] careful {"a":1}');
    expect(text).toContain('ERROR [ui-main] Error: with a stack');
    // Restored: the console is the caller's again.
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

    // A second crash is a second FILE — the unit a user attaches is one crash.
    writeCrashReport(dir, {
      component: 'renderer',
      at: new Date('2026-07-26T09:16:00.000Z'),
      reason: 'oom',
      version: '1.2.3',
      buildId: 'abc123',
    });
    expect(readdirSync(join(dir, CRASH_DIR_NAME))).toHaveLength(2);
  });

  it('never throws when the destination is unusable', () => {
    // A FILE where the directory should be: every write fails, and none of it may propagate.
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'not a directory');
    const log = createFileLog({
      dir: blocked, fileName: 'main.log', component: 'ui-main', mirrorToConsole: false,
    });
    expect(() => log.error('still not fatal')).not.toThrow();
    expect(writeCrashReport(blocked, {
      component: 'ui-main', at: new Date(), reason: 'x', version: '1', buildId: '1',
    })).toBeNull();
  });
});
