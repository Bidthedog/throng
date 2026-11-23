import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { runShellDetectionContract } from '@throng/core/testing';
import { WindowsShellDetection } from '@throng/platform-windows';

describe('WindowsShellDetection', () => {
  it('satisfies the shared IShellDetection contract on this machine (no false positives)', async () => {
    await expect(
      runShellDetectionContract(() => new WindowsShellDetection(), { fileExists: existsSync }),
    ).resolves.toBeUndefined();
  });

  // DELETED: 'returns only shells whose executable actually exists'. The contract run above is given
  // fileExists and asserts every returned file exists (shell-detection-contract.ts).

  it('detects Command Prompt, which is always present on Windows', async () => {
    const shells = await new WindowsShellDetection().detectInstalledShells();
    expect(shells.map((s) => s.id)).toContain('cmd');
  });
});
