import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionFileName } from '@throng/core';
import { installCollectorCrashHooks, openCollectorLog } from '../../src/collector/collector-log.js';

/**
 * 066 FR-005 / T020 — the resource collector keeps its own log in the one logs folder (passed by UI
 * main as `THRONG_LOG_DIR`), and a throw nobody caught in it is a fatal record there.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const STARTED = new Date(2026, 10, 6, 9, 30, 0);

describe('the collector log', () => {
  it('opens a session file named for the collector in the folder main passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-collector-log-'));
    dirs.push(dir);
    const log = openCollectorLog({ env: { THRONG_LOG_DIR: dir }, pid: 4242, startedAt: STARTED });
    expect(log).not.toBeNull();
    log!.info('hello');
    log!.close();
    expect(readdirSync(dir)).toContain(sessionFileName('collector', STARTED, 4242));
    expect(readFileSync(join(dir, sessionFileName('collector', STARTED, 4242)), 'utf8')).toMatch(/\[collector\] hello/);
  });

  it('has no log when main passed no folder', () => {
    expect(openCollectorLog({ env: {}, pid: 1, startedAt: STARTED })).toBeNull();
  });

  it('records an uncaught exception and an unhandled rejection at fatal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-collector-log-'));
    dirs.push(dir);
    const log = openCollectorLog({ env: { THRONG_LOG_DIR: dir }, pid: 7, startedAt: STARTED })!;
    const restore = log.attachConsole();
    const proc = new EventEmitter();
    const exits: number[] = [];
    try {
      installCollectorCrashHooks(proc, log, (code) => exits.push(code));
      proc.emit('unhandledRejection', new Error('rejected read'));
      proc.emit('uncaughtException', new Error('boom in a tick'));
    } finally {
      restore();
    }
    const text = readFileSync(join(dir, sessionFileName('collector', STARTED, 7)), 'utf8');
    expect(text).toMatch(/FATAL [^\n]*boom in a tick/);
    expect(text).toMatch(/FATAL [^\n]*rejected read/);
    expect(exits).toEqual([1]);
  });
});
