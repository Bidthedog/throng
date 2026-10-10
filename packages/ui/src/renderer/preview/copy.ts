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
import {
  DIAGRAM_HOST_CLASS,
  DIAGRAM_IMAGE_ATTRIBUTE,
  DIAGRAM_LANG_ATTRIBUTE,
  DIAGRAM_SOURCE_ATTRIBUTE,
} from './diagram/diagram-host.js';
import { rasteriseSvg } from './diagram/rasterise.js';

/** 054 FR-049a — a diagram the selection reached, in the order its placeholder carries. */
export interface CapturedDiagram {
  readonly lang: string;
  readonly source: string;
  /** The SVG as drawn (a clone), for a rich copy's image; `null` when it had not rendered. */
  readonly svg: SVGSVGElement | null;
}

/** A selection as it stood when it was captured. */
export interface CapturedSelection {
  text: string;
  /** A clone of the selected nodes, for the export profile. */
  fragment: DocumentFragment;
  /** 054 FR-049a — each diagram the selection reached, standing in its place in `fragment` as a placeholder. */
  diagrams?: readonly CapturedDiagram[];
}

/** The placeholder a diagram becomes in a captured fragment; its value is the diagram's index. */
const DIAGRAM_PLACEHOLDER_ATTRIBUTE = 'data-throng-diagram-copy';

/** A diagram's source as a fenced block — what a plain-text copy carries in its place (FR-049a). */
function fencedSource(lang: string, source: string): string {
  return `\`\`\`${lang}\n${source.endsWith('\n') ? source : `${source}\n`}\`\`\`\n`;
}

/**
 * 054 FR-049a — replace each diagram in `fragment` with a placeholder holding its fenced source: the
 * drawing's labels and its toolbar's glyphs are not text the author wrote. The placeholder is what a rich
 * copy swaps for the image.
 */
function substituteDiagrams(fragment: DocumentFragment): CapturedDiagram[] {
  const diagrams: CapturedDiagram[] = [];
  for (const host of [...fragment.querySelectorAll<HTMLElement>(`.${DIAGRAM_HOST_CLASS}`)]) {
    const lang = host.getAttribute(DIAGRAM_LANG_ATTRIBUTE) ?? '';
    const source = host.getAttribute(DIAGRAM_SOURCE_ATTRIBUTE) ?? '';
    const svg = host.querySelector<SVGSVGElement>('.preview-diagram-frame__layer > svg');
    const placeholder = host.ownerDocument.createElement('div');
    placeholder.setAttribute(DIAGRAM_PLACEHOLDER_ATTRIBUTE, String(diagrams.length));
    placeholder.textContent = fencedSource(lang, source);
    host.replaceWith(placeholder);
    diagrams.push({ lang, source, svg });
  }
  return diagrams;
}

/**
 * A copy of `captured.fragment` with each diagram placeholder replaced by its image — or, when it cannot be
 * drawn as one, by its source as a code block, so the copy never silently loses the diagram.
 */
async function withDiagramImages(
  captured: CapturedSelection,
  rasterise: (svg: SVGSVGElement) => Promise<string>,
): Promise<DocumentFragment> {
  const fragment = captured.fragment.cloneNode(true) as DocumentFragment;
  const diagrams = captured.diagrams ?? [];
  for (const placeholder of [...fragment.querySelectorAll<HTMLElement>(`[${DIAGRAM_PLACEHOLDER_ATTRIBUTE}]`)]) {
    const diagram = diagrams[Number(placeholder.getAttribute(DIAGRAM_PLACEHOLDER_ATTRIBUTE))];
    const doc = placeholder.ownerDocument;
    let replacement: Element;
    try {
      if (diagram?.svg == null) throw new Error('not drawn');
      const img = doc.createElement('img');
      img.setAttribute('src', await rasterise(diagram.svg));
      img.setAttribute('alt', 'Diagram');
      img.setAttribute(DIAGRAM_IMAGE_ATTRIBUTE, '');
      replacement = img;
    } catch {
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = diagram?.source ?? '';
      pre.append(code);
      replacement = pre;
    }
    placeholder.replaceWith(replacement);
  }
  return fragment;
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
 * 047 T045/T066, R6 — `throng`-drawn chrome, never part of the document a reader wrote: the Markdown
 * fold gutter's toggle button (sits INSIDE its heading, the heading's first child — a selection or a
 * Select All spanning that heading would otherwise carry its icon glyph as if the author had typed it)
 * and a table's column resize handle (sits inside its header cell the same way). Named here, in the
 * provider-agnostic copy path, so a later provider's own throng-drawn control is excluded the same way.
 */
const THRONG_CHROME_SELECTOR = '.preview-fold-toggle, .preview-table-resize-handle';

/**
 * Snapshot the selection inside `host`, or `null` when there is none.
 *
 * A selection with no TEXT — an image alone, or a link whose only content is an image — is still a
 * selection of the document, and is captured. Treating it as none let the platform copy through untouched,
 * carrying `data-throng-link` (an absolute project path) and the `throng-preview:` address (adversarial
 * review M1). Its plain text is what the export profile turns it into: each image's alt text, or nothing.
 *
 * Both `text` and `fragment` are read from the SAME cleaned clone, so a `throng`-drawn control excluded
 * from one is excluded from the other by construction — `range.toString()` has no such filter, so the
 * text is now the clone's `textContent` instead, which `Range.toString()` is defined to equal absent any
 * filtering (MDN: "essentially the concatenation of the textContent of all the nodes... in the Range").
 */
export function captureSelection(host: HTMLElement): CapturedSelection | null {
  const range = selectionRangeIn(host);
  if (range === null) return null;
  const fragment = range.cloneContents();
  for (const chrome of fragment.querySelectorAll(THRONG_CHROME_SELECTOR)) chrome.remove();
  const diagrams = substituteDiagrams(fragment);
  const text = fragment.textContent ?? '';
  if (text.length > 0) return { text, fragment, diagrams };
  const alt = [...fragment.querySelectorAll('img')].map((img) => img.getAttribute('alt') ?? '').join('');
  return { text: alt, fragment, diagrams };
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
  rasterise: (svg: SVGSVGElement) => Promise<string> = rasteriseSvg,
): Promise<boolean> {
  try {
    if (format === 'rich' && exportHtml !== undefined && clipboard?.writeRich !== undefined) {
      // 054 FR-049a — each diagram as its image, in place; the exporter admits that one data-URI shape.
      const html = await exportHtml(await withDiagramImages(captured, rasterise));
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
