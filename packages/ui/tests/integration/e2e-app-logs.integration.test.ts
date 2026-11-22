import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appLogTails, keepAppLogs, userDataDirOf } from '../e2e/app-logs.js';

/**
 * The E2E harness's app-log evidence (the third 15 s shutdown stall, run 44889368543): when an app will not close, or a
 * test fails, the app's own `main.log` and `daemon.log` are the only record of what it was doing, and they live in its
 * user-data folder, which teardown deletes. Real files, so integration.
 */
const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'app-logs-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0));

function appWithLogs(files: Record<string, string>): string {
  const userData = scratch();
  mkdirSync(join(userData, 'logs'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(userData, 'logs', name), text);
  return userData;
}

describe('the app logs a stalled or failed E2E keeps', () => {
  it('reads the user-data folder from the arguments Electron was launched with', () => {
    expect(userDataDirOf(['/x/electron', '-r', 'main.js', '--user-data-dir=/tmp/run/throng-ud-1', '--foo'])).toBe('/tmp/run/throng-ud-1');
    expect(userDataDirOf(['/x/electron', 'main.js'])).toBeUndefined();
  });

  it("prints the last lines of main.log and daemon.log, each under its name, and nothing else in the folder", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const userData = appWithLogs({ 'main.log': `${lines}\n`, 'daemon.log': 'daemon up\ndaemon stopping\n', 'crash.json': '{}' });
    const report = appLogTails(userData, 3);
    expect(report).toContain('--- main.log (last 3 lines) ---\nline 48\nline 49\nline 50');
    expect(report).toContain('--- daemon.log (last 3 lines) ---\ndaemon up\ndaemon stopping');
    expect(report).not.toContain('line 47');
    expect(report).not.toContain('crash.json');
  });

  it('says so when the app left no logs, rather than printing nothing', () => {
    expect(appLogTails(scratch(), 3)).toMatch(/no app logs/);
  });

  it('copies only the logs out of the folder teardown deletes, each capped to its end', () => {
    const userData = appWithLogs({ 'main.log': `${'x'.repeat(1000)}END`, 'daemon.log': 'd', 'Cookies': 'not a log' });
    const dest = join(scratch(), 'app-logs');
    expect(keepAppLogs(userData, dest, 100).sort()).toEqual(['daemon.log', 'main.log']);
    expect(readdirSync(dest).sort()).toEqual(['daemon.log', 'main.log']);
    const kept = readFileSync(join(dest, 'main.log'), 'utf8');
    expect(kept.length).toBe(100);
    expect(kept.endsWith('END')).toBe(true);
  });
});
