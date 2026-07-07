import { describe, it, expect, vi } from 'vitest';
import { acquireSingleInstance, type SingleInstanceApp } from '../../src/main/single-instance.js';

function fakeApp(lock: boolean): SingleInstanceApp & { quit: ReturnType<typeof vi.fn>; handlers: (() => void)[] } {
  const handlers: (() => void)[] = [];
  return {
    requestSingleInstanceLock: () => lock,
    quit: vi.fn(),
    handlers,
    on: (_e, listener) => {
      handlers.push(listener);
    },
  };
}

describe('acquireSingleInstance', () => {
  it('is primary when the lock is acquired and registers a second-instance handler', () => {
    const app = fakeApp(true);
    const onSecond = vi.fn();
    expect(acquireSingleInstance(app, onSecond)).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.handlers).toHaveLength(1);
    app.handlers[0]();
    expect(onSecond).toHaveBeenCalledOnce();
  });

  it('quits and reports non-primary when the lock is already held', () => {
    const app = fakeApp(false);
    const onSecond = vi.fn();
    expect(acquireSingleInstance(app, onSecond)).toBe(false);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.handlers).toHaveLength(0);
  });
});
