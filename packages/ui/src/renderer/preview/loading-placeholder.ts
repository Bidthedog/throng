/**
 * The one placeholder for anything in a preview that is still loading (075 FR-043a): an equation the typesetter has
 * not reached, an image still arriving, a diagram still drawing. It is the app's own spinner (`common/loading.tsx`'s
 * `Spinner`: the theme's `busy` glyph in its turning box), built as plain DOM for content a body draws itself, and
 * styled once (`preview.css`) — inline beside text, or as a block naming what it waits for.
 *
 * Provider-agnostic: it names no provider, and the busy glyph's markup comes from the caller's icon resolver, so it
 * follows the active theme and icon set like every other icon.
 */

import '../common/loading.css';
import '../common/busy-glyph.css';
import './loading-placeholder.css';

/** The placeholder's class; `--block` for the block form. */
export const PREVIEW_LOADING_CLASS = 'preview-loading';

/** Set on an image still loading; it is hidden, and the placeholder before it stands in, until it loads or fails. */
export const IMAGE_PENDING_ATTRIBUTE = 'data-image-pending';

export interface LoadingPlaceholderOptions {
  /** What is loading, as assistive technology reads it ("Typesetting equation"). */
  readonly label: string;
  /** The `busy` icon's markup, from the active theme and icon set. */
  readonly busyIcon: string;
  /** A block on its own line, with the label in words; otherwise inline, the glyph alone. */
  readonly block: boolean;
}

/** A placeholder element, as `Spinner` draws it. */
export function loadingPlaceholder(doc: Document, { label, busyIcon, block }: LoadingPlaceholderOptions): HTMLElement {
  const host = doc.createElement(block ? 'div' : 'span');
  host.className = block ? `${PREVIEW_LOADING_CLASS} ${PREVIEW_LOADING_CLASS}--block` : PREVIEW_LOADING_CLASS;
  host.setAttribute('role', 'status');
  host.setAttribute('aria-label', label);
  const spinner = doc.createElement('span');
  spinner.className = 'throng-spinner';
  const glyph = doc.createElement('span');
  glyph.className = 'busy-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  const icon = doc.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  // Safe: the default set is compiled in and user sets are sanitised in main at load time (`common/icon.tsx`).
  // The markup's indentation is dropped, so the placeholder adds no text to a selection around it.
  icon.innerHTML = busyIcon.replace(/>\s+</g, '><').trim();
  glyph.append(icon);
  spinner.append(glyph);
  host.append(spinner);
  if (block) {
    const words = doc.createElement('span');
    words.textContent = `${label}…`;
    host.append(words);
  }
  return host;
}

/**
 * Hold the place of every image under `root` still loading with an inline placeholder, until it loads or fails —
 * a failure's alternative text is the body's to draw (FR-084).
 */
export function showImagesPending(root: ParentNode, busyIcon: string): void {
  for (const img of root.querySelectorAll<HTMLImageElement>(`img:not([${IMAGE_PENDING_ATTRIBUTE}])`)) {
    if (img.complete) continue;
    const placeholder = loadingPlaceholder(img.ownerDocument, { label: 'Loading image', busyIcon, block: false });
    img.setAttribute(IMAGE_PENDING_ATTRIBUTE, '');
    img.before(placeholder);
    const settle = (): void => {
      img.removeEventListener('load', settle);
      img.removeEventListener('error', settle);
      img.removeAttribute(IMAGE_PENDING_ATTRIBUTE);
      placeholder.remove();
    };
    img.addEventListener('load', settle);
    img.addEventListener('error', settle);
  }
}
