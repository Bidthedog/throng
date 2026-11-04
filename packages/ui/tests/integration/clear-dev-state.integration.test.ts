import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipUnlessLinux } from '@throng/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Layer: integration — the claim is about real processes ending, which `clear-dev-state.test.ts`'s pure rule cannot show.
 *
 * The teardown is read from `.claude/worktree-prep.json` and run as `worktree-clean` runs it, so a manifest that stops
 * reaching the Linux script fails here.
 */
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(REPO, '.claude/worktree-prep.json'), 'utf8')) as { teardown: string[] };

const alive = (pid: number): boolean => {
  try {
    const state = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return state.slice(state.lastIndexOf(')') + 2, state.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return false;
  }
};

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const until = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const roots: string[] = [];
const started: number[] = [];

afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone, which is what the test wanted */
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A stand-in daemon under `checkout`, with a detached child that names nothing of the checkout. */
async function daemonWithChild(checkout: string): Promise<{ daemon: number; child: number }> {
  const dist = join(checkout, 'packages/daemon/dist');
  mkdirSync(dist, { recursive: true });
  const report = join(checkout, 'child.pid');
  writeFileSync(
    join(dist, 'main.js'),
    `const { spawn } = require('node:child_process');
     const child = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
     require('node:fs').writeFileSync(${JSON.stringify(report)}, String(child.pid));
     setInterval(() => {}, 1000);`,
  );
  writeFileSync(join(dist, 'package.json'), '{"type":"commonjs"}');
  const proc = spawn(process.execPath, [join(dist, 'main.js')], { detached: true, stdio: 'ignore' });
  proc.unref();
  await waitFor(() => existsSync(report) && readFileSync(report, 'utf8') !== '', 'the stand-in daemon to start its child');
  const child = Number(readFileSync(report, 'utf8'));
  started.push(proc.pid!, child);
  return { daemon: proc.pid!, child };
}

function checkoutAndData(): { checkout: string; config: string; data: string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-clear-'));
  roots.push(root);
  const checkout = join(root, 'checkout');
  const config = join(root, 'config');
  const data = join(root, 'data');
  mkdirSync(join(config, 'throng-dev'), { recursive: true });
  mkdirSync(join(config, 'throng'), { recursive: true });
  mkdirSync(join(data, 'throng-dev'), { recursive: true });
  return { checkout, config, data };
}

describe.skipIf(skipUnlessLinux('the Linux half of clear-dev-state'))('clear-dev-state on Linux (062 T035)', () => {
  it("the manifest's teardown ends the daemon and its children, and keeps the shared dev data", async () => {
    const { checkout, config, data } = checkoutAndData();
    const { daemon, child } = await daemonWithChild(checkout);
    const other = await daemonWithChild(`${checkout}-sibling`);

    for (const command of manifest.teardown) {
      execFileSync('bash', ['-c', command], {
        env: { ...process.env, SOURCE_PATH: REPO, WORKTREE_PATH: checkout, XDG_CONFIG_HOME: config, XDG_DATA_HOME: data },
        stdio: 'ignore',
      });
    }

    await waitFor(() => !alive(daemon) && !alive(child), 'the daemon and its child to end');
    expect(alive(other.daemon), 'a sibling checkout is left alone').toBe(true);
    expect(existsSync(join(config, 'throng-dev')), 'other worktrees share this folder').toBe(true);
    expect(existsSync(join(data, 'throng-dev')), 'other worktrees share this folder').toBe(true);
  });

  it('without --keep-data, removes only the dev folders', () => {
    const { checkout, config, data } = checkoutAndData();
    execFileSync(process.execPath, [join(REPO, 'scripts/clear-dev-state.mjs'), '--root', checkout], {
      env: { ...process.env, XDG_CONFIG_HOME: config, XDG_DATA_HOME: data },
      stdio: 'ignore',
    });
    expect(existsSync(join(config, 'throng-dev'))).toBe(false);
    expect(existsSync(join(data, 'throng-dev'))).toBe(false);
    expect(existsSync(join(config, 'throng')), "the installed build's folder").toBe(true);
  });
});
