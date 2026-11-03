import { configureHostTraits, hostTraits, linuxHostTraits } from '@throng/core';
import { skipUnlessWindows } from '@throng/core/testing';
import { describe, expect, it } from 'vitest';

import { resolveDaemonNodeExe } from '../../src/main/daemon-lifecycle.js';

/**
 * 020 FR-009 — a packaged install spawns the daemon with its BUNDLED host-Node runtime, not a
 * `node` on PATH (there may be none). In dev/tests there is no `resourcesPath`, so the resolver
 * falls through to the host Node that launched the app.
 */
describe('resolveDaemonNodeExe (020 FR-009)', () => {
  it.skipIf(skipUnlessWindows('the bundled runtime is node.exe, inside a Windows install'))('uses the bundled runtime when packaged and it exists', () => {
    const resolved = resolveDaemonNodeExe(
      undefined,
      'C:\\Program Files\\throng\\resources',
      (p) => p.endsWith('runtime\\node.exe'),
      {},
    );
    expect(resolved).toBe('C:\\Program Files\\throng\\resources\\runtime\\node.exe');
  });

  it('uses the bundled node when packaged on Linux (063 FR-002)', () => {
    const before = hostTraits();
    configureHostTraits(linuxHostTraits('/run/user/1000'));
    try {
      const resolved = resolveDaemonNodeExe(undefined, '/opt/throng-versions/1.0.0/resources', (p) => p.endsWith('runtime/node'), {});
      expect(resolved.replace(/\\/g, '/')).toBe('/opt/throng-versions/1.0.0/resources/runtime/node');
    } finally {
      configureHostTraits(before);
    }
  });

  it('an explicit nodePath always wins (tests)', () => {
    const resolved = resolveDaemonNodeExe('C:\\node\\node.exe', 'C:\\res', () => true, {});
    expect(resolved).toBe('C:\\node\\node.exe');
  });

  it('falls through to the host npm node when NOT packaged (no resourcesPath)', () => {
    const resolved = resolveDaemonNodeExe(undefined, undefined, () => true, {
      npm_node_execpath: 'C:\\hostnode\\node.exe',
    });
    expect(resolved).toBe('C:\\hostnode\\node.exe');
  });

  it('falls through to PATH `node` when packaged but the bundled runtime is missing', () => {
    const resolved = resolveDaemonNodeExe(undefined, 'C:\\res', () => false, {});
    expect(resolved).toBe('node');
  });
});
