import { pasteModeFor, type ClipboardMode, type ClipboardRecord, type IClipboard } from '@throng/core';

/**
 * The app-global clipboard mode record (016, FR-015c) — ONE record, in UI main, shared by every
 * panel in every window.
 *
 * The mode belongs to the CONTENT throng last copied, not to the widget that copied it. That is
 * what makes the feature's primary use case work: cut a column block in one file, paste it into
 * another, in another window, and it is still a column block. A view-local marker would have broken
 * exactly that, silently.
 *
 * It is validated against the LIVE OS clipboard on every paste. If anything else has written to the
 * clipboard since — another application, the user copying from a browser — throng's record no
 * longer describes what is there, and the paste is verbatim. Self-correcting by construction: no
 * polling, no clipboard observer, no OS event that can be missed. The check happens exactly when
 * the answer is needed, which is the only moment it can be right.
 *
 * Never persisted. It describes what is on the clipboard NOW, and a clipboard does not survive a
 * restart.
 */
export class ClipboardService {
  private record: ClipboardRecord | null = null;

  constructor(private readonly clipboard: IClipboard) {}

  /** Write text to the OS clipboard and remember what SHAPE it was. */
  write(text: string, mode: ClipboardMode): void {
    this.clipboard.writeText(text);
    this.record = { text, mode };
  }

  /**
   * Write RICH content (plain text + sanitised HTML) to the OS clipboard — a preview panel's Copy
   * (044 FR-035a). This CLEARS the paste-mode record rather than setting one: a preview is not one of
   * throng's own verbatim/full-line/rectangular sources, so a later paste of it must read verbatim,
   * exactly as pasting from any other application would.
   *
   * Clearing (not merely leaving the old record alone) matters because `pasteModeFor` compares by
   * TEXT, not by origin: a rich copy that happens to carry the same text as an earlier full-line or
   * rectangular copy would otherwise still match that old record, and the next paste would wrongly
   * reuse its shape — a Ctrl+V mid-line inserting a whole new line instead of splitting in at the
   * caret. Clearing makes "did a rich write happen since" a fact `pasteModeFor` cannot get wrong.
   */
  async writeRich(entry: { text: string; html: string }): Promise<void> {
    await this.clipboard.writeRich(entry);
    this.record = null;
  }

  /** The OS clipboard's current text — what a paste will actually insert. */
  read(): string {
    return this.clipboard.readText();
  }

  /**
   * The mode the next paste should use, validated against the live clipboard (FR-015c).
   *
   * A mismatch is not an error and not a bug: it simply means the clipboard moved on, and the
   * honest answer is verbatim.
   */
  pasteMode(): ClipboardMode {
    return pasteModeFor(this.record, this.clipboard.readText());
  }

  /** What throng believes it last wrote — exposed for tests and diagnostics, never persisted. */
  currentRecord(): ClipboardRecord | null {
    return this.record;
  }
}
