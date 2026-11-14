import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogLevel } from '@throng/core';
import { startUiDiagnostics, type UiDiagnostics } from '../../src/main/diagnostics.js';
import {
  DIAGNOSTICS_LOG_CHANNEL,
  MAX_RENDERER_MESSAGE_CHARS,
  forwardRendererConsole,
  registerDiagnosticsLogIpc,
} from '../../src/main/diagnostics-ipc.js';

/**
 * 066 T023 (contract *Preload → main*, research R1/R5) — the renderer's records reach main.log:
 * `throng:diagnostics:log` writes fatal whatever the threshold, everything else through it, caps a
 * message at 8 KB and drops an unknown level; and the renderer's console reaches main.log as
 * component `renderer`, filtered by main's threshold.
 */

const dirs: string[] = [];
const opened: UiDiagnostics[] = [];
afterEach(() => {
  for (const d of opened.splice(0)) d.log.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function diagnostics(level: LogLevel): UiDiagnostics {
  const dir = mkdtempSync(join(tmpdir(), 'throng-diag-ipc-'));
  dirs.push(dir);
  const d = startUiDiagnostics({ userDataDir: dir, version: '0.0.0-test', buildId: 'test', level });
  opened.push(d);
  return d;
}

const lines = (d: UiDiagnostics): string[] =>
  (existsSync(d.log.path) ? readFileSync(d.log.path, 'utf8') : '').split('\n').filter(Boolean);

function ipc(d: UiDiagnostics): (payload: unknown) => void {
  const bus = new EventEmitter();
  registerDiagnosticsLogIpc(d, bus);
  return (payload) => bus.emit(DIAGNOSTICS_LOG_CHANNEL, {}, payload);
}

describe('throng:diagnostics:log (066 T023)', () => {
  it('writes fatal whatever the threshold, with the component the renderer named', () => {
    const d = diagnostics('error');
    ipc(d)({ level: 'fatal', component: 'panel', message: 'Project › Tab › Terminal crashed' });
    const line = lines(d).find((l) => l.includes('crashed'));
    expect(line).toMatch(/ FATAL \[panel\] Project › Tab › Terminal crashed/);
  });

  it('writes other levels through the threshold', () => {
    const d = diagnostics('warn');
    const send = ipc(d);
    send({ level: 'info', component: 'renderer', message: 'dropped info' });
    send({ level: 'debug', component: 'renderer', message: 'dropped debug' });
    send({ level: 'error', component: 'renderer', message: 'kept error' });
    send({ level: 'warn', component: 'renderer', message: 'kept warn' });
    const text = lines(d).join('\n');
    expect(text).not.toContain('dropped');
    expect(text).toMatch(/ ERROR \[renderer\] kept error/);
    expect(text).toMatch(/ WARN {2}\[renderer\] kept warn/);
  });

  it('follows a threshold changed at runtime', () => {
    const d = diagnostics('info');
    const send = ipc(d);
    send({ level: 'debug', component: 'renderer', message: 'before' });
    d.setLevel('debug');
    send({ level: 'debug', component: 'renderer', message: 'after' });
    const text = lines(d).join('\n');
    expect(text).not.toContain('before');
    expect(text).toContain('after');
  });

  it('caps a message at 8 KB', () => {
    const d = diagnostics('info');
    ipc(d)({ level: 'error', component: 'renderer', message: 'x'.repeat(MAX_RENDERER_MESSAGE_CHARS * 3) });
    expect(MAX_RENDERER_MESSAGE_CHARS).toBe(8 * 1024);
    const line = lines(d).find((l) => l.includes('xxxx'))!;
    expect(line.length).toBeLessThan(MAX_RENDERER_MESSAGE_CHARS + 200);
  });

  it('rejects an unknown level, and a malformed payload, without throwing', () => {
    const d = diagnostics('debug');
    const send = ipc(d);
    expect(() => send({ level: 'panic', component: 'renderer', message: 'unknown level' })).not.toThrow();
    expect(() => send('not an object')).not.toThrow();
    expect(() => send({ level: 'error', component: 'renderer', message: 42 })).not.toThrow();
    expect(lines(d).join('\n')).not.toContain('unknown level');
  });
});

describe('the renderer console backstop (066 T023)', () => {
  const consoleOf = (d: UiDiagnostics) => {
    const contents = new EventEmitter();
    forwardRendererConsole(d, contents);
    return (level: 'debug' | 'info' | 'warning' | 'error', message: string) =>
      contents.emit('console-message', { level, message, lineNumber: 7, sourceId: 'app://renderer/index.js' });
  };

  it('writes every console level to main.log as component renderer', () => {
    const d = diagnostics('debug');
    const say = consoleOf(d);
    say('debug', 'a debug line');
    say('info', 'an info line');
    say('warning', 'a warning line');
    say('error', 'an error line');
    const text = lines(d).join('\n');
    expect(text).toMatch(/ DEBUG \[renderer\] a debug line/);
    expect(text).toMatch(/ INFO {2}\[renderer\] an info line/);
    expect(text).toMatch(/ WARN {2}\[renderer\] a warning line/);
    expect(text).toMatch(/ ERROR \[renderer\] an error line/);
  });

  it("filters by main's threshold, so logExpected's debug lines are kept only when debug is on", () => {
    const d = diagnostics('info');
    const say = consoleOf(d);
    say('debug', 'expected: hidden');
    d.setLevel('debug');
    say('debug', 'expected: shown');
    const text = lines(d).join('\n');
    expect(text).not.toContain('hidden');
    expect(text).toContain('expected: shown');
  });

  it('maps a [FATAL] console line to the fatal level', () => {
    const d = diagnostics('error');
    consoleOf(d)('error', '[FATAL] renderer crashed: boom');
    expect(lines(d).join('\n')).toMatch(/ FATAL \[renderer\] renderer crashed: boom/);
  });

  it('068 FR-034b: anonymises a renderer message BEFORE the 8 KB cap and in the file', () => {
    const d = diagnostics('info');
    const home = homedir();
    // The home folder is a long registered value: once tokenised the message fits under the cap, so a
    // cap applied first would have cut it and written a "more chars" marker.
    const padding = 'x'.repeat(MAX_RENDERER_MESSAGE_CHARS - 45);
    ipc(d)({ level: 'info', component: 'renderer', message: `${padding} ${home}/a/very/long/${'y'.repeat(60)}.ts` });
    const text = lines(d).join('\n');
    expect(text).not.toContain(home);
    expect(text).not.toContain('more chars');
    expect(text).toMatch(/<(home|path)-[0-9a-f]{8}>/);
  });
});
