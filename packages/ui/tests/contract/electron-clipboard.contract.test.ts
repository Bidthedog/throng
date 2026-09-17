/**
 * {@link ElectronClipboard} against the shared {@link runClipboardContract} suite (016, FR-013a) and
 * {@link runClipboardRichContract} suite (044, FR-035a).
 *
 * The fake stands in for Electron's clipboard module — which is exactly why the module is injected.
 * A seam whose only possible test needs a real desktop session, a real focused window and a real
 * clipboard is a seam nobody runs, and the contract it is supposed to uphold goes unchecked.
 */
import { describe, expect, it } from 'vitest';
import { runClipboardContract, runClipboardRichContract } from '@throng/core/testing';
import { ElectronClipboard, type ElectronClipboardModule } from '../../src/main/electron-clipboard.js';

/** An in-memory stand-in for Electron's `clipboard`, faithful to its plain-text behaviour. */
function fakeClipboardModule(): ElectronClipboardModule & { htmlRecord: { current: string } } {
  let text = '';
  const htmlRecord = { current: '' };
  return {
    writeText: (value: string) => {
      text = value;
      htmlRecord.current = '';
    },
    readText: () => text,
    // Mirrors Electron's `clipboard.write({ text, html })` (044 FR-035a / R12).
    write: (entry: { text: string; html: string }) => {
      text = entry.text;
      htmlRecord.current = entry.html;
    },
    htmlRecord,
  };
}

describe('ElectronClipboard', () => {
  it('satisfies the IClipboard contract', () => {
    expect(() =>
      runClipboardContract('ElectronClipboard', () => new ElectronClipboard(fakeClipboardModule())),
    ).not.toThrow();
  });

  it('satisfies the IClipboard writeRich contract (044 FR-035a)', async () => {
    await expect(
      runClipboardRichContract('ElectronClipboard', () => {
        const fake = fakeClipboardModule();
        return {
          clipboard: new ElectronClipboard(fake),
          html: () => fake.htmlRecord.current,
        };
      }),
    ).resolves.toBeUndefined();
  });

  it('yields the empty string — rather than throwing — when the OS clipboard cannot be read', () => {
    // Electron's readText() can throw on a locked or unavailable clipboard. A failed paste must not
    // take the editor down with it.
    const hostile: ElectronClipboardModule = {
      writeText: () => {},
      readText: () => {
        throw new Error('clipboard unavailable');
      },
      write: () => {},
    };
    expect(new ElectronClipboard(hostile).readText()).toBe('');
  });
});
