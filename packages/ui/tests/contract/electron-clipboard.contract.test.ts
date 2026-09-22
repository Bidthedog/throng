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
import {
  ElectronClipboard,
  type ClipboardItemFactory,
  type ElectronClipboardModule,
} from '../../src/main/electron-clipboard.js';

/**
 * An in-memory stand-in for Electron 44's `clipboard`, faithful to its async plain-text behaviour:
 * `write` takes items, and the item is whatever the injected factory produced — here, the MIME map
 * itself, which is all this fake needs to record.
 */
function fakeClipboardModule(): ElectronClipboardModule & { htmlRecord: { current: string } } {
  let text = '';
  const htmlRecord = { current: '' };
  return {
    writeText: async (value: string) => {
      text = value;
      htmlRecord.current = '';
    },
    readText: async () => text,
    write: async (items: readonly unknown[]) => {
      const payload = items[0] as Record<string, string>;
      text = payload['text/plain'] ?? '';
      htmlRecord.current = payload['text/html'] ?? '';
    },
    htmlRecord,
  };
}

/** Stands in for Electron's `ClipboardItem` constructor — the MIME map, unwrapped. */
const fakeItem: ClipboardItemFactory = (payload) => payload;

describe('ElectronClipboard', () => {
  it('satisfies the IClipboard contract', async () => {
    await expect(
      runClipboardContract(
        'ElectronClipboard',
        () => new ElectronClipboard(fakeClipboardModule(), fakeItem),
      ),
    ).resolves.toBeUndefined();
  });

  it('satisfies the IClipboard writeRich contract (044 FR-035a)', async () => {
    await expect(
      runClipboardRichContract('ElectronClipboard', () => {
        const fake = fakeClipboardModule();
        return {
          clipboard: new ElectronClipboard(fake, fakeItem),
          html: () => fake.htmlRecord.current,
        };
      }),
    ).resolves.toBeUndefined();
  });

  it('yields the empty string — rather than rejecting — when the OS clipboard cannot be read', async () => {
    // Electron's readText() can reject on a locked or unavailable clipboard. A failed paste must not
    // take the editor down with it.
    const hostile: ElectronClipboardModule = {
      writeText: async () => {},
      readText: async () => {
        throw new Error('clipboard unavailable');
      },
      write: async () => {},
    };
    await expect(new ElectronClipboard(hostile, fakeItem).readText()).resolves.toBe('');
  });
});
