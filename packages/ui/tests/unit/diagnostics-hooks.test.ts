import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UNRESPONSIVE_FATAL_MS,
  installCrashHandlers,
  startUiDiagnostics,
  watchWindowHealth,
  type CrashSourceApp,
  type UiDiagnostics,
  type WatchedWindow,
} from '../../src/main/diagnostics.js';

/**
 * 066 T021 (FR-005, FR-009a, research R3) — every way a window or UI main dies is a FATAL record in
 * main.log: a renderer gone, a child process gone, a window unresponsive past its timeout, a preload
 * that threw, a first load that failed, and an uncaught exception in main.
 */

const dirs: string[] = [];
const opened: UiDiagnostics[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of opened.splice(0)) d.log.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function diagnostics(): UiDiagnostics {
  const dir = mkdtempSync(join(tmpdir(), 'throng-diag-hooks-'));
  dirs.push(dir);
  const d = startUiDiagnostics({ userDataDir: dir, version: '0.0.0-test', buildId: 'test', level: 'error' });
  opened.push(d);
  return d;
}

const read = (d: UiDiagnostics): string => (existsSync(d.log.path) ? readFileSync(d.log.path, 'utf8') : '');
const fatalLines = (d: UiDiagnostics): string[] => read(d).split('\n').filter((l) => / FATAL /.test(l));

class FakeWindow extends EventEmitter implements WatchedWindow {
  readonly webContents = new EventEmitter();
}

describe('installCrashHandlers (066 T021)', () => {
  it('logs a renderer gone at fatal', () => {
    const d = diagnostics();
    const app = new EventEmitter();
    installCrashHandlers(d, app as unknown as CrashSourceApp, new EventEmitter());
    app.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 139 });
    expect(fatalLines(d).join('\n')).toMatch(/renderer[^\n]*crashed[^\n]*139/);
  });

  it('logs a child process gone at fatal', () => {
    const d = diagnostics();
    const app = new EventEmitter();
    installCrashHandlers(d, app as unknown as CrashSourceApp, new EventEmitter());
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'oom', exitCode: 1 });
    expect(fatalLines(d).join('\n')).toMatch(/GPU[^\n]*oom/);
  });

  it('logs an uncaught exception in main at fatal, then hands it back', () => {
    const d = diagnostics();
    const proc = new EventEmitter();
    installCrashHandlers(d, new EventEmitter() as unknown as CrashSourceApp, proc);
    expect(() => proc.emit('uncaughtException', new Error('main blew up'))).toThrow('main blew up');
    expect(fatalLines(d).join('\n')).toMatch(/uncaughtException[^\n]*main blew up/);
  });
});

describe('watchWindowHealth (066 T021)', () => {
  it('logs a window still unresponsive after its timeout at fatal', () => {
    vi.useFakeTimers();
    const d = diagnostics();
    const win = new FakeWindow();
    watchWindowHealth(d, win, 'main window');
    win.emit('unresponsive');
    vi.advanceTimersByTime(UNRESPONSIVE_FATAL_MS - 1);
    expect(fatalLines(d)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fatalLines(d).join('\n')).toMatch(/main window[^\n]*unresponsive/);
  });

  it('does not log fatal for a window that recovers before the timeout', () => {
    vi.useFakeTimers();
    const d = diagnostics();
    const win = new FakeWindow();
    watchWindowHealth(d, win, 'main window');
    win.emit('unresponsive');
    win.emit('responsive');
    vi.advanceTimersByTime(UNRESPONSIVE_FATAL_MS * 2);
    expect(fatalLines(d)).toEqual([]);
  });

  it('logs a preload that threw at fatal', () => {
    const d = diagnostics();
    const win = new FakeWindow();
    watchWindowHealth(d, win, 'preferences');
    win.webContents.emit('preload-error', {}, '/app/preload.cjs', new Error('preload exploded'));
    expect(fatalLines(d).join('\n')).toMatch(/preferences[^\n]*preload[^\n]*preload exploded/);
  });

  it('logs a failed first load at fatal, and not a failed later navigation', () => {
    const d = diagnostics();
    const win = new FakeWindow();
    watchWindowHealth(d, win, 'main window');
    win.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///app/index.html', true);
    expect(fatalLines(d).join('\n')).toMatch(/main window[^\n]*load[^\n]*ERR_FILE_NOT_FOUND/);

    const later = new FakeWindow();
    watchWindowHealth(d, later, 'second');
    later.webContents.emit('did-finish-load');
    later.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true);
    expect(fatalLines(d).join('\n')).not.toMatch(/second/);
  });
});
