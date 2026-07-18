import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { WindowsDeElevatedLauncher } from '@throng/platform-windows';

/**
 * Issue #94 / 019 FR-015 — **why nobody has ever known why the de-elevated launch fails.**
 *
 * The launcher spawns a PowerShell shim that performs the shell-token
 * `CreateProcessWithTokenW` handoff. That shim is careful: `$ErrorActionPreference='Stop'`
 * and precise throws — `"CreateProcessWithTokenW failed: 1314"`, `"OpenProcessToken failed: …"`.
 * Every one of those messages goes into `/dev/null`, because the launch is spawned with
 * `stdio: 'ignore'` and `.unref()`ed, returning `void`. When the handoff fails, the daemon
 * learns nothing, the agent never connects, and the panel hangs with no prompt and no error.
 *
 * This pins the reporting seam: a shim that fails must be able to say WHY, while the launch
 * stays fire-and-forget in *lifetime* — only its **failure** becomes observable.
 *
 * NOTE ON THE FAKE SHIM: `launch` locates powershell under `process.env.SystemRoot`
 * (windows-de-elevated-launcher.ts:22-28), so pointing `SystemRoot` at a temp tree
 * substitutes the shim without adding a seam the production path doesn't have. The real
 * shim's behaviour is elevation-dependent (`CreateProcessWithTokenW` needs a privilege a
 * medium session lacks), which is exactly the kind of environment-dependent proof this
 * feature exists to eliminate — so the shim is substituted, and its exit/stderr behaviour
 * is *verified in the test itself* rather than assumed.
 *
 * NOT COVERED HERE — "a zero exit reports nothing", and why it is stated rather than
 * silently absent: the launcher's argv is fixed (`-NoProfile -ExecutionPolicy Bypass
 * -EncodedCommand …`), so every substitutable exe REJECTS it and exits non-zero, while the
 * one program that accepts it — the real powershell running this script — exits 0 only when
 * elevated (`CreateProcessWithTokenW` needs a privilege a medium session does not hold).
 * A deterministic zero-exit shim therefore does not exist at this seam; the nearest honest
 * proof is the `@admin` de-elevation E2E, where a launch that SUCCEEDS must produce a
 * working prompt and no `[throng]` error text. `report` is guarded by a single
 * `if (code !== 0)`, which the first test exercises live.
 *
 * EXPECTED TO FAIL until FR-015 is implemented: `report` does not exist.
 */

const SHIM_ARGV = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'];

const dirs: string[] = [];

/** Build a `SystemRoot` tree whose powershell.exe is `realExe`, and return the root. */
function fakeSystemRoot(realExe: string): string {
  const root = mkdtempSync(join(tmpdir(), 'throng-shim-'));
  dirs.push(root);
  const dir = join(root, 'System32', 'WindowsPowerShell', 'v1.0');
  mkdirSync(dir, { recursive: true });
  copyFileSync(realExe, join(dir, 'powershell.exe'));
  return root;
}

/**
 * The premise-check that keeps the "a zero exit reports nothing" case honest: run the fake
 * shim the same way the launcher does and report what it ACTUALLY did. A launcher that
 * reported nothing because the shim never ran would otherwise pass vacuously.
 */
function runShim(root: string): Promise<{ code: number | null; stderr: string }> {
  const exe = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    const child = spawn(exe, [...SHIM_ARGV, 'QQBCAEMA'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

/** Resolve as soon as `reasons` grows, else after `ms` — never a fixed sleep on the happy path. */
function waitForReport(reasons: string[], ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (reasons.length > 0 || Date.now() - started >= ms) {
        clearInterval(tick);
        resolve();
      }
    }, 50);
  });
}

const originalSystemRoot = process.env.SystemRoot;

afterEach(() => {
  if (originalSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = originalSystemRoot;
  // Best-effort: the shim is fire-and-forget by design, so a still-exiting one can hold
  // its own image open (EPERM). `maxRetries` covers the window; a leftover temp dir is
  // not worth failing a passing assertion over.
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* the OS still holds the copied shim; the temp dir is reaped with the run dir */
    }
  }
});

describe('WindowsDeElevatedLauncher — a failed de-elevated launch must be able to say why (FR-015)', () => {
  it('reports the shim\'s own stderr when the shim exits non-zero', async () => {
    // node.exe rejects the shim's argv ("bad option: -NoProfile") on stderr and exits
    // non-zero: a stand-in for the real shim's `CreateProcessWithTokenW failed: 1314`.
    const root = fakeSystemRoot(process.execPath);

    // Premise: this shim really does fail, and really does say so on stderr.
    const actual = await runShim(root);
    expect(actual.code, 'the fake shim must exit non-zero for this test to mean anything').not.toBe(0);
    expect(actual.stderr, 'the fake shim must write its reason to stderr').not.toBe('');

    process.env.SystemRoot = root;
    const reasons: string[] = [];
    new WindowsDeElevatedLauncher().launch('C:\\Windows\\System32\\cmd.exe', ['/c', 'exit'], (reason) => {
      reasons.push(reason);
    });

    await waitForReport(reasons, 10_000);

    expect(reasons.length, 'a shim that failed must report — today its message goes to /dev/null').toBe(1);
    expect(
      reasons[0],
      "the report must carry the shim's OWN message, not a generic 'launch failed'",
    ).toContain(actual.stderr.trim().split('\n')[0].trim());
  }, 20_000);

  it('reports the shim\'s own failure even when the target cannot be launched at all', async () => {
    // The REAL shim, no substitution — and elevation-independent, because a nonexistent
    // target makes the script throw in EVERY environment: non-elevated it dies at
    // `CreateProcessWithTokenW failed: 1314` (the privilege a medium session lacks — #94's
    // most likely cause), elevated it dies at the same call with "file not found", and on a
    // session with no shell it dies at "no shell window". Whichever it is, the shim knows,
    // and before FR-015 it had no way to say so.
    const reasons: string[] = [];
    new WindowsDeElevatedLauncher().launch('C:\\throng-does-not-exist\\nope.exe', [], (reason) => {
      reasons.push(reason);
    });

    // The shim compiles its C# member definition via Add-Type before it can fail, so this
    // is seconds, not milliseconds — resolved early the moment the reason lands.
    await waitForReport(reasons, 30_000);

    expect(reasons.length, 'a shim that threw must report — today its message goes to /dev/null').toBe(1);
    expect(
      reasons[0],
      "the report must carry the shim's OWN diagnosis (a win32 error), never a generic 'launch failed'",
    ).toMatch(/failed:|no shell window/i);
  }, 45_000);

  it('still returns void synchronously, without blocking or throwing', () => {
    const root = fakeSystemRoot(process.execPath);
    process.env.SystemRoot = root;
    const started = Date.now();
    // No `report` at all: the parameter is optional and the old 2-arg call still works.
    const returned = new WindowsDeElevatedLauncher().launch('C:\\Windows\\System32\\cmd.exe', ['/c', 'exit']);
    expect(returned, 'launch must still return void').toBeUndefined();
    expect(Date.now() - started, 'launch must not wait on the shim').toBeLessThan(2_000);
  });
});
