import { describe, it, expect } from 'vitest';
import { runShellDetectionContract } from '@throng/core/testing';
import type { DetectedShell, IShellDetection } from '@throng/core';

const OK: DetectedShell = { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe', defaultArgs: [] };

function fake(shells: DetectedShell[] | (() => DetectedShell[])): IShellDetection {
  return {
    detectInstalledShells: async () => (typeof shells === 'function' ? shells() : shells),
  };
}

describe('runShellDetectionContract (self-test)', () => {
  it('passes a compliant implementation', async () => {
    await expect(runShellDetectionContract(() => fake([OK]))).resolves.toBeUndefined();
  });

  it('passes the empty (no-shells) result', async () => {
    await expect(runShellDetectionContract(() => fake([]))).resolves.toBeUndefined();
  });

  it('fails an entry with an empty id', async () => {
    await expect(runShellDetectionContract(() => fake([{ ...OK, id: '' }]))).rejects.toThrow(
      /contract violation/i,
    );
  });

  it('fails an entry with an empty file', async () => {
    await expect(runShellDetectionContract(() => fake([{ ...OK, file: '' }]))).rejects.toThrow(
      /contract violation/i,
    );
  });

  it('fails duplicate ids', async () => {
    await expect(
      runShellDetectionContract(() => fake([OK, { ...OK, label: 'Dup' }])),
    ).rejects.toThrow(/unique/i);
  });

  it('fails a non-array defaultArgs', async () => {
    await expect(
      runShellDetectionContract(() => fake([{ ...OK, defaultArgs: 'x' as unknown as string[] }])),
    ).rejects.toThrow(/defaultArgs/i);
  });

  it('fails an unstable implementation (different set across calls)', async () => {
    let n = 0;
    await expect(
      runShellDetectionContract(() => fake(() => (n++ === 0 ? [OK] : []))),
    ).rejects.toThrow(/stable/i);
  });
});
