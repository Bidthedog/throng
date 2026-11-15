/**
 * The Install and Uninstall 'throng' command actions, main's half (070 FR-024a, research R20): ask before replacing
 * another program's `throng`, report one outcome per action, and say once at start when the installed command no
 * longer reaches throng. The seam is faked; the real one is `platform`'s.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CommandLineStatus, ICommandLineInstall } from '@throng/core';
import {
  COMMAND_LINE_INSTALL_CHANNEL,
  COMMAND_LINE_OUTCOME_CHANNEL,
  COMMAND_LINE_READY_CHANNEL,
  COMMAND_LINE_UNINSTALL_CHANNEL,
  createCommandLineInstallController,
  createOutcomeRelay,
  type CommandLineOutcome,
} from '../../src/main/command-line-install-ipc.js';

const LINK = '/usr/local/bin/throng';
const OURS: CommandLineStatus = { kind: 'ours', linkPath: LINK };
const OTHER: CommandLineStatus = { kind: 'other', linkPath: LINK, target: '/opt/other/throng' };

function seam(start: CommandLineStatus, overrides: Partial<ICommandLineInstall> = {}): ICommandLineInstall {
  let state = start;
  return {
    available: true,
    status: vi.fn(async () => state),
    install: vi.fn(async () => {
      state = OURS;
      return state;
    }),
    uninstall: vi.fn(async () => {
      state = state.kind === 'ours' || state.kind === 'ours-broken' ? { kind: 'absent' } : state;
      return state;
    }),
    ...overrides,
  };
}

function controller(s: ICommandLineInstall, confirm = true) {
  const outcomes: CommandLineOutcome[] = [];
  const confirmReplace = vi.fn(async () => confirm);
  const c = createCommandLineInstallController({ seam: s, confirmReplace, report: (o) => outcomes.push(o) });
  return { c, outcomes, confirmReplace };
}

describe('install', () => {
  it('installs where nothing has the name, and says where the command now is', async () => {
    const s = seam({ kind: 'absent' });
    const { c, outcomes, confirmReplace } = controller(s);
    await c.install();
    expect(s.install).toHaveBeenCalledWith({ replaceOther: false });
    expect(confirmReplace).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ kind: 'installed', linkPath: LINK }]);
  });

  it('asks before replacing a `throng` that points somewhere else, and replaces only on a yes', async () => {
    const yes = controller(seam(OTHER), true);
    await yes.c.install();
    expect(yes.confirmReplace).toHaveBeenCalledWith({ linkPath: LINK, target: '/opt/other/throng' });
    expect(yes.outcomes).toEqual([{ kind: 'installed', linkPath: LINK }]);

    const s = seam(OTHER);
    const no = controller(s, false);
    await no.c.install();
    expect(s.install).not.toHaveBeenCalled();
    // The user's own No: nothing went wrong, so nothing is reported.
    expect(no.outcomes).toEqual([]);
  });

  it('reports a declined approval or a failure once, with the reason', async () => {
    const s = seam({ kind: 'absent' }, { install: vi.fn(async () => Promise.reject(new Error('The administrator approval was declined.'))) });
    const { c, outcomes } = controller(s);
    await c.install();
    expect(outcomes).toEqual([{ kind: 'failed', action: 'install', reason: 'The administrator approval was declined.' }]);
  });

  it('runs one install at a time, so a second click while the prompt is up does nothing', async () => {
    let release: (v: CommandLineStatus) => void = () => undefined;
    const s = seam({ kind: 'absent' }, { install: vi.fn(() => new Promise<CommandLineStatus>((r) => (release = r))) });
    const { c, outcomes } = controller(s);
    const first = c.install();
    await c.install();
    release(OURS);
    await first;
    expect(s.install).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([{ kind: 'installed', linkPath: LINK }]);
  });
});

describe('uninstall', () => {
  it('removes throng’s own command and says so', async () => {
    const { c, outcomes } = controller(seam(OURS));
    await c.uninstall();
    expect(outcomes).toEqual([{ kind: 'uninstalled', linkPath: LINK }]);
  });

  it('leaves another program’s `throng` alone, and says why', async () => {
    const { c, outcomes } = controller(seam(OTHER));
    await c.uninstall();
    expect(outcomes).toEqual([
      { kind: 'failed', action: 'uninstall', reason: `${LINK} points at /opt/other/throng, not throng, so it was left alone.` },
    ]);
  });

  it('reports a failure with its reason', async () => {
    const s = seam(OURS, { uninstall: vi.fn(async () => Promise.reject(new Error('Operation not permitted'))) });
    const { c, outcomes } = controller(s);
    await c.uninstall();
    expect(outcomes).toEqual([{ kind: 'failed', action: 'uninstall', reason: 'Operation not permitted' }]);
  });
});

describe('at start', () => {
  it('says once that an installed command no longer reaches throng', async () => {
    const broken: CommandLineStatus = { kind: 'ours-broken', linkPath: LINK, target: '/Volumes/old/throng.app/Contents/Resources/bin/throng' };
    const { c, outcomes } = controller(seam(broken));
    await c.checkAtStart();
    expect(outcomes).toEqual([{ kind: 'broken', linkPath: LINK, target: broken.target }]);
  });

  it.each([{ kind: 'absent' } as const, OURS, OTHER])('says nothing when the command is $kind', async (status) => {
    const { c, outcomes } = controller(seam(status));
    await c.checkAtStart();
    expect(outcomes).toEqual([]);
  });

  it('says nothing, and asks nothing, where the platform cannot install the command', async () => {
    const s = seam({ kind: 'absent' }, { available: false });
    const { c, outcomes } = controller(s);
    await c.checkAtStart();
    expect(s.status).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });
});

describe('the preload spells the same channels', () => {
  it('names every channel main listens and sends on', () => {
    const preload = readFileSync(new URL('../../src/preload/preload.cts', import.meta.url), 'utf8');
    for (const channel of [
      COMMAND_LINE_INSTALL_CHANNEL,
      COMMAND_LINE_UNINSTALL_CHANNEL,
      COMMAND_LINE_READY_CHANNEL,
      COMMAND_LINE_OUTCOME_CHANNEL,
    ]) {
      expect(preload, channel).toContain(`'${channel}'`);
    }
  });
});

describe('createOutcomeRelay', () => {
  it('holds outcomes until the window is listening, then delivers them in order and later ones at once', () => {
    const relay = createOutcomeRelay();
    const sent: unknown[] = [];
    relay.report({ kind: 'uninstalled', linkPath: LINK });
    relay.attach({ send: (_channel: string, o: unknown) => sent.push(o), isDestroyed: () => false });
    expect(sent).toEqual([{ kind: 'uninstalled', linkPath: LINK }]);
    relay.report({ kind: 'installed', linkPath: LINK });
    expect(sent).toHaveLength(2);
  });
});
