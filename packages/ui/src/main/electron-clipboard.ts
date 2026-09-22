import type { IClipboard } from '@throng/core';

/**
 * The slice of Electron's `clipboard` module this needs — constructor-injected, so tests drive a
 * fake.
 *
 * Electron 44's clipboard is the W3C-shaped async one: `writeText`/`readText` return promises, and
 * `write` takes `ClipboardItem`s rather than a `{ text, html }` record. The item constructor is
 * injected beside the module because a `ClipboardItem` can only be built by Electron's own class
 * (#417).
 */
export interface ElectronClipboardModule {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
  /** Electron's `clipboard.write([item])` — every format in one atomic OS write (044 FR-035a). */
  write(items: readonly unknown[]): Promise<void>;
}

/** Electron's `ClipboardItem` constructor: MIME type → payload. */
export type ClipboardItemFactory = (payload: Record<string, string>) => unknown;

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
 * `readText()` never rejects: a clipboard that cannot be read yields the empty string, because a
 * paste is not worth crashing the editor over.
 */
export class ElectronClipboard implements IClipboard {
  constructor(
    private readonly clipboard: ElectronClipboardModule,
    private readonly makeItem: ClipboardItemFactory,
  ) {}

  async writeText(text: string): Promise<void> {
    await this.clipboard.writeText(text);
  }

  async writeRich(entry: { text: string; html: string }): Promise<void> {
    await this.clipboard.write([
      this.makeItem({ 'text/plain': entry.text, 'text/html': entry.html }),
    ]);
  }

  async readText(): Promise<string> {
    try {
      return (await this.clipboard.readText()) ?? '';
    } catch {
      return '';
    }
  }
}
