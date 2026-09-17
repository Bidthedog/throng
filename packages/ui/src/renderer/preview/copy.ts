/**
 * Selecting and copying in a preview body (044, FR-035, FR-035a, FR-035b, FR-035c; research "Copy").
 *
 * ══ WHAT IS COPIED ══
 *
 * The part of the document's selection that lies inside the preview body — never the header, the notice
 * or the status bar around it. Its plain text is the range's text; its HTML is a clone of the range run
 * through the PROVIDER's export profile (`PreviewProviderView.exportHtml`), so this file names no provider.
 *
 * | Format  | Clipboard                                          |
 * |---------|----------------------------------------------------|
 * | `rich`  | `clipboard.writeRich({ text, html })` — one write  |
 * | `plain` | `clipboard.write({ text, mode: 'verbatim' })`      |
 *
 * A provider with no exporter copies rich as plain: text alone is the one form every target accepts.
 *
 * ══ CAPTURED NOW, WRITTEN LATER ══
 *
 * {@link captureSelection} reads the range SYNCHRONOUSLY — in the `copy` event, or when the body menu
 * opens — and hands back a snapshot. The exporter is loaded lazily, so the write is asynchronous, and a
 * menu click is exactly when a live selection can move: pressing a menu row can collapse it. Copying the
 * snapshot copies what the reader had selected when they asked.
 *
 * ══ SELECT ALL IS THE BODY ══
 *
 * Chromium's own select-all on a focused, non-editable element selects the whole window — header, menus,
 * other panels. {@link selectAllIn} selects the body's contents and nothing else, and the chord and the
 * menu row both call it.
 */
import type { PreviewCopyFormat } from '@throng/core';

/** A selection as it stood when it was captured. */
export interface CapturedSelection {
  text: string;
  /** A clone of the selected nodes, for the export profile. */
  fragment: DocumentFragment;
}

/** The clipboard calls a copy makes. */
export interface PreviewCopyClipboard {
  write?: (entry: { text: string; mode: 'verbatim' }) => Promise<void>;
  writeRich?: (entry: { text: string; html: string }) => Promise<void>;
}

/** The selection's range clipped to `host`, or `null` when nothing inside `host` is selected. */
export function selectionRangeIn(host: HTMLElement): Range | null {
  const selection = host.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(host)) return null;
  const clipped = range.cloneRange();
  if (!host.contains(clipped.startContainer)) clipped.setStart(host, 0);
  if (!host.contains(clipped.endContainer)) clipped.setEnd(host, host.childNodes.length);
  return clipped.collapsed ? null : clipped;
}

/**
 * Snapshot the selection inside `host`, or `null` when there is none.
 *
 * A selection with no TEXT — an image alone, or a link whose only content is an image — is still a
 * selection of the document, and is captured. Treating it as none let the platform copy through untouched,
 * carrying `data-throng-link` (an absolute project path) and the `throng-preview:` address (adversarial
 * review M1). Its plain text is what the export profile turns it into: each image's alt text, or nothing.
 */
export function captureSelection(host: HTMLElement): CapturedSelection | null {
  const range = selectionRangeIn(host);
  if (range === null) return null;
  const fragment = range.cloneContents();
  const text = range.toString();
  if (text.length > 0) return { text, fragment };
  const alt = [...fragment.querySelectorAll('img')].map((img) => img.getAttribute('alt') ?? '').join('');
  return { text: alt, fragment };
}

/** Select `host`'s contents, and nothing outside it. */
export function selectAllIn(host: HTMLElement): void {
  const selection = host.ownerDocument.getSelection();
  if (selection === null) return;
  const range = host.ownerDocument.createRange();
  range.selectNodeContents(host);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Put a captured selection on the clipboard in `format`. Resolves `false` when nothing was written —
 * no bridge, a write that failed (its cause logged rather than lost in a `void`ed promise), or a selection
 * that exports to NOTHING: an alt-less image alone has no text and no HTML, and writing that would wipe
 * whatever the reader already had on the clipboard.
 */
export async function copyCapturedSelection(
  captured: CapturedSelection,
  format: PreviewCopyFormat,
  clipboard: PreviewCopyClipboard | undefined,
  exportHtml: ((selection: DocumentFragment) => Promise<string>) | undefined,
): Promise<boolean> {
  try {
    if (format === 'rich' && exportHtml !== undefined && clipboard?.writeRich !== undefined) {
      const html = await exportHtml(captured.fragment);
      if (captured.text === '' && html.trim() === '') return false;
      await clipboard.writeRich({ text: captured.text, html });
      return true;
    }
    if (captured.text === '' || clipboard?.write === undefined) return false;
    await clipboard.write({ text: captured.text, mode: 'verbatim' });
    return true;
  } catch (error) {
    console.error('[preview] copy failed', error);
    return false;
  }
}
