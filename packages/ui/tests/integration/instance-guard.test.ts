import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { connect } from 'node:net';
import { formatLaunchMessage, instanceLockName, type DifferentCopyNotice, type LaunchMessage } from '@throng/core';
import {
  createInstanceGuard,
  type InstanceGuard,
  type InstanceGuardDeps,
  type LegacyInstanceLock,
} from '../../src/main/instance-guard.js';

/**
 * 058 FR-018 / FR-018b — one running throng per user (contracts/instance-lock.md, research D5).
 *
 * Layer: integration — the lock IS the OS named pipe's first-instance exclusivity (`EADDRINUSE` from a
 * second `listen`) and the launch message crosses a real pipe; no fake can show either. Electron's
 * lock and the window/notice sinks are injected, because what they do is not under test here.
 */

let seq = 0;
function freshNamespace(): string {
  seq += 1;
  return `\\\\.\\pipe\\throng-guard-test-${process.pid}-${Date.now()}-${seq}`;
}

interface Harness {
  guard: InstanceGuard;
  bringForward: ReturnType<typeof vi.fn<(launch: LaunchMessage) => void>>;
  showNotice: ReturnType<typeof vi.fn<(notice: DifferentCopyNotice) => void>>;
  legacy: LegacyInstanceLock & {
    request: ReturnType<typeof vi.fn<() => boolean>>;
    fireSecondInstance(argv: readonly string[]): void;
  };
}

const guards: InstanceGuard[] = [];
afterEach(async () => {
  for (const g of guards.splice(0)) await g.release();
});

function harness(
  namespace: string,
  execPath: string,
  opts: {
    version?: string;
    legacyLockHeld?: boolean;
    connect?: InstanceGuardDeps['connect'];
    logs?: string[];
  } = {},
): Harness {
  let secondInstance: ((argv: readonly string[]) => void) | undefined;
  const legacy = {
    request: vi.fn<() => boolean>(() => opts.legacyLockHeld ?? true),
    onSecondInstance: (listener: (argv: readonly string[]) => void) => {
      secondInstance = listener;
    },
    fireSecondInstance: (argv: readonly string[]) => secondInstance?.(argv),
  };
  const bringForward = vi.fn<(launch: LaunchMessage) => void>();
  const showNotice = vi.fn<(notice: DifferentCopyNotice) => void>();
  const deps: InstanceGuardDeps = {
    lockName: instanceLockName(namespace),
    self: { execPath, version: opts.version ?? '1.0.0' },
    legacyLock: legacy,
    bringForward,
    showDifferentCopyNotice: showNotice,
    log: (message) => opts.logs?.push(message),
    ...(opts.connect ? { connect: opts.connect } : {}),
  };
  const guard = createInstanceGuard(deps);
  guards.push(guard);
  return { guard, bringForward, showNotice, legacy };
}

describe('instance guard (058 FR-018)', () => {
  it('the first launch in a namespace becomes primary and holds the legacy lock too', async () => {
    const ns = freshNamespace();
    const a = harness(ns, 'C:\\Program Files\\throng\\throng.exe');
    expect(await a.guard.acquire()).toBe('primary');
    expect(a.legacy.request).toHaveBeenCalledOnce();
  });

  it('a second launch of the same copy delivers its message, is secondary, and only brings the window forward', async () => {
    const ns = freshNamespace();
    const a = harness(ns, 'C:\\Program Files\\throng\\throng.exe');
    await a.guard.acquire();

    const b = harness(ns, 'c:\\program files\\THRONG\\throng.exe', { version: '1.0.0' });
    expect(await b.guard.acquire()).toBe('secondary');
    // The losing launch never reaches for Electron's lock: it would steal `second-instance`.
    expect(b.legacy.request).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(a.bringForward).toHaveBeenCalledOnce(), { timeout: 2000 });
    expect(a.bringForward).toHaveBeenCalledWith({
      execPath: 'c:\\program files\\THRONG\\throng.exe',
      version: '1.0.0',
    });
    expect(a.showNotice).not.toHaveBeenCalled();
  });

  it('a launch of a different copy also raises the different-copy notice, naming the running copy', async () => {
    const ns = freshNamespace();
    const a = harness(ns, 'C:\\Program Files\\throng\\throng.exe', { version: '1.4.0' });
    await a.guard.acquire();

    const b = harness(ns, 'D:\\portable\\throng\\throng.exe', { version: '1.5.0' });
    expect(await b.guard.acquire()).toBe('secondary');

    await vi.waitFor(() => expect(a.showNotice).toHaveBeenCalledOnce(), { timeout: 2000 });
    expect(a.bringForward).toHaveBeenCalledOnce();
    expect(a.showNotice).toHaveBeenCalledWith({
      runningRoot: 'C:\\Program Files\\throng',
      runningVersion: '1.4.0',
      launchedRoot: 'D:\\portable\\throng',
    });
  });

  it('a different namespace is independent', async () => {
    const a = harness(freshNamespace(), 'C:\\Program Files\\throng\\throng.exe');
    const b = harness(freshNamespace(), 'C:\\Program Files\\throng\\throng.exe');
    expect(await a.guard.acquire()).toBe('primary');
    expect(await b.guard.acquire()).toBe('primary');
    expect(a.bringForward).not.toHaveBeenCalled();
  });

  it('a primary that cannot take the legacy lock yields to the older copy and releases the pipe', async () => {
    const ns = freshNamespace();
    const a = harness(ns, 'C:\\Program Files\\throng\\throng.exe', { legacyLockHeld: false });
    expect(await a.guard.acquire()).toBe('yields-to-legacy');

    // Released: the next launch in the namespace is primary rather than delivering to nobody.
    const b = harness(ns, 'C:\\Program Files\\throng\\throng.exe');
    expect(await b.guard.acquire()).toBe('primary');
  });

  it('a second-instance event from a pre-058 copy is a different-copy launch with no version', async () => {
    const ns = freshNamespace();
    const a = harness(ns, 'C:\\Program Files\\throng\\throng.exe', { version: '1.4.0' });
    await a.guard.acquire();

    a.legacy.fireSecondInstance(['C:\\Users\\u\\AppData\\Local\\Programs\\throng\\throng.exe', '--flag']);

    expect(a.bringForward).toHaveBeenCalledWith({
      execPath: 'C:\\Users\\u\\AppData\\Local\\Programs\\throng\\throng.exe',
      version: null,
    });
    expect(a.showNotice).toHaveBeenCalledWith({
      runningRoot: 'C:\\Program Files\\throng',
      runningVersion: '1.4.0',
      launchedRoot: 'C:\\Users\\u\\AppData\\Local\\Programs\\throng',
    });
  });

  /*
   * Review A1. An instance started "as administrator" holds the pipe at high integrity, and a normal
   * launch is refused when it connects (EPERM / EACCES). That launch must still not start a second
   * instance (constitution, Single instance) — but nothing comes forward, so it must SAY so rather
   * than quit silently, and the log must not claim the running instance was told.
   */
  it.each(['EPERM', 'EACCES'])(
    'a running instance the launch may not reach (%s — an elevated one) resolves unreachable, not delivered',
    async (code) => {
      const ns = freshNamespace();
      const a = harness(ns, 'C:\\Program Files\\throng\\throng.exe');
      await a.guard.acquire();

      const refused = (): ReturnType<NonNullable<InstanceGuardDeps['connect']>> => {
        const socket = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
        socket.end = () => undefined;
        socket.destroy = () => undefined;
        setImmediate(() => socket.emit('error', Object.assign(new Error(code), { code })));
        return socket;
      };
      const logs: string[] = [];
      const b = harness(ns, 'C:\\Program Files\\throng\\throng.exe', { connect: refused, logs });

      expect(await b.guard.acquire()).toBe('unreachable');
      expect(b.legacy.request).not.toHaveBeenCalled();
      expect(a.bringForward).not.toHaveBeenCalled();
      expect(logs.join('\n')).toMatch(/administrator/);
      expect(logs.join('\n')).not.toMatch(/told the running instance/);
    },
  );

  it('a malformed line on the pipe is ignored, and the primary keeps listening', async () => {
    const ns = freshNamespace();
    const a = harness(ns, 'C:\\Program Files\\throng\\throng.exe');
    await a.guard.acquire();

    await new Promise<void>((resolve, reject) => {
      const socket = connect(instanceLockName(ns));
      socket.on('error', reject);
      socket.on('close', () => resolve());
      socket.end('not a launch\n');
    });
    expect(a.bringForward).not.toHaveBeenCalled();

    // Still answering: a well-formed message written straight to the pipe (as the E2E does) lands.
    await new Promise<void>((resolve, reject) => {
      const socket = connect(instanceLockName(ns));
      socket.on('error', reject);
      socket.on('close', () => resolve());
      socket.end(formatLaunchMessage({ execPath: 'E:\\other\\throng.exe', version: '9.9.9' }));
    });
    await vi.waitFor(() => expect(a.showNotice).toHaveBeenCalledOnce(), { timeout: 2000 });
  });
});
