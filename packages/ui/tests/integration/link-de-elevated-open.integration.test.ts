import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { WindowsElevation } from '@throng/platform-windows';
import {
  ElectronShellIntegration,
  type ElectronShellLike,
  type DeElevatingLauncher,
} from '../../src/main/electron-shell-integration.js';

/**
 * 045 SI4 / FR-038 (`@admin`) — **an elevated throng must not start an ordinary program elevated.**
 *
 * Layer: integration — only a REALLY elevated process can show that the probe main wires,
 * `WindowsElevation().isElevated()`, reports elevated and drives the de-elevating route.
 *
 * The ROUTING cases (which launcher received which spec, that Electron's `shell` was not called, the
 * refusals, the non-elevated path, the executable open) were re-layered to
 * `unit/link-de-elevated-open.test.ts`: `isElevated` and the launcher are injected fakes there, so
 * they run in milliseconds on a fake clock instead of waiting out `DE_ELEVATED_LAUNCH_REPORT_MS` each.
 * The de-elevated child itself is `windows-de-elevated-launcher.contract.test.ts` and the `@admin`
 * E2E. When this process is not elevated the case below is skipped with a reason, never softened.
 */

function runnerElevated(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'net.exe'), ['session'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

const ELEVATED = runnerElevated();
/** Only the case that needs a REAL high-integrity process. */
const whenReallyElevated = ELEVATED ? describe : describe.skip;

whenReallyElevated('@admin — a REALLY elevated process reads its own elevation and routes away', () => {
  it('uses the REAL elevation probe, not a literal true, and still does not call the shell', async () => {
    // The one thing the injected unit cases cannot prove: that the probe main actually wires —
    // `WindowsElevation().isElevated()` — reports this process elevated and drives the same route.
    // Without this, the routing only ever works because a test said `true`.
    const direct: { op: string; path: string }[] = [];
    const launched: { file: string; args: readonly string[] }[] = [];
    const shell: ElectronShellLike = {
      showItemInFolder: (p) => direct.push({ op: 'reveal', path: p }),
      openPath: async (p) => {
        direct.push({ op: 'open', path: p });
        return '';
      },
      openExternal: async () => {},
    };
    const launcher: DeElevatingLauncher = {
      isAvailable: () => true,
      launch: (file, args) => void launched.push({ file, args: [...args] }),
    };
    const elevation = new WindowsElevation();
    expect(elevation.isElevated(), 'this case only runs on a really elevated process').toBe(true);
    const integration = new ElectronShellIntegration(shell, undefined, {
      launcher,
      isElevated: () => elevation.isElevated(),
    });
    const root = mkdtempSync(join(tmpdir(), 'throng-deelev-'));
    try {
      const file = join(root, 'notes.txt');
      writeFileSync(file, 'fixture\n', 'utf8');
      await integration.revealInFileManager(file);
      expect(direct).toEqual([]);
      expect(launched).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe('SI4 coverage note', () => {
  it('says out loud whether the elevated half actually ran', () => {
    // Printed on every run so the gap is reported rather than assumed — the same reason
    // `admin-reminder.reporter.ts` exists for the E2E lane.
    console.log(
      ELEVATED
        ? '[045 SI4] elevated run: the real-elevation case executed'
        : '[045 SI4] NOT elevated: the real-elevation case was skipped, not softened. The ROUTING cases are in unit/link-de-elevated-open.test.ts.',
    );
    expect(typeof ELEVATED).toBe('boolean');
  });
});
