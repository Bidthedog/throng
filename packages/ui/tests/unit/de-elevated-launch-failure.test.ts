import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShellActionResult } from '@throng/core';
import {
  DE_ELEVATED_LAUNCH_REPORT_MS,
  ElectronShellIntegration,
  type DeElevatingLauncher,
  type ElectronShellLike,
} from '../../src/main/electron-shell-integration.js';

/**
 * 045 FR-036 / FR-038, review round four (M3) — **a de-elevated launch that FAILS must say so.**
 *
 * ══ WHAT THE USER SEES WITHOUT THIS ══
 *
 * throng running as administrator. Ctrl+click a file link. `deElevate` handed the work to
 * `WindowsDeElevatedLauncher.launch(file, args)` — dropping the third argument, the `report`
 * callback that 019 FR-015 added precisely so a failed launch is distinguishable from a slow one —
 * and then returned `true`. All three call sites read that as success: `{ ok: true }`, `{ ok: true }`
 * and a bare `return`. So `FileLinkResolver.act` sees `ok`, `follow` answers `revealed`, and the
 * renderer raises nothing. No Explorer window, no notice, nothing in the UI. Every time.
 *
 * CI structurally cannot see it: under `THRONG_E2E_CLIPBOARD=memory` the harness substitutes a
 * launcher whose `isAvailable()` is `false`, so every harness run takes the Electron route.
 *
 * ══ WHY THERE IS A WINDOW RATHER THAN AN AWAIT ══
 *
 * The launcher is fire-and-forget by design (the shim starts the target and exits), and its
 * `report` fires only on FAILURE — there is no success signal to wait for. So the action holds its
 * answer for `DE_ELEVATED_LAUNCH_REPORT_MS` and treats silence as success. That delay costs the user
 * nothing: the Explorer window is already on screen by then, and a successful outcome is one the
 * renderer draws nothing for.
 */

const REASON = 'CreateProcessWithTokenW failed: 1314';

function subject(launch: DeElevatingLauncher['launch']) {
  const direct: string[] = [];
  const shell: ElectronShellLike = {
    showItemInFolder: (p) => void direct.push(`reveal:${p}`),
    openPath: async (p) => {
      direct.push(`open:${p}`);
      return '';
    },
    openExternal: async () => {},
  };
  const integration = new ElectronShellIntegration(shell, async () => 'file', {
    launcher: { isAvailable: () => true, launch },
    isElevated: () => true,
  });
  return { integration, direct };
}

/** The launcher the shim's failure path produces: `report` called, nothing else. */
const failing: DeElevatingLauncher['launch'] = (_file, _args, report) => report?.(REASON);
/** A launch that works: fire-and-forget, and `report` is never called. */
const succeeding: DeElevatingLauncher['launch'] = () => {};

/** What `running` answered once `ms` of fake time passed, or `'pending'` — never a hang. */
async function outcomeAfter<T>(running: Promise<T>, ms: number): Promise<T | 'pending'> {
  let settled: { value: T } | undefined;
  void running.then((value) => {
    settled = { value };
  });
  await vi.advanceTimersByTimeAsync(ms);
  return settled === undefined ? 'pending' : settled.value;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('M3 — a failed de-elevated launch is a refusal carrying the OS\u2019s words', () => {
  it('revealInFileManager answers { ok: false, osReason }, not { ok: true }', async () => {
    const { integration, direct } = subject(failing);

    const result = await outcomeAfter(integration.revealInFileManager('D:\\p\\notes.txt'), 0);

    expect(result, 'the report arrives at once, so the answer does too').toMatchObject({ ok: false });
    expect((result as { osReason: string }).osReason).toContain(REASON);
    expect((result as { osReason: string }).osReason).toContain('D:\\p\\notes.txt');
    expect(direct, 'and the elevated host still never touched Electron\u2019s shell').toEqual([]);
  });

  it('openWithDefaultProgram answers { ok: false, osReason }, not { ok: true }', async () => {
    const { integration, direct } = subject(failing);

    const result = await outcomeAfter(integration.openWithDefaultProgram('D:\\p\\notes.txt'), 0);

    expect(result).toMatchObject({ ok: false });
    expect((result as { osReason: string }).osReason).toContain(REASON);
    expect(direct).toEqual([]);
  });

  it('openFolder rejects with the OS\u2019s words \u2014 its only failure channel', async () => {
    const { integration } = subject(failing);
    const thrown: string[] = [];

    await outcomeAfter(
      integration.openFolder('D:\\p\\sub').catch((error: unknown) => {
        thrown.push(error instanceof Error ? error.message : String(error));
      }),
      0,
    );

    expect(thrown.join(''), 'so `FileLinkResolver.act` converts it to one refused notice').toContain(REASON);
  });

  it('a launch that does NOT report is success \u2014 held for the report window, then answered', async () => {
    const { integration } = subject(succeeding);
    const running = integration.revealInFileManager('D:\\p\\notes.txt');

    expect(await outcomeAfter(running, DE_ELEVATED_LAUNCH_REPORT_MS - 1), 'silence is not yet success').toBe(
      'pending',
    );
    expect(await outcomeAfter(running, 1)).toEqual({ ok: true } satisfies ShellActionResult);
  });

  it('the `report` callback is actually handed to the launcher', async () => {
    const seen: boolean[] = [];
    const { integration } = subject((_file, _args, report) => void seen.push(report !== undefined));

    void integration.revealInFileManager('D:\\p\\notes.txt');
    await vi.advanceTimersByTimeAsync(DE_ELEVATED_LAUNCH_REPORT_MS);

    expect(seen, 'dropping it is what made a failed launch look like a success').toEqual([true]);
  });
});
