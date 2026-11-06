import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOG_LEVEL,
  crashFileName,
  formatCrashReport,
  formatLogLine,
  isLogLevel,
  parseLogLevel,
  passesThreshold,
  rotatedName,
  shouldRotate,
} from '@throng/core';

/**
 * #123 — the DECISIONS behind durable diagnostics, tested without a disk.
 *
 * An installed throng has no console, so these are the rules that decide what its only diagnostic
 * channel contains and how big it is allowed to get. Every one of them is exercised here; the sink
 * that applies them is exercised against a real directory in the integration suite.
 */

describe('log levels', () => {
  it('orders by severity, so a threshold admits itself and everything above it', () => {
    expect(passesThreshold('info', 'error')).toBe(true);
    expect(passesThreshold('info', 'warn')).toBe(true);
    expect(passesThreshold('info', 'info')).toBe(true);
    expect(passesThreshold('info', 'debug')).toBe(false);
    // `error` is the quietest useful setting: only failures.
    expect(passesThreshold('error', 'error')).toBe(true);
    expect(passesThreshold('error', 'warn')).toBe(false);
    // `debug` admits everything.
    for (const level of ['error', 'warn', 'info', 'debug'] as const) {
      expect(passesThreshold('debug', level)).toBe(true);
    }
  });

  it('reads a level from configuration, falling back rather than throwing', () => {
    expect(parseLogLevel('debug')).toBe('debug');
    // A settings file with a typo in it must not stop the application starting — least of all the
    // part of it that would report why.
    expect(parseLogLevel('verbose')).toBe(DEFAULT_LOG_LEVEL);
    expect(parseLogLevel(undefined)).toBe(DEFAULT_LOG_LEVEL);
    expect(parseLogLevel(3)).toBe(DEFAULT_LOG_LEVEL);
    expect(parseLogLevel('nonsense', 'error')).toBe('error');
    expect(isLogLevel('warn')).toBe(true);
    expect(isLogLevel('trace')).toBe(false);
  });

  it('066 FR-009a: fatal sits above error and passes every threshold, so a crash is always written', () => {
    for (const threshold of ['fatal', 'error', 'warn', 'info', 'debug'] as const) {
      expect(passesThreshold(threshold, 'fatal'), `threshold ${threshold}`).toBe(true);
    }
    expect(passesThreshold('fatal', 'error'), 'a fatal threshold admits fatal records only').toBe(false);
    expect(parseLogLevel('fatal')).toBe('fatal');
    expect(formatLogLine({ at: '2026-11-06T09:15:00.000Z', level: 'fatal', component: 'panel', message: 'x' })).toBe(
      '2026-11-06T09:15:00.000Z FATAL [panel] x',
    );
  });
});

describe('log records', () => {
  it('writes one line per record, with the time, level and component', () => {
    const line = formatLogLine({
      at: '2026-07-26T09:15:00.000Z',
      level: 'warn',
      component: 'daemon',
      message: 'pipe busy',
    });
    expect(line).toBe('2026-07-26T09:15:00.000Z WARN  [daemon] pipe busy');
    expect(line.includes('\n')).toBe(false);
  });

  it('escapes newlines so a stack trace cannot masquerade as several records', () => {
    const line = formatLogLine({
      at: new Date('2026-07-26T09:15:00.000Z'),
      level: 'error',
      component: 'ui-main',
      message: 'Error: nope\n    at foo\r\n    at bar',
    });
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toContain('\\n    at foo\\n    at bar');
  });
});

describe('crash reports', () => {
  const details = {
    component: 'renderer',
    at: '2026-07-26T09:15:00.000Z',
    reason: 'crashed',
    exitCode: 133,
    version: '1.2.3',
    buildId: 'abc123',
    pid: 4242,
    output: 'Error: boom\n    at thing',
    context: { elevated: true, dropped: undefined },
  };

  it('names the build, so a report says HOW and not merely that something broke', () => {
    const report = formatCrashReport(details);
    expect(report).toContain('version:   1.2.3');
    expect(report).toContain('build:     abc123');
    expect(report).toContain('exit code: 133');
    expect(report).toContain('component: renderer');
    expect(report).toContain('reason:    crashed');
    expect(report).toContain('elevated:  true');
    expect(report).not.toContain('dropped'); // an absent context value is not reported as "undefined"
    // The failure output is carried WHOLE — a stack trace folded into one line is not a stack trace.
    expect(report).toContain('Error: boom\n    at thing');
  });

  it('says so plainly when there was nothing to capture', () => {
    expect(formatCrashReport({ ...details, output: undefined })).toContain('(no output captured)');
  });

  it('gives every crash its own file name, safe on a filesystem', () => {
    const name = crashFileName('gpu process', '2026-07-26T09:15:00.000Z');
    expect(name).toBe('crash-gpu-process-2026-07-26T09-15-00-000Z.log');
    expect(name).not.toMatch(/[:*?"<>|]/);
  });
});

describe('rotation', () => {
  // Retention — what is deleted — is 066's active-day policy, in diagnostics-retention.test.ts. The
  // keep-N-files rule these tests used to pin (031 FR-015) is superseded by 066 FR-020.
  it('rotates before a write that would exceed the cap, not after', () => {
    expect(shouldRotate(90, 5, 100)).toBe(false);
    expect(shouldRotate(90, 20, 100)).toBe(true);
    // An empty file never rotates, however large the incoming record: a single oversized record
    // still gets written whole rather than being lost to an endless rotate loop.
    expect(shouldRotate(0, 1000, 100)).toBe(false);
  });

  it('suffixes the generation before the extension', () => {
    expect(rotatedName('main.log', 2)).toBe('main.2.log');
    expect(rotatedName('main', 2)).toBe('main.2');
    expect(rotatedName('a.b.log', 1)).toBe('a.b.1.log');
  });
});
