import { describe, expect, it, vi } from 'vitest';
import { restartIntoInstalledCopy, WAIT_THEN_START, type RestartDeps, type StartedProcess } from '../../src/main/restart-installed-copy.js';

const copy = { version: '2.0.0', launcher: '/opt/throng-versions/current/throng' };

function setup(platform: NodeJS.Platform) {
  let fail: ((error: Error) => void) | undefined;
  const started: StartedProcess = { on: (_event, listener) => (fail = listener), unref: vi.fn() };
  const deps = {
    platform,
    pid: 4242,
    relaunch: vi.fn(),
    quit: vi.fn(),
    spawnDetached: vi.fn(() => started),
    log: vi.fn(),
  } satisfies RestartDeps;
  return { deps, started, failSpawn: (error: Error) => fail?.(error) };
}

describe('Restart into the installed copy (063 FR-010, #610)', () => {
  it('on Linux starts the launcher itself, waiting for this process, and never relaunches through Electron', () => {
    const { deps, started } = setup('linux');
    restartIntoInstalledCopy(copy, deps);
    expect(deps.spawnDetached).toHaveBeenCalledWith('/bin/sh', ['-c', WAIT_THEN_START, 'throng-restart', '4242', copy.launcher]);
    expect(started.unref).toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(deps.quit).toHaveBeenCalledTimes(1);
  });

  it('falls back to Electron on Linux when the shell cannot be started, and logs why', () => {
    const { deps, failSpawn } = setup('linux');
    restartIntoInstalledCopy(copy, deps);
    failSpawn(new Error('ENOENT'));
    expect(deps.relaunch).toHaveBeenCalledWith(copy.launcher);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('keeps Electron relaunch everywhere else', () => {
    const { deps } = setup('win32');
    restartIntoInstalledCopy(copy, deps);
    expect(deps.relaunch).toHaveBeenCalledWith(copy.launcher);
    expect(deps.spawnDetached).not.toHaveBeenCalled();
    expect(deps.quit).toHaveBeenCalledTimes(1);
  });
});
