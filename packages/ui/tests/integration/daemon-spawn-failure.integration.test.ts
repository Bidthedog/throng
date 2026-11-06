import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createFileLog, type DiagnosticLog } from '@throng/platform';
import { ensureDaemon } from '../../src/main/daemon-lifecycle.js';

/**
 * 066 FR-005 / FR-014 (#542) — a daemon that dies while loading its modules cannot log anything
 * itself: its own logger never existed. Only its parent saw it go, so UI main must write the record:
 * fatal (the daemon is long-lived), with the exit code and the tail of what it printed — which lands
 * in `daemon-startup.log`, the file its stdout/stderr were given.
 */

const dirs: string[] = [];
const logs: DiagnosticLog[] = [];
afterEach(() => {
  for (const log of logs.splice(0)) log.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let seq = 0;
const pipe = (): string => `\\\\.\\pipe\\throng-spawn-failure-${process.pid}-${seq++}`;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-spawn-failure-'));
  dirs.push(dir);
  return dir;
}

async function waitFor(read: () => string, match: RegExp, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = read();
  while (!match.test(text) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    text = read();
  }
  return text;
}

describe('a daemon that exits during load', () => {
  it('leaves a fatal record with its exit code and the startup output in main.log', async () => {
    const root = tempDir();
    const logDir = join(root, 'logs');
    const entry = join(root, 'main.js');
    writeFileSync(
      entry,
      "process.stderr.write(\"Error: Cannot find module 'missing-dep'\\n\");\nprocess.exit(3);\n",
      'utf8',
    );
    const log = createFileLog({ dir: logDir, fileName: 'main.log', component: 'ui-main', level: 'info', mirrorToConsole: false });
    logs.push(log);

    await expect(
      ensureDaemon({
        pipeName: pipe(),
        daemonEntry: entry,
        nodePath: process.execPath,
        logDir,
        readyTimeoutMs: 1000,
        pingTimeoutMs: 100,
        log: (level, message) => log.log(level, message),
      }),
    ).rejects.toThrow(/did not become ready/);

    const mainLog = join(logDir, 'main.log');
    const text = await waitFor(() => (existsSync(mainLog) ? readFileSync(mainLog, 'utf8') : ''), /daemon exited/);
    const line = text.split('\n').find((l) => l.includes('daemon exited'));
    expect(line).toBeDefined();
    expect(line).toMatch(/FATAL/);
    expect(line).toContain('with code 3');
    expect(line).toContain("Cannot find module 'missing-dep'");
  });
});
