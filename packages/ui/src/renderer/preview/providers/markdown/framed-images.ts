/**
 * 074 FR-055 (extends 044 FR-084, 068 FR-010) — a LOCAL image standing as its own paragraph in a Markdown preview
 * is drawn in a diagram frame, with the controls an inline Mermaid diagram has there (FR-035). Found here, after the
 * sanitiser, the same way `claimRenderedBlocks` finds a claimed fence: the paragraph is what the body replaces with
 * a diagram host. Kept out of `pipeline.ts` and `sanitise.ts` on purpose (spec 075 edits both).
 *
 * Local means served by the preview protocol's asset route — a project file the pipeline already resolved and
 * confined (044 FR-084). A remote image, and an image inline with text (a badge, an icon in a sentence), stay as
 * they are drawn today: framing them would put a toolbar inside a line of text.
 */
import { logExpected } from '@throng/core';
import type { BlockRendererEntry, ClaimedBlock } from '../../blocks/block-renderers.js';

const LOCAL_IMAGE = 'img[src^="throng-preview://asset/"]';

/** Whether `p` holds exactly one local image and nothing else but whitespace. */
function standaloneImage(p: Element): HTMLImageElement | null {
  if (p.children.length !== 1) return null;
  const only = p.children[0]!;
  if (!only.matches(LOCAL_IMAGE)) return null;
  for (const node of p.childNodes) {
    if (node !== only && node.nodeType === 3 && (node.textContent ?? '').trim().length > 0) return null;
  }
  return only as HTMLImageElement;
}

/** 068 FR-056 — the size one embed asks for (`![[x.png|200]]` / `|200x100`, its `width` / `height`); `null` when absent. */
export interface FramedImageSize {
  readonly width: number | null;
  readonly height: number | null;
}

/** A positive whole-number size attribute, else `null`. */
function sizeAttribute(img: Element, name: string): number | null {
  const raw = img.getAttribute(name);
  return raw !== null && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

/**
 * Every standalone local image under `root`, in document order, as a block draws it: its source is the image's URL
 * and the element replaced is its paragraph. `alts` is told each URL's alternative text. Both spellings arrive here as
 * one `<img>` — `![alt](x.png)` from markdown-it, `![[x.png]]` once main's answer (or the body's cache of it) gave the
 * held embed its asset URL — so this is the one claim path for both (R8a).
 *
 * The SIZE belongs to the embed, not the URL (B1): one image embedded at `|100` and again at `|300` is two drawings.
 * An image that asks for one is drawn by `sizedEntry(size)` — which the caller keeps the same per size, so an
 * unchanged image is never drawn again — and any other by `entry`.
 */
export function claimFramedImages(
  root: ParentNode,
  entry: BlockRendererEntry,
  alts: Map<string, string>,
  sizedEntry?: (size: FramedImageSize) => BlockRendererEntry,
): ClaimedBlock[] {
  const claimed: ClaimedBlock[] = [];
  for (const p of root.querySelectorAll<HTMLElement>('p')) {
    const img = standaloneImage(p);
    if (img === null) continue;
    const src = img.getAttribute('src') ?? '';
    alts.set(src, img.getAttribute('alt') ?? '');
    const size: FramedImageSize = { width: sizeAttribute(img, 'width'), height: sizeAttribute(img, 'height') };
    const drawer = sizedEntry !== undefined && (size.width !== null || size.height !== null) ? sizedEntry(size) : entry;
    const lineText = p.getAttribute('data-source-line');
    const line = lineText !== null && /^\d+$/.test(lineText) ? Number(lineText) : null;
    claimed.push({ pre: p, lang: drawer.lang, source: src, line, entry: drawer, height: null });
  }
  return claimed;
}

/**
 * `picture` (an `<svg data-throng-picture>` drawn at its natural size, whose `viewBox` is that size) redrawn at
 * `size`: both given are used as they are; one given scales the other in proportion, as a browser sizes an
 * `<img width>`. No size leaves it natural. The drawing itself takes the size — its `viewBox` and its `<image>` —
 * because the frame reads a drawing's size from its `viewBox` (Zoom 100% is that size).
 */
export function sizeFramedPicture(picture: Element, size: FramedImageSize): void {
  if (size.width === null && size.height === null) return;
  const box = (picture.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const naturalW = box[2] ?? 0;
  const naturalH = box[3] ?? 0;
  if (!(naturalW > 0 && naturalH > 0)) return;
  const width = size.width ?? Math.round((size.height! * naturalW) / naturalH);
  const height = size.height ?? Math.round((size.width! * naturalH) / naturalW);
  picture.setAttribute('viewBox', `0 0 ${width} ${height}`);
  picture.setAttribute('width', String(width));
  picture.setAttribute('height', String(height));
  for (const image of picture.querySelectorAll('image')) {
    image.setAttribute('width', String(width));
    image.setAttribute('height', String(height));
  }
}

/** The asset route's root-relative path inside a `throng-preview://asset/<panel>/<path>` URL, or `null`. */
export function assetPathOf(url: string): string | null {
  const match = /^throng-preview:\/\/asset\/[^/]+\/(.+)$/.exec(url);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch (error) {
    logExpected('framed-images: decode asset path', 'an asset URL with a malformed escape names no file to read', error);
    return null;
  }
}

/** Merge two claim lists into document order. */
export function inDocumentOrder(a: readonly ClaimedBlock[], b: readonly ClaimedBlock[]): ClaimedBlock[] {
  return [...a, ...b].sort((x, y) => (x.pre.compareDocumentPosition(y.pre) & 4 ? -1 : x.pre === y.pre ? 0 : 1));
}
