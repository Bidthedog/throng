/**
 * The OS clipboard seam (016, FR-013a — Principle II).
 *
 * Core needs to READ the live clipboard to decide a paste mode (FR-015c: throng's record of what it
 * last copied is validated against what the clipboard actually holds, so any other application
 * touching it makes the next paste verbatim, automatically). The moment core needs that, the
 * clipboard stops being an incidental Electron call and becomes an OS capability — and every OS
 * capability in this codebase is an interface here, with a contract suite, and an implementation in
 * a platform package.
 *
 * Reading stays plain text, both directions of `writeText`/`readText`: the mode travels in an
 * in-memory record beside the text, not in the clipboard itself, so what other applications receive
 * from a `writeText` is exactly what a user would expect to paste.
 *
 * `writeRich` (044, FR-035a — R12) is the one exception, and a narrow one: HTML is a STANDARD
 * clipboard format (every OS clipboard carries it beside plain text), not a custom throng format, so
 * offering it changes nothing about what other applications receive — a plain-text target still gets
 * plain text. It exists so a preview panel's copy can keep headings, lists and links for a rich
 * target (a mail client) while a plain target (an editor, a terminal) still receives the plain text
 * alternative. Reading stays plain-text-only; there is no `readRich`.
 */
/*
 * Every member is ASYNC, including the read. Electron 44 replaced the synchronous `clipboard`
 * module with the W3C-shaped async one (`readText(): Promise<string>`, `write(items)`), and there is
 * no sync route left in main — so a sync seam could only have been honoured by an implementation
 * that blocks, which is worse than a promise (#417).
 */
export interface IClipboard {
  /** Replace the clipboard's contents with `text`. Empty is legal — it clears it. */
  writeText(text: string): Promise<void>;
  /**
   * Replace the clipboard's contents with BOTH `text` (the plain-text fallback) and `html` (the
   * rich-text alternative) — 044 FR-035a. A rich target reads the HTML; a plain target reads `text`,
   * exactly as `writeText` would have left it.
   */
  writeRich(entry: { text: string; html: string }): Promise<void>;
  /**
   * Replace the clipboard's contents with a PNG `image` and its `html` alternative (an `<img>` of the
   * same picture), in one write — 054's Copy Diagram as Image. An image target reads the PNG; a rich-text
   * target reads the HTML. The clipboard holds no text afterwards.
   */
  writeImage(entry: { png: Uint8Array; html: string }): Promise<void>;
  /** The clipboard's current text, or the empty string when it holds none (never rejects). */
  readText(): Promise<string>;
  /** Replace the clipboard's contents with a list of real files (067 FR-003). */
  writeFileList(list: FileListSnapshot): Promise<void>;
  /** The file list on the clipboard, or null when it holds none (never rejects). */
  readFileList(): Promise<FileListSnapshot | null>;
}

/** Absolute paths on the OS clipboard, and whether the receiver should move them (067). Never empty. */
export interface FileListSnapshot {
  readonly paths: readonly string[];
  readonly intent: 'copy' | 'cut';
}

/**
 * One OS's clipboard formats for a file list (067 FR-013). Every format name lives in an implementation of this,
 * in a platform package; the caller only moves opaque keys and payloads.
 */
export interface IFileListCodec {
  /** The clipboard entries {@link decode} reads. */
  readonly formats: readonly string[];
  encode(list: FileListSnapshot): Record<string, string | Uint8Array>;
  decode(payloads: Readonly<Record<string, Uint8Array>>): FileListSnapshot | null;
}
