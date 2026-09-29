/**
 * The Markdown preview's fold gutter and section hiding (047 T044/T045, FR-030 – FR-032b, FR-035,
 * research R6, contracts/menus-commands-controls.md "Gutter controls").
 *
 * ══ THRONG-CREATED, NEVER FROM DOCUMENT MARKUP (FR-041, R6) ══
 *
 * Fold points come from the `HeadingRecord[]` the pipeline emitted for THIS render (`pipeline.ts`),
 * never re-derived by walking the sanitised DOM — a `<h2 data-heading-slug="spoof">` in raw HTML is
 * not a fold point, because it is not in that list. This module is called AFTER sanitising, from
 * `markdown-body.tsx`'s draw effect, on the fragment already inserted into the document: it locates
 * each heading's element by `data-heading-slug` (a value the sanitiser only keeps on an element that
 * carries the pipeline's per-render nonce — `pipeline.ts`'s `PipelineContext`), it never trusts the
 * attribute to MEAN a fold point exists there.
 *
 * ══ ONE LINEAR PASS, USING CORE'S OWN DEFINITIONS ══
 *
 * `visibleSections` (whether a heading is shown at all) and `isCollapsed` (whether a shown section's
 * own content is hidden) are `@throng/core`'s `outline/fold-state.ts` — the same functions the editor
 * side and the reducer's own tests hold to FR-030a/FR-037a. This module does not re-derive ancestor
 * collapse; it asks core, once per heading, and hides exactly the DOM this render owns: `root`'s
 * direct children. A heading's own "trailing blocks" are the direct children between it and the NEXT
 * heading in document order (whatever THAT heading's level) — nested content is handled when this
 * function visits that deeper heading in the same pass, not by this heading hiding it directly.
 *
 * ══ THE GUTTER IS A GENERIC SLOT (FR-032a) ══
 *
 * `.preview-markdown--gutter` only reserves the width and shifts the document; the toggle button is
 * the one thing drawn into it today. A later control (e.g. a diagnostics marker) can share the slot
 * without this module's class name implying "folding" is the only thing a gutter can hold.
 */
import { buildSymbolTree, isCollapsed, visibleSections, type FoldState, type HeadingRecord, type IconAsset } from '@throng/core';

/** The class `.preview-markdown` carries while the gutter is shown (R6, contracts "Gutter controls"). */
export const GUTTER_CLASS = 'preview-markdown--gutter';

/** The class every inserted toggle carries — excluded from copy (`copy.ts`) and from find (R1). */
export const TOGGLE_CLASS = 'preview-fold-toggle';

/**
 * Resolves an icon token to what it renders as — `@throng/core`'s `resolveIconAsset`, bound to the
 * active theme and icon packs by the caller. Injected rather than imported so this module stays free
 * of React (it manipulates DOM the pipeline produced, not a React tree) and a test can assert on the
 * token requested without a real theme.
 */
export type IconResolver = (token: string) => IconAsset;

export interface FoldGutterOptions {
  /** The Markdown provider's gutter setting (FR-032b), as it stands for this render. */
  readonly gutter: boolean;
  readonly foldState: FoldState;
  /** A toggle was clicked for `slug` — the caller publishes the new `FoldState` (Principle XI). */
  readonly onToggle: (slug: string) => void;
  readonly iconFor: IconResolver;
}

const ICON_EXPANDED = 'foldPreviewExpanded';
const ICON_COLLAPSED = 'foldPreviewCollapsed';

function labelFor(collapsed: boolean, headingText: string): string {
  return `${collapsed ? 'Expand' : 'Collapse'} section ${headingText}`;
}

/** The `<span class="icon">` an inserted toggle carries, built exactly as the shared `Icon` component would. */
function renderIconInto(host: HTMLElement, asset: IconAsset): void {
  const span = host.ownerDocument.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  if (asset.kind === 'svg') {
    // Safe: sanitised in main at pack-load time, exactly as `common/icon.tsx` relies on (017/#54).
    span.innerHTML = asset.markup;
  } else if (asset.kind === 'glyph') {
    span.textContent = asset.glyph;
  }
  host.append(span);
}

/**
 * A fresh toggle for `slug`, inserted as `headingEl`'s FIRST child (R6): a `throng`-made control, never
 * derived from — and never mistaken for — the document's own content. Not in the Tab order (FR-096b's
 * links keep it): folding is reached by the chords and the menus, not by tabbing through the document.
 */
function insertToggle(headingEl: HTMLElement, slug: string, collapsed: boolean, options: FoldGutterOptions): void {
  const button = headingEl.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = TOGGLE_CLASS;
  button.tabIndex = -1;
  button.style.userSelect = 'none';
  button.setAttribute('aria-expanded', String(!collapsed));
  const text = headingEl.textContent ?? '';
  // FR-049 — the toggle sits INSIDE the heading, and Chromium folds a child button's label into the
  // heading's own name ("Collapse section Install Install"). Pin the heading's name to its text; the
  // sanitiser admits no aria-* attribute, so this never overwrites an author's.
  headingEl.setAttribute('aria-label', text);
  const label = labelFor(collapsed, text);
  button.setAttribute('aria-label', label);
  button.title = label;
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    options.onToggle(slug);
  });
  renderIconInto(button, options.iconFor(collapsed ? ICON_COLLAPSED : ICON_EXPANDED));
  headingEl.insertBefore(button, headingEl.firstChild);
}

/** The elements in `children` strictly after `after` and strictly before `before` (or to the end). */
function blocksBetween(children: readonly HTMLElement[], after: HTMLElement, before: HTMLElement | null): HTMLElement[] {
  const startIndex = children.indexOf(after) + 1;
  const endIndex = before === null ? children.length : children.indexOf(before);
  return endIndex > startIndex ? children.slice(startIndex, endIndex) : [];
}

/**
 * Every heading element among `root`'s DIRECT children, by the slug the pipeline recorded for it —
 * the DOM is walked once, matched against the render's own `headings` list, never the other way round.
 */
function headingElements(root: HTMLElement, headings: readonly HeadingRecord[]): Map<string, HTMLElement> {
  const wanted = new Set(headings.map((h) => h.slug));
  const out = new Map<string, HTMLElement>();
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const slug = child.getAttribute('data-heading-slug');
    if (slug !== null && wanted.has(slug) && !out.has(slug)) out.set(slug, child);
  }
  return out;
}

/**
 * Insert the gutter's toggles (when `gutter` is on) and hide the blocks a collapsed section owns — the
 * whole of T044/T045's DOM work, run once after every render `markdown-body.tsx` draws.
 *
 * Idempotent: removes any toggle this module inserted before deciding whether to insert fresh ones, so
 * calling it again over the SAME already-dressed DOM (a settings change with no new render) never
 * duplicates a button.
 */
export function applyFoldGutter(root: HTMLElement, headings: readonly HeadingRecord[], options: FoldGutterOptions): void {
  for (const stale of Array.from(root.querySelectorAll(`.${TOGGLE_CLASS}`))) {
    stale.parentElement?.removeAttribute('aria-label');
    stale.remove();
  }
  root.classList.toggle(GUTTER_CLASS, options.gutter);
  if (headings.length === 0) return;

  const bySlug = headingElements(root, headings);
  const children = Array.from(root.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
  const visible = visibleSections(options.foldState, buildSymbolTree(headings));

  headings.forEach((record, index) => {
    const headingEl = bySlug.get(record.slug);
    if (!headingEl) return;
    const shown = visible.has(record.slug);
    headingEl.hidden = !shown;
    const collapsedHere = isCollapsed(options.foldState, record.slug);
    const hideTrailing = !shown || collapsedHere;
    const next = headings[index + 1];
    const nextEl = next ? (bySlug.get(next.slug) ?? null) : null;
    for (const block of blocksBetween(children, headingEl, nextEl)) block.hidden = hideTrailing;
    if (shown && options.gutter) insertToggle(headingEl, record.slug, collapsedHere, options);
  });
}

