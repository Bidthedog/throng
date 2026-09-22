/**
 * {@link MemoryClipboard} against the shared {@link runClipboardContract} and
 * {@link runClipboardRichContract} suites (016, FR-013a / 044, FR-035a).
 *
 * plan.md:316 — the contract suites run against both the Electron and the memory implementations,
 * and R12 says "the memory implementation records both" (the plain text AND the HTML of a rich
 * write). This double is what the E2E suite ships in place of `ElectronClipboard` (Electron's real
 * clipboard does not work under the Playwright-Electron harness — see the file header on
 * `memory-clipboard.ts`), so it owes the same guarantee the real seam does.
 */
import { describe, expect, it } from 'vitest';
import { runClipboardContract, runClipboardRichContract } from '@throng/core/testing';
import { MemoryClipboard } from '../../src/main/memory-clipboard.js';

describe('MemoryClipboard', () => {
  it('satisfies the IClipboard contract', async () => {
    await expect(
      runClipboardContract('MemoryClipboard', () => new MemoryClipboard()),
    ).resolves.toBeUndefined();
  });

  it('satisfies the IClipboard writeRich contract (044 FR-035a / R12)', async () => {
    await expect(
      runClipboardRichContract('MemoryClipboard', () => {
        const clipboard = new MemoryClipboard();
        return { clipboard, html: () => clipboard.htmlForTesting() };
      }),
    ).resolves.toBeUndefined();
  });
});
