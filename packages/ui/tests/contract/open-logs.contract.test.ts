import { describe, expect, it, vi } from 'vitest';
import { openLogsFolder } from '../../src/main/open-logs.js';

/**
 * The `throng:diagnostics:openLogs` contract (#123).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/diagnostics-logging.e2e.ts:123` (035 T056) — `test('a user
 * can reach the logs folder without knowing its path')`.
 *
 * ══ THE TEST WAS THREE CLAIMS, AND TWO ALREADY HAD HOMES ══
 *
 *   the cog menu OFFERS it, with that test id and that icon
 *     → `unit/menu-sections.test.ts:562` (the whole cog menu, in order) and
 *       `unit/menu-icon-tokens.test.ts:221`
 *   the folder it names is THIS run's log directory, and the OS is really asked to open it
 *     → here
 *   an in-app viewer is not offered
 *     → the issue rules one out; nothing renders one, and the menu list above is exhaustive
 *
 * ══ WHY THE HANDLER MOVED OUT OF `main.ts` ══
 *
 * It was four lines inside an `ipcMain.handle`, so the only thing that could observe it was an app.
 * `openLogsFolder` takes its two collaborators as parameters (035 FR-006), which is also what makes
 * the failure path reachable at all — `shell.openPath` cannot be made to fail on demand from
 * outside, and the migrated test therefore asserted only the success half.
 *
 * ══ THE INVERTED SIGNAL ══
 *
 * `shell.openPath` resolves to an EMPTY STRING on success and to a message on failure; it does not
 * reject. Getting that the wrong way round is silent — every open reports failure while working, or
 * every failure reports success — so both directions are asserted below rather than the happy one.
 */

const diagnostics = (logDir: string) => ({
  logDir,
  log: { info: vi.fn() },
});

describe('opening the logs folder (#123)', () => {
  it('asks the OS to open THIS run’s log directory', async () => {
    const openPath = vi.fn(() => Promise.resolve(''));
    const d = diagnostics('C:/users/someone/AppData/throng-run-1/logs');

    await openLogsFolder(d, openPath);

    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith('C:/users/someone/AppData/throng-run-1/logs');
  });

  it('reports the path back, so the caller can say where it went', async () => {
    // The migrated test asserted this: a user who is told "your logs are open" and cannot find the
    // window has learnt nothing, so the answer names the folder.
    const openPath = vi.fn(() => Promise.resolve(''));

    const result = await openLogsFolder(diagnostics('C:/logs'), openPath);

    expect(result).toEqual({ ok: true, path: 'C:/logs' });
  });

  it('reports a REFUSAL rather than claiming success', async () => {
    /*
     * The half the E2E could not reach: `shell.openPath` cannot be made to fail on demand from
     * outside the process. An empty string means success and a message means failure, and a handler
     * that read the string as truthy would report failure on every successful open — or, inverted,
     * success on every failure, which is the one that leaves a user hunting for a window that was
     * never opened.
     */
    const openPath = vi.fn(() => Promise.resolve('Windows cannot find that folder.'));

    const result = await openLogsFolder(diagnostics('C:/gone'), openPath);

    expect(result).toEqual({ ok: false, error: 'Windows cannot find that folder.' });
  });

  it('records the request in the diagnostics it is about to open', async () => {
    // Small, and the reason is not: the log line is the only evidence, IN THE LOGS THE USER IS
    // ABOUT TO SEND, that they asked for them at all.
    const d = diagnostics('C:/logs');

    await openLogsFolder(d, () => Promise.resolve(''));

    expect(d.log.info).toHaveBeenCalledWith('opening the logs folder at the user request');
  });
});
