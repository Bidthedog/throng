/**
 * Contract suite for any {@link IShellIntegration} implementation (Principle V /
 * contracts/os-shell-integration.md). The harness reports which underlying OS
 * call the impl made, so impls verify they route file → reveal-and-select and
 * folder → open-contents (FR-035).
 */
import { describe, it, expect } from 'vitest';
import type { IShellIntegration } from '../abstractions/shell-integration.js';

export interface ShellIntegrationHarness {
  shell: IShellIntegration;
  /** Calls recorded since the last reset, in order. */
  calls(): ReadonlyArray<{ op: 'reveal' | 'open'; path: string }>;
  reset(): void;
}

export function runShellIntegrationContract(
  name: string,
  makeHarness: () => ShellIntegrationHarness,
): void {
  describe(`IShellIntegration contract: ${name}`, () => {
    it('reveals a file selected in its parent', async () => {
      const h = makeHarness();
      h.reset();
      await h.shell.revealInFileManager('C:/proj/src/main.ts');
      expect(h.calls()).toEqual([{ op: 'reveal', path: 'C:/proj/src/main.ts' }]);
    });

    it('opens a folder to show its contents', async () => {
      const h = makeHarness();
      h.reset();
      await h.shell.openFolder('C:/proj/src');
      expect(h.calls()).toEqual([{ op: 'open', path: 'C:/proj/src' }]);
    });
  });
}
