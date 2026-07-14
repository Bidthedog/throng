import type { IClipboard } from '@throng/core';

/**
 * An in-process {@link IClipboard} — the E2E suite's clipboard (016, FR-013a).
 *
 * ## Why this exists
 *
 * **Electron's clipboard does not work under the Playwright-Electron harness.** Writing text and
 * reading it straight back yields the empty string, and `availableFormats()` reports nothing: the
 * launched app has no access to the Windows clipboard at all. Every clipboard assertion in an E2E
 * would therefore be asserting against a dead OS resource — passing only when it expected nothing.
 *
 * So under E2E the seam is filled with this instead, and the tests prove the FEATURE — cut a line,
 * paste it back as a line above — rather than proving that Windows has a clipboard. The real seam
 * ({@link ElectronClipboard}) is what ships, and it is covered by the shared clipboard CONTRACT
 * suite, which is the layer where "does this implementation honour IClipboard?" belongs.
 *
 * It also removes a hazard the real clipboard carries in a parallel suite: the OS clipboard is ONE
 * global resource, so two E2E workers cutting text at the same moment would silently overwrite each
 * other's — a flake that would look exactly like a bug in the paste logic.
 */
export class MemoryClipboard implements IClipboard {
  private text = '';

  writeText(text: string): void {
    this.text = text;
  }

  readText(): string {
    return this.text;
  }
}
