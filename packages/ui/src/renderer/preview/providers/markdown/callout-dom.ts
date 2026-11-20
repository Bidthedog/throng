/**
 * The Markdown body's callout pass (075, FR-001 – FR-010, FR-024, research R3, contracts/callout-markup.md
 * §Body DOM pass).
 *
 * Runs over SANITISED DOM. It adds only throng-made things — icon markup from the icon resolver, a fold control,
 * focus and ARIA attributes, a hover — to elements the sanitiser kept as pipeline callouts, so nothing here can
 * be steered by the document beyond choosing among registry types.
 *
 * ══ FOLD STATE IS VIEW STATE (FR-008) ══
 *
 * Held here, per body, keyed by the callout's marker line as written plus its occurrence among identical marker
 * lines. Typing elsewhere moves a callout's line number but not its key, so a callout the reader opened stays
 * open through a live re-render; editing the marker itself (its sign, say) is a new key, so the callout starts
 * from what the marker now says. Nothing is written to main or to the document, and Collapse All / Expand All
 * (sections, 047 FR-038) never reach it (FR-009).
 */
import { calloutTypeEntry, type IconKey } from '@throng/core';
import { CALLOUT_ATTRIBUTE, CALLOUT_BODY_ATTRIBUTE, CALLOUT_FOLD_ATTRIBUTE, CALLOUT_ICON_ATTRIBUTE, CALLOUT_TITLE_ATTRIBUTE } from './callout-markup.js';
import { registerNodeRevealer, revealNodeAt } from '../../node-reveal.js';

/** Present on a collapsed foldable callout; `markdown.css` hides its body. Excluded from print (FR-074). */
export const CALLOUT_COLLAPSED_ATTRIBUTE = 'data-callout-collapsed';
/** The fold control's class — chrome, so find, copy and print leave it out. */
export const CALLOUT_FOLD_CONTROL_CLASS = 'preview-callout__fold';
/** The icon holder's class, for the same exclusions. */
export const CALLOUT_ICON_CLASS = 'preview-callout__icon';

const ICON_EXPANDED: IconKey = 'foldPreviewExpanded';
const ICON_COLLAPSED: IconKey = 'foldPreviewCollapsed';

export type CalloutIconResolver = (key: IconKey) => string;

export interface CalloutFolds {
  /** Draw icons and fold controls into `root`'s callouts, applying the remembered fold state. Before or after insertion. */
  decorate(root: ParentNode, text: string, iconFor: CalloutIconResolver): void;
  /** Answer clicks and keys on `root`'s title rows, and register this state's reveal for it (`node-reveal.ts`). Returns the detach. */
  attach(root: HTMLElement): () => void;
  /** Redraw every icon under `root` from a new resolver (a theme or icon set change). */
  refreshIcons(root: ParentNode, iconFor: CalloutIconResolver): void;
  /** Forget every remembered state: a different file starts from its markers' signs. */
  reset(): void;
}

/** The `<span class="icon">` the shared `Icon` component draws, built the way `fold-gutter.ts` builds it. */
function iconSpan(doc: Document, markup: string): HTMLElement {
  const span = doc.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  // Safe: the default set is compiled in and user sets are sanitised in main at load time (`common/icon.tsx`).
  span.innerHTML = markup;
  return span;
}

function titleRowOf(callout: Element): HTMLElement | null {
  for (const child of callout.children) if (child.hasAttribute(CALLOUT_TITLE_ATTRIBUTE)) return child as HTMLElement;
  return null;
}

function isFoldable(callout: Element): boolean {
  return callout.hasAttribute(CALLOUT_FOLD_ATTRIBUTE);
}

class Controller implements CalloutFolds {
  /** Remembered open (`true`) / closed (`false`) by key. */
  private readonly state = new Map<string, boolean>();
  private readonly keys = new WeakMap<Element, string>();
  private iconFor: CalloutIconResolver = () => '';

  /** `onFoldChange` — a reader opened or closed a callout (a click, a key, a reveal), changing what is hidden. */
  constructor(private readonly onFoldChange: () => void) {}

  decorate(root: ParentNode, text: string, iconFor: CalloutIconResolver): void {
    this.iconFor = iconFor;
    const lines = text.split(/\r\n|\n|\r/);
    const seen = new Map<string, number>();
    const live = new Set<string>();
    for (const callout of root.querySelectorAll<HTMLElement>(`[${CALLOUT_ATTRIBUTE}]`)) {
      const lineText = /^\d+$/.test(callout.getAttribute('data-source-line') ?? '')
        ? (lines[Number(callout.getAttribute('data-source-line'))] ?? '').trim()
        : '';
      const n = seen.get(lineText) ?? 0;
      seen.set(lineText, n + 1);
      const key = `${lineText}#${n}`;
      live.add(key);
      this.keys.set(callout, key);
      this.drawIcon(callout);
      if (!isFoldable(callout)) continue;
      this.apply(callout, this.state.get(key) ?? callout.getAttribute(CALLOUT_FOLD_ATTRIBUTE) === 'open');
    }
    // `root` is the whole document. A key it no longer has is a marker that changed or went: should it come
    // back, it starts from its sign again.
    for (const key of [...this.state.keys()]) if (!live.has(key)) this.state.delete(key);
  }

  attach(root: HTMLElement): () => void {
    const unregister = registerNodeRevealer(root, (node) => this.reveal(node));
    const onClick = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      // A link (or any other control) inside the title keeps its own click.
      if (target === null || target.closest('a, [role="link"], button, input') !== null) return;
      const row = target.closest<HTMLElement>(`[${CALLOUT_TITLE_ATTRIBUTE}]`);
      const callout = row?.parentElement;
      if (row === null || callout === null || callout === undefined || !root.contains(row) || !isFoldable(callout)) return;
      this.toggle(callout);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target instanceof HTMLElement ? event.target : null;
      if (row === null || !row.hasAttribute(CALLOUT_TITLE_ATTRIBUTE)) return;
      const callout = row.parentElement;
      if (callout === null || !isFoldable(callout)) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggle(callout);
    };
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
      unregister();
    };
  }

  refreshIcons(root: ParentNode, iconFor: CalloutIconResolver): void {
    this.iconFor = iconFor;
    for (const callout of root.querySelectorAll<HTMLElement>(`[${CALLOUT_ATTRIBUTE}]`)) {
      this.drawIcon(callout);
      if (isFoldable(callout)) this.apply(callout, !callout.hasAttribute(CALLOUT_COLLAPSED_ATTRIBUTE));
    }
  }

  reset(): void {
    this.state.clear();
  }

  /** Open every collapsed callout `node` sits inside; whether any was. */
  reveal(node: Node): boolean {
    let opened = false;
    let el: Element | null = node instanceof Element ? node : node.parentElement;
    while (el !== null) {
      const body = el.closest(`[${CALLOUT_BODY_ATTRIBUTE}]`);
      const callout = body?.parentElement ?? null;
      if (callout === null || !callout.hasAttribute(CALLOUT_ATTRIBUTE)) break;
      if (callout.hasAttribute(CALLOUT_COLLAPSED_ATTRIBUTE)) {
        this.set(callout as HTMLElement, true);
        opened = true;
      }
      el = callout.parentElement;
    }
    return opened;
  }

  private toggle(callout: HTMLElement): void {
    this.set(callout, callout.hasAttribute(CALLOUT_COLLAPSED_ATTRIBUTE));
  }

  private set(callout: HTMLElement, open: boolean): void {
    const key = this.keys.get(callout);
    if (key !== undefined) this.state.set(key, open);
    this.apply(callout, open);
    this.onFoldChange();
  }

  private drawIcon(callout: HTMLElement): void {
    const holder = titleRowOf(callout)?.querySelector<HTMLElement>(`:scope > [${CALLOUT_ICON_ATTRIBUTE}]`);
    const entry = calloutTypeEntry(callout.getAttribute(CALLOUT_ATTRIBUTE) ?? '');
    if (holder === null || holder === undefined || entry === undefined) return;
    holder.classList.add(CALLOUT_ICON_CLASS);
    holder.setAttribute('aria-hidden', 'true');
    holder.replaceChildren(iconSpan(holder.ownerDocument, this.iconFor(entry.icon)));
  }

  private apply(callout: HTMLElement, open: boolean): void {
    const row = titleRowOf(callout);
    if (row === null) return;
    callout.toggleAttribute(CALLOUT_COLLAPSED_ATTRIBUTE, !open);
    row.setAttribute('tabindex', '0');
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
    row.setAttribute('title', open ? 'Collapse callout' : 'Expand callout');
    let control = row.querySelector<HTMLElement>(`:scope > .${CALLOUT_FOLD_CONTROL_CLASS}`);
    if (control === null) {
      control = row.ownerDocument.createElement('span');
      control.className = CALLOUT_FOLD_CONTROL_CLASS;
      control.setAttribute('aria-hidden', 'true');
      row.append(control);
    }
    control.replaceChildren(iconSpan(row.ownerDocument, this.iconFor(open ? ICON_EXPANDED : ICON_COLLAPSED)));
  }
}

/**
 * A body's callout fold state. `onFoldChange` runs after a reader opens or closes a callout — not for the fold state a
 * draw applies, which the draw reports itself — so the body can re-index what is hidden (`block-index.ts`).
 */
export function createCalloutFolds(onFoldChange: () => void = () => undefined): CalloutFolds {
  return new Controller(onFoldChange);
}

/**
 * FR-010 — open every collapsed callout around `node`, through the fold state of the body it belongs to (so a
 * re-render keeps it open). For the panel's find and link reveal, which know a node but not the body's state.
 */
export function revealCalloutsAt(node: Node): boolean {
  return revealNodeAt(node);
}
