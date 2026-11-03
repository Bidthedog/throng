import { describe, expect, it, vi } from 'vitest';
import type { InstalledCopy } from '@throng/core';
import { createInstalledVersionMonitor } from '../../src/main/installed-version-monitor.js';

function setup(installed: () => InstalledCopy | null) {
  const show = vi.fn();
  return { show, monitor: createInstalledVersionMonitor({ runningVersion: '1.0.0', probe: { installed }, show }) };
}
const copy = (version: string): InstalledCopy => ({ version, launcher: '/opt/throng-versions/current/throng' });

describe('the installed-version monitor (063 FR-010)', () => {
  it('says nothing when the running copy is the installed one', () => {
    const { monitor, show } = setup(() => copy('1.0.0'));
    monitor.check();
    expect(show).not.toHaveBeenCalled();
  });

  it('says nothing when there is no package to compare with', () => {
    const { monitor, show } = setup(() => null);
    monitor.check();
    expect(show).not.toHaveBeenCalled();
  });

  it('reports one installed version once, however often it is asked', () => {
    const { monitor, show } = setup(() => copy('1.1.0'));
    monitor.check();
    monitor.check();
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith({ runningVersion: '1.0.0', installedVersion: '1.1.0' });
  });

  it('reports again when a later upgrade changes what is installed', () => {
    let version = '1.1.0';
    const { monitor, show } = setup(() => copy(version));
    monitor.check();
    version = '1.2.0';
    monitor.check();
    expect(show).toHaveBeenCalledTimes(2);
  });
});
