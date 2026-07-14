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
 * Plain text only, both directions. throng never writes a custom clipboard format: the mode travels
 * in an in-memory record beside the text, not in the clipboard itself, so what other applications
 * receive is exactly what a user would expect to paste.
 */
export interface IClipboard {
  /** Replace the clipboard's contents with `text`. Empty is legal — it clears it. */
  writeText(text: string): void;
  /** The clipboard's current text, or the empty string when it holds none (never throws). */
  readText(): string;
}
