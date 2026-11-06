/**
 * 066 FR-009/FR-009a (T027) — the renderer reports its own failures to the diagnostics log.
 *
 * A throw from an event handler or a timer, and a promise nobody awaited, reach the window as `error` and
 * `unhandledrejection`; neither tears a panel down, so they are logged at ERROR. A render that React could
 * not recover is the root's `onUncaughtError`: the window is gone, so it is FATAL (research R5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWindowErrorListeners, rootErrorOptions } from '../../src/renderer/error-hooks.js';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug';
const log = vi.fn<(level: Level, component: string, message: string) => void>();
let uninstall: () => void = () => undefined;

beforeEach(() => {
  log.mockClear();
  (window as unknown as { throng: unknown }).throng = { diagnostics: { log } };
  uninstall = installWindowErrorListeners();
});

afterEach(() => {
  uninstall();
  delete (window as unknown as { throng?: unknown }).throng;
});

describe('renderer error hooks (066 T027)', () => {
  it('a window error event reaches diagnostics.log at error, with the message', () => {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('handler blew up'), message: 'handler blew up' }));
    expect(log).toHaveBeenCalledTimes(1);
    const [level, component, message] = log.mock.calls[0];
    expect(level).toBe('error');
    expect(component).toBe('renderer');
    expect(message).toContain('handler blew up');
  });

  it('an unhandledrejection reaches diagnostics.log at error, with the reason', () => {
    const event = new Event('unhandledrejection');
    Object.assign(event, { reason: new Error('nobody awaited me') });
    window.dispatchEvent(event);
    expect(log).toHaveBeenCalledTimes(1);
    const [level, , message] = log.mock.calls[0];
    expect(level).toBe('error');
    expect(message).toContain('nobody awaited me');
  });

  it('a non-Error rejection reason is still written', () => {
    const event = new Event('unhandledrejection');
    Object.assign(event, { reason: 'plain string reason' });
    window.dispatchEvent(event);
    expect(log.mock.calls[0][2]).toContain('plain string reason');
  });

  it("the root's onUncaughtError reaches diagnostics.log at fatal, with the component stack", () => {
    rootErrorOptions.onUncaughtError(new Error('render threw'), { componentStack: '\n    at Broken' });
    expect(log).toHaveBeenCalledTimes(1);
    const [level, component, message] = log.mock.calls[0];
    expect(level).toBe('fatal');
    expect(component).toBe('renderer');
    expect(message).toContain('render threw');
    expect(message).toContain('at Broken');
  });

  it("the root's onRecoverableError is a warning, and onCaughtError a debug breadcrumb (the boundary reports itself)", () => {
    rootErrorOptions.onRecoverableError(new Error('recovered'));
    rootErrorOptions.onCaughtError(new Error('caught'));
    expect(log.mock.calls.map((c) => c[0])).toEqual(['warn', 'debug']);
  });

  it('removes its listeners when uninstalled', () => {
    uninstall();
    // jsdom reports an unprevented window error to the test runner as an uncaught exception.
    const swallow = (e: Event): void => e.preventDefault();
    window.addEventListener('error', swallow);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after'), message: 'after', cancelable: true }));
    window.removeEventListener('error', swallow);
    expect(log).not.toHaveBeenCalled();
  });

  it('falls back to the console, and never throws, when the bridge is absent', () => {
    delete (window as unknown as { throng?: unknown }).throng;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => rootErrorOptions.onUncaughtError(new Error('no bridge'))).not.toThrow();
    // The prefix main's console forwarder maps back to fatal — anything else downgrades a crash to error.
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/^\[FATAL\] renderer: /);
    spy.mockRestore();
  });
});
