/**
 * View Whitespace (059 FR-059, FR-060, research R17 decision 5) — the per-panel toggle and the CodeMirror
 * extension that draws what is between the characters.
 *
 * ══ PER PANEL, NOT PER DOCUMENT ══
 *
 * Word wrap is a document's (Principle XI); this is a VIEW's, exactly as a cursor or a zoom is: two panels
 * on one document may show it differently (US6 AC3). So the store below is keyed by PANEL id, and holds the
 * panel's own CHOICE — `undefined` until the user makes one, when the panel follows the
 * `editor.defaultShowWhitespace` preference (FR-060). The choice is persisted with the panel
 * (`EditorPanelConfig.showWhitespace`) by `use-editor.ts`, which also seeds this store from it on mount.
 *
 * ══ DECORATION ONLY ══
 *
 * Every symbol is a mark's CSS pseudo-element or a widget. None is text in the document, so none reaches the
 * clipboard (which copies from the document), a save, or the authority (FR-059, US6 AC5).
 */
import { Compartment, RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  highlightSpecialChars,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { useSyncExternalStore } from 'react';
import type { LineEndingId } from '@throng/core';
import { markedCharacterPattern, whitespaceLabel } from './whitespace-labels.js';

// ─── the per-panel choice ────────────────────────────────────────────────────────────────────────────────

const choices = new Map<string, boolean>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Whether this panel shows whitespace: its own choice, or the preference while it has made none. */
export function panelWhitespace(panelId: string, defaultOn: boolean): boolean {
  return choices.get(panelId) ?? defaultOn;
}

/** Record the panel's own choice (a toggle, or a restore from its persisted config). */
export function setPanelWhitespace(panelId: string, on: boolean): void {
  if (choices.get(panelId) === on) return;
  choices.set(panelId, on);
  emit();
}

/** Seed from the persisted config: a panel that never chose (`undefined`) keeps following the preference. */
export function seedPanelWhitespace(panelId: string, chosen: boolean | undefined): void {
  if (chosen === undefined) {
    if (choices.delete(panelId)) emit();
    return;
  }
  setPanelWhitespace(panelId, chosen);
}

/** The panel is gone. */
export function forgetPanelWhitespace(panelId: string): void {
  if (choices.delete(panelId)) emit();
}

export function usePanelWhitespace(panelId: string, defaultOn: boolean): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => panelWhitespace(panelId, defaultOn),
  );
}

/** Test seam. */
export function __resetPanelWhitespace(): void {
  choices.clear();
  emit();
}

// ─── the CodeMirror extension ────────────────────────────────────────────────────────────────────────────

/** The compartment `use-editor.ts` reconfigures when the panel's toggle flips. */
export const whitespaceCompartment = new Compartment();

/**
 * The document's format changed without a text change (a conversion, a Change Encoding, a relay): the
 * line-break and BOM marks are re-read. `use-editor.ts` dispatches it whenever the display copy moves.
 */
export const refreshWhitespace = StateEffect.define<null>();

/** What the marks need of the document's format, read from the display copy at draw time. */
export interface WhitespaceFormat {
  hasBom: boolean;
  /** The uniform ending, or the dominant one when mixed. */
  lineEnding: LineEndingId;
  /**
   * The authority's per-break record, one entry per line break in order — present for a mixed document. Used
   * only while it matches the document's break count; otherwise every break is drawn with `lineEnding`.
   */
  lineEndings?: readonly LineEndingId[];
}

/**
 * The label for each ending, and the name a hover gives it (FR-065, FR-066). The label is the abbreviation as
 * TEXT, not Unicode's control picture: how a picture looks is up to whichever font draws it — Cascadia Mono and
 * Segoe UI Symbol stack its letters diagonally in one cell — so the pictures read differently from theme to theme.
 * A line break has nothing after it on its line, so the label's width moves no text.
 */
const ENDING_SYMBOL: Record<LineEndingId, { symbol: string; name: string }> = {
  lf: { symbol: 'LF', name: 'LF — U+000A LINE FEED' },
  cr: { symbol: 'CR', name: 'CR — U+000D CARRIAGE RETURN' },
  crlf: { symbol: 'CR LF', name: 'CRLF — U+000D U+000A CARRIAGE RETURN, LINE FEED' },
};

class EndingWidget extends WidgetType {
  constructor(readonly ending: LineEndingId) {
    super();
  }
  override eq(other: EndingWidget): boolean {
    return other.ending === this.ending;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-ws-eol';
    el.dataset.ending = this.ending;
    el.dataset.wsName = ENDING_SYMBOL[this.ending].name;
    el.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'cm-ws-eol__label';
    label.textContent = ENDING_SYMBOL[this.ending].symbol;
    el.appendChild(label);
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class BomWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-ws-bom';
    el.dataset.wsName = 'BOM — U+FEFF BYTE ORDER MARK';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = 'B';
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const BOM = Decoration.widget({ widget: new BomWidget(), side: -1 });
const ENDING_DECO: Record<LineEndingId, Decoration> = {
  lf: Decoration.widget({ widget: new EndingWidget('lf'), side: 1 }),
  cr: Decoration.widget({ widget: new EndingWidget('cr'), side: 1 }),
  crlf: Decoration.widget({ widget: new EndingWidget('crlf'), side: 1 }),
};

/** The line-break and BOM marks over the visible lines. */
function breakMarks(view: EditorView, format: WhitespaceFormat): DecorationSet {
  const doc = view.state.doc;
  const breaks = doc.lines - 1;
  const record = format.lineEndings && format.lineEndings.length === breaks ? format.lineEndings : null;
  const builder = new RangeSetBuilder<Decoration>();
  let bomPlaced = false;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (line.number === 1 && format.hasBom && !bomPlaced) {
        builder.add(0, 0, BOM);
        bomPlaced = true;
      }
      if (line.number <= breaks) {
        const ending = record?.[line.number - 1] ?? format.lineEnding;
        builder.add(line.to, line.to, ENDING_DECO[ending]);
      }
      if (line.to + 1 > doc.length || line.number === doc.lines) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const breakPlugin = (getFormat: () => WhitespaceFormat): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = breakMarks(view, getFormat());
      }
      update(update: ViewUpdate): void {
        const refreshed = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshWhitespace)));
        if (update.docChanged || update.viewportChanged || refreshed) {
          this.decorations = breakMarks(update.view, getFormat());
        }
      }
    },
    { decorations: (p) => p.decorations },
  );

// Named on hover like every other marker (FR-065, FR-067).
const SPACE = Decoration.mark({ class: 'cm-ws-space', attributes: { 'data-ws-name': 'SP — U+0020 SPACE' } });
const TAB = Decoration.mark({
  class: 'cm-ws-tab',
  attributes: { 'data-ws-name': 'HT — U+0009 CHARACTER TABULATION' },
});
const spaceTabMatcher = new MatchDecorator({
  regexp: /[ \t]/g,
  decoration: (m) => (m[0] === ' ' ? SPACE : TAB),
});

const spaceTabPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = spaceTabMatcher.createDeco(view);
    }
    update(update: ViewUpdate): void {
      this.decorations = spaceTabMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (p) => p.decorations },
);

/**
 * Every other invisible character (FR-062): the C0 and C1 controls, DEL, the Unicode spaces and the invisible
 * look-alikes, each replaced on screen by a one-cell box holding its family's glyph (`°` a no-break space, `ø` a
 * zero-width character, `ε` ESC — FR-064), with its abbreviation and full name on hover (FR-067). CodeMirror's
 * own special-character drawing, given the set and the rendering.
 */
const specialChars = highlightSpecialChars({
  specialChars: markedCharacterPattern(),
  render: (code) => {
    const label = whitespaceLabel(code);
    const el = document.createElement('span');
    el.className = 'cm-ws-control';
    el.dataset.code = code.toString(16).toUpperCase().padStart(4, '0');
    const name = label?.name ?? `U+${el.dataset.code}`;
    el.dataset.wsName = label && !label.abbr.startsWith('U+') ? `${label.abbr} — ${name}` : name;
    el.setAttribute('aria-label', el.dataset.wsName);
    el.textContent = label?.glyph ?? '■';
    return el;
  },
});

/** How long the pointer rests on a marker before its name shows (FR-067). */
export const HOVER_NAME_DELAY_MS = 500;
/** The gap between the pointer and the popover's bottom edge, and the popover's distance from the window's. */
const POINTER_GAP_PX = 14;
const EDGE_PX = 4;

/**
 * The hover-name popover (FR-067): after {@link HOVER_NAME_DELAY_MS} on a marker, its `data-ws-name` in a small
 * surface just above the pointer, following it while it stays on that marker. Moving to another marker starts
 * the wait again, so a sweep across a line shows nothing. Leaving the marker, scrolling or a key press closes it.
 * Portaled to the body and `position: fixed`, so no editor container clips it; it never takes the pointer, so
 * it cannot swallow the hover that keeps it open.
 */
const hoverNamePlugin = ViewPlugin.fromClass(
  class {
    private target: HTMLElement | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private tip: HTMLElement | null = null;
    private x = 0;
    private y = 0;

    constructor(readonly view: EditorView) {
      view.dom.addEventListener('mousemove', this.move);
      view.dom.addEventListener('mouseleave', this.hide);
      view.dom.addEventListener('keydown', this.hide);
      view.scrollDOM.addEventListener('scroll', this.hide);
    }

    private readonly move = (e: MouseEvent): void => {
      this.x = e.clientX;
      this.y = e.clientY;
      const over = (e.target as Element | null)?.closest?.<HTMLElement>('[data-ws-name]') ?? null;
      if (over === this.target) {
        if (this.tip) this.place();
        return;
      }
      this.hide();
      this.target = over;
      if (over) this.timer = setTimeout(this.show, HOVER_NAME_DELAY_MS);
    };

    private readonly show = (): void => {
      if (!this.target?.isConnected) return;
      const doc = this.view.dom.ownerDocument;
      const tip = doc.createElement('div');
      tip.className = 'cm-ws-hover-name';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = this.target.dataset.wsName ?? '';
      doc.body.appendChild(tip);
      this.tip = tip;
      this.place();
    };

    /** Centred above the pointer, kept inside the window; below it when there is no room above. */
    private place(): void {
      const tip = this.tip;
      if (!tip) return;
      const win = this.view.dom.ownerDocument.defaultView;
      const { width, height } = tip.getBoundingClientRect();
      const maxLeft = (win?.innerWidth ?? Infinity) - width - EDGE_PX;
      const left = Math.max(EDGE_PX, Math.min(this.x - width / 2, maxLeft));
      const above = this.y - height - POINTER_GAP_PX;
      const top = above >= EDGE_PX ? above : this.y + POINTER_GAP_PX + 6;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }

    private readonly hide = (): void => {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.target = null;
      this.tip?.remove();
      this.tip = null;
    };

    destroy(): void {
      this.view.dom.removeEventListener('mousemove', this.move);
      this.view.dom.removeEventListener('mouseleave', this.hide);
      this.view.dom.removeEventListener('keydown', this.hide);
      this.view.scrollDOM.removeEventListener('scroll', this.hide);
      this.hide();
    }
  },
);

/** The popover, and the class that turns on the help cursor over boxed markers (FR-066, FR-067). */
const hoverNames: Extension = [hoverNamePlugin, EditorView.editorAttributes.of({ class: 'cm-ws-hover-names' })];

/**
 * Everything View Whitespace draws. `getFormat` is read at draw time, never captured. `hoverNames` is the
 * `editor.whitespaceHoverNames` preference: off, there is no popover and no help cursor (FR-067).
 */
export function viewWhitespace(getFormat: () => WhitespaceFormat, opts: { hoverNames: boolean }): Extension {
  return [spaceTabPlugin, breakPlugin(getFormat), specialChars, opts.hoverNames ? hoverNames : []];
}
