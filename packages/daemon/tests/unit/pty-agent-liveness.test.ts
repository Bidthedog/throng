import { describe, it, expect } from 'vitest';
import { probeErrorMeansDaemonGone } from '../../src/pty-agent-liveness.js';

/**
 * The #94 regression guard. Before this, the agent's watchDaemon `catch` treated ANY
 * `process.kill(pid, 0)` throw as "daemon gone" — so a medium-integrity agent probing
 * its elevated daemon shut itself down on the EPERM it ALWAYS gets across the integrity
 * boundary. Only ESRCH may mean death.
 */
describe('probeErrorMeansDaemonGone (#94 — the de-elevated liveness probe)', () => {
  it('treats ESRCH as the daemon being gone', () => {
    // No such process — a genuinely dead daemon (incl. a hard-killed one whose pid was freed).
    expect(probeErrorMeansDaemonGone(Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' }))).toBe(
      true,
    );
  });

  it('treats EPERM as ALIVE — this is the #94 bug: a medium agent probing an elevated daemon', () => {
    // The daemon process EXISTS; Windows just forbids the medium agent from signalling it.
    // Misreading this as death is what killed de-elevated terminals ~3s after connecting.
    expect(probeErrorMeansDaemonGone(Object.assign(new Error('kill EPERM'), { code: 'EPERM' }))).toBe(
      false,
    );
  });

  it('does not treat an unknown or absent error code as death', () => {
    expect(probeErrorMeansDaemonGone(Object.assign(new Error('weird'), { code: 'EFOO' }))).toBe(false);
    expect(probeErrorMeansDaemonGone(new Error('no code'))).toBe(false);
    expect(probeErrorMeansDaemonGone(undefined)).toBe(false);
    expect(probeErrorMeansDaemonGone(null)).toBe(false);
  });
});
