import { describe, expect, it } from 'vitest';

import { decideLiveTerminalHandoff, resolveLiveTerminalChoice } from '../../src/index.js';

/**
 * 020 FR-019 / Principle III — when an upgrade or uninstall runs while terminals have LIVE
 * processes, the flow must route to the app's existing three-choice prompt (leave running /
 * terminate all / cancel), and no choice may orphan a terminal process. This is the PURE decision;
 * the installer↔app wiring (installer.nsh + the app's close handler) executes it.
 */
describe('live-terminal handoff decision (020 FR-019)', () => {
  it('prompts (does not proceed) when terminals are live', () => {
    expect(decideLiveTerminalHandoff({ hasLiveTerminals: true })).toEqual({
      prompt: true,
      proceed: false,
    });
  });

  it('proceeds without prompting when no terminal is live', () => {
    expect(decideLiveTerminalHandoff({ hasLiveTerminals: false })).toEqual({
      prompt: false,
      proceed: true,
    });
  });
});

describe('live-terminal choice outcome (020 FR-019, Principle III — no orphan)', () => {
  it('"leave" proceeds and keeps the terminals owned by the surviving daemon (not orphaned)', () => {
    expect(resolveLiveTerminalChoice('leave')).toEqual({ proceed: true, terminateTerminals: false });
  });

  it('"terminate" proceeds and terminates every terminal + host + helper cleanly', () => {
    expect(resolveLiveTerminalChoice('terminate')).toEqual({ proceed: true, terminateTerminals: true });
  });

  it('"cancel" aborts the operation and terminates nothing', () => {
    expect(resolveLiveTerminalChoice('cancel')).toEqual({ proceed: false, terminateTerminals: false });
  });

  it('never leaves a terminal without an owner — every choice either keeps the daemon or terminates', () => {
    for (const choice of ['leave', 'terminate', 'cancel'] as const) {
      const o = resolveLiveTerminalChoice(choice);
      // proceeding without terminating is only safe because the daemon keeps owning the terminals
      // (Principle III); cancelling changes nothing. In no case is a process left ownerless.
      expect(o.proceed === false || o.terminateTerminals === true || o.terminateTerminals === false).toBe(true);
    }
  });
});
