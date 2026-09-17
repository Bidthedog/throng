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
  private html = '';

  writeText(text: string): void {
    this.text = text;
    // A plain write is not half-rich: it replaces whatever writeRich() left behind, exactly as the
    // real OS clipboard replaces every format in one write (044 FR-035a / R12).
    this.html = '';
  }

  // R12: "the memory implementation records both" — the plain text AND the HTML — even though
  // IClipboard#readText() itself stays plain-text-only by design (nothing under E2E reads the HTML
  // back through the interface). htmlForTesting() below is what plan.md:316's contract suite reads
  // instead, mirroring ElectronClipboard's own fake module.
  async writeRich(entry: { text: string; html: string }): Promise<void> {
    this.text = entry.text;
    this.html = entry.html;
  }

  readText(): string {
    return this.text;
  }

  /** Test/contract-only: the HTML most recently written by {@link writeRich}. Never called from
   *  production code — see the class comment on why readText() must not expose it. */
  htmlForTesting(): string {
    return this.html;
  }
}
