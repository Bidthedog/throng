import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeError, logAt, logCaught, logExpected, logFatal } from '@throng/core';

/**
 * 066 FR-009 / FR-009a — every caught error is logged, through one of three calls whose names say what the
 * catch meant. They write through `console`, which every throng process routes into its log file
 * (research R1), so the same call works in core, the platform packages and the renderer.
 */

let warn: ReturnType<typeof vi.spyOn>;
let debug: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logCaught — an unexpected failure that was handled', () => {
  it('writes one warn line naming where it happened and what failed', () => {
    logCaught('config-store: read themes', new Error('EACCES: permission denied'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe('config-store: read themes: EACCES: permission denied');
  });
});

describe('logExpected — a failure the code anticipates', () => {
  it('writes one debug line with the stated reason', () => {
    logExpected('pick-folder: candidate', 'a remembered folder may have been deleted', new Error('ENOENT'));
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0]?.[0]).toBe('pick-folder: candidate: expected — a remembered folder may have been deleted: ENOENT');
    expect(warn).not.toHaveBeenCalled();
  });

  it('works without an error', () => {
    logExpected('broadcast', 'the window is closing');
    expect(debug.mock.calls[0]?.[0]).toBe('broadcast: expected — the window is closing');
  });

  it('refuses an empty reason: the reason is the point', () => {
    expect(() => logExpected('x', '   ', new Error('y'))).toThrow(/reason/);
  });
});

describe('logFatal — a component crashed', () => {
  it('writes one error line marked [FATAL], which the file logger maps to the fatal level', () => {
    logFatal('panel', 'render failed');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe('[FATAL] panel crashed: render failed');
  });
});

describe('stacks (review finding: a crash record without its stack explains nothing)', () => {
  it('logFatal carries the stack', () => {
    const e = new Error('render failed');
    logFatal('panel', e);
    expect(error.mock.calls[0]?.[0]).toBe(`[FATAL] panel crashed: ${e.stack}`);
  });

  it('logCaught writes the message at warn and the stack at debug', () => {
    const e = new Error('EACCES');
    logCaught('config-store: read', e);
    expect(warn.mock.calls[0]?.[0]).toBe('config-store: read: EACCES');
    expect(debug.mock.calls[0]?.[0]).toBe(`config-store: read: stack: ${e.stack}`);
  });

  it('describeError is the one renderer of a caught value', () => {
    expect(describeError(new Error('x'))).toBe('x');
    expect(describeError('plain')).toBe('plain');
  });
});

describe('logAt — one router from a level to the console', () => {
  it('sends each level to its console method, fatal marked for the file logger', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logAt('fatal', 'a');
    logAt('error', 'b');
    logAt('warn', 'c');
    logAt('info', 'd');
    logAt('debug', 'e');
    expect(error.mock.calls.map((c) => c[0])).toEqual(['[FATAL] a', 'b']);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['c']);
    expect(info.mock.calls.map((c) => c[0])).toEqual(['d']);
    expect(debug.mock.calls.map((c) => c[0])).toEqual(['e']);
  });
});

describe('none of them can throw on a hostile error', () => {
  it('handles a non-Error, a circular object and a throwing getter', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const hostile = {
      get message(): string {
        throw new Error('getter');
      },
    };
    for (const bad of ['plain string', 42, null, undefined, circular, hostile]) {
      expect(() => logCaught('w', bad)).not.toThrow();
      expect(() => logExpected('w', 'r', bad)).not.toThrow();
      expect(() => logFatal('c', bad)).not.toThrow();
    }
    expect(warn.mock.calls[0]?.[0]).toBe('w: plain string');
  });
});
