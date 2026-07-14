import type { IClipboard } from '@throng/core';

/** The slice of Electron's `clipboard` module this needs — constructor-injected, so tests drive a fake. */
export interface ElectronClipboardModule {
  writeText(text: string): void;
  readText(): string;
}

/**
 * {@link IClipboard} over Electron's clipboard (016, FR-013a).
 *
 * It lives in UI **main**, not in `platform-windows`: that package has no Electron dependency and
 * must not gain one (the precedent is `ElectronDisplayInfo`). The clipboard is an Electron
 * capability here, not a Win32 one.
 *
 * The module is CONSTRUCTOR-INJECTED so the contract suite can run against a fake — an OS seam
 * whose only test needs a real desktop session is a seam that never gets tested.
 *
 * `readText()` never throws: a clipboard that cannot be read yields the empty string, because a
 * paste is not worth crashing the editor over.
 */
export class ElectronClipboard implements IClipboard {
  constructor(private readonly clipboard: ElectronClipboardModule) {}

  writeText(text: string): void {
    this.clipboard.writeText(text);
  }

  readText(): string {
    try {
      return this.clipboard.readText() ?? '';
    } catch {
      return '';
    }
  }
}
