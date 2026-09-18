import { classifyTerminalLinkTarget } from '@throng/core';
import { peekLink } from '../links/link-cache.js';
import { terminalLinkRequest, type TerminalLinkSite } from './terminal-link-activation.js';

/**
 * The terminal's ONE link affordance, drawn as xterm decorations — 045 FR-130, FR-131, FR-135,
 * FR-136, FR-139, FR-154 (contracts/menus-and-gestures.md §7.6, §8.1; data-model §14.2, §15.3).
 *
 *   | at rest            | a dashed underline on EVERY row the link occupies (`linkUnderline`)   |
 *   | hovered            | solid, in `linkUnderlineHover`, on every row of THAT link (FR-131)   |
 *   | hovered + modifier | the hand pointer — only then, because only then does a click follow |
 *
 * ══ WHY THRONG DRAWS IT, AND NOT XTERM (O10, research.md R22) ══
 *
 * xterm 6.0.0 hard-codes its own link visuals: every OSC 8 cell renders as `xterm-underline-5` (a
 * dashed underline in the cell's own colour, whatever its target), and a hovered link gets an inline
 * solid underline and the pointer, from any provider. No option takes a colour or a style. So one
 * look for all three kinds (FR-139), in the theme's tokens (FR-138), with no text recolour, can only
 * be drawn here — and xterm's own is switched off: `decorations` false on every link throng serves,
 * and `terminal.css` neutralising the OSC 8 underline and xterm's pointer inside a terminal panel.
 *
 * ══ A DEAD HYPERLINK IS TEXT (FR-154) ══
 *
 * An OSC 8 link is judged by its TARGET: `http(s)` is marked as drawn; a `file:` target only once it
 * has RESOLVED, read from the same cache the hover and the idle scan fill (P4); anything else — an
 * unknown scheme, an empty target, a file that does not exist, a host that does not answer — gets no
 * mark, no hover state and no pointer. The judgement lives here so no caller can forget it.
 */

/** A link as the provider or xterm hands it over — 1-based inclusive range — with its kind. */
export interface MarkedLink {
  readonly kind: 'file' | 'web' | 'osc8';
  readonly text: string;
  readonly range: {
    readonly start: { readonly x: number; readonly y: number };
    readonly end: { readonly x: number; readonly y: number };
  };
  /** An OSC 8 link's declared target — what decides whether it is a link at all (FR-154). */
  readonly uri?: string;
}

/** The slice of an xterm decoration this uses. */
interface MarkDecoration {
  readonly element?: HTMLElementish | undefined;
  onRender(listener: (element: HTMLElementish) => void): { dispose(): void };
  dispose(): void;
}

interface HTMLElementish {
  readonly classList: { add(...c: string[]): void; toggle(c: string, on?: boolean): boolean | void };
}

/** The slice of xterm's `Terminal` this uses: markers and decorations, and where the cursor is. */
export interface LinkMarkTerminal {
  readonly buffer: { readonly active: { readonly baseY: number; readonly cursorY: number } };
  registerMarker(cursorYOffset?: number): { dispose(): void } | undefined;
  registerDecoration(options: {
    readonly marker: { dispose(): void };
    readonly x?: number;
    readonly width?: number;
    readonly height?: number;
  }): MarkDecoration | undefined;
}

export interface LinkMarksDeps {
  readonly terminal: LinkMarkTerminal;
  /** Columns in a row — a number, or a reader for a terminal that resizes. */
  readonly cols: number | (() => number);
  /** The panel an OSC 8 `file:` target is judged for — the site the hover and the scan ask with. */
  readonly site: () => TerminalLinkSite;
  /** Where the hand pointer is shown (FR-135): the class is toggled on this element. */
  readonly host?: { readonly classList: { toggle(c: string, on?: boolean): boolean | void } } | null;
}

export interface LinkMarks {
  /** Mark exactly `links` (the ones in view), `hovered` in the hover state, the pointer if held. */
  sync(links: readonly MarkedLink[], hovered: MarkedLink | null, modifierHeld: boolean): void;
  dispose(): void;
}

export const LINK_MARK_CLASS = 'terminal-link-mark';
export const LINK_MARK_HOVER_CLASS = 'terminal-link-mark--hover';
export const LINK_MARK_POINTER_CLASS = 'terminal-link-mark--pointer';
/** On the host while a followable link is hovered WITH the modifier — the only time it is a hand. */
export const LINK_POINTER_HOST_CLASS = 'terminal-link-pointer';

interface Mark {
  readonly link: MarkedLink;
  readonly parts: { marker: { dispose(): void }; decoration: MarkDecoration }[];
  readonly elements: Set<HTMLElementish>;
  hover: boolean;
  pointer: boolean;
}

export function createLinkMarks(deps: LinkMarksDeps): LinkMarks {
  const marks = new Map<string, Mark>();
  const cols = (): number => (typeof deps.cols === 'number' ? deps.cols : deps.cols());

  const paint = (mark: Mark, element: HTMLElementish): void => {
    element.classList.add(LINK_MARK_CLASS);
    element.classList.toggle(LINK_MARK_HOVER_CLASS, mark.hover);
    element.classList.toggle(LINK_MARK_POINTER_CLASS, mark.pointer);
  };

  const create = (link: MarkedLink): Mark => {
    const mark: Mark = { link, parts: [], elements: new Set(), hover: false, pointer: false };
    const { baseY, cursorY } = deps.terminal.buffer.active;
    const width = cols();
    for (let y = link.range.start.y; y <= link.range.end.y; y += 1) {
      // xterm's range is 1-based and inclusive; a decoration's `x` is 0-based and `width` a count.
      const from = y === link.range.start.y ? link.range.start.x - 1 : 0;
      const to = y === link.range.end.y ? link.range.end.x : width;
      if (to <= from) continue;
      const marker = deps.terminal.registerMarker(y - 1 - (baseY + cursorY));
      if (marker === undefined) continue;
      const decoration = deps.terminal.registerDecoration({ marker, x: from, width: to - from, height: 1 });
      if (decoration === undefined) {
        marker.dispose();
        continue;
      }
      decoration.onRender((element) => {
        mark.elements.add(element);
        paint(mark, element);
      });
      mark.parts.push({ marker, decoration });
    }
    return mark;
  };

  const drop = (mark: Mark): void => {
    for (const { marker, decoration } of mark.parts) {
      decoration.dispose();
      marker.dispose();
    }
  };

  /** FR-154: whether this link may be drawn at all. Only an OSC 8 link can be dead. */
  const followable = (link: MarkedLink): boolean => {
    if (link.kind !== 'osc8') return true;
    const uri = link.uri ?? '';
    if (uri.length === 0) return false;
    switch (classifyTerminalLinkTarget(uri)) {
      case 'web':
        return true;
      case 'file':
        return (
          peekLink(terminalLinkRequest({ text: uri, kind: 'fileHyperlink', site: deps.site() }))?.ok === true
        );
      default:
        return false;
    }
  };

  return {
    sync(links, hovered, modifierHeld) {
      const live = new Map<string, MarkedLink>();
      for (const link of links) if (followable(link)) live.set(keyOf(link), link);

      for (const [key, mark] of marks) {
        if (live.has(key)) continue;
        drop(mark);
        marks.delete(key);
      }
      for (const [key, link] of live) if (!marks.has(key)) marks.set(key, create(link));

      const hoveredKeys = hovered === null ? new Set<string>() : hoverGroup(hovered, [...live.values()]);
      let pointerShown = false;
      for (const [key, mark] of marks) {
        mark.hover = hoveredKeys.has(key);
        mark.pointer = mark.hover && modifierHeld;
        pointerShown ||= mark.pointer;
        for (const element of mark.elements) paint(mark, element);
      }
      deps.host?.classList.toggle(LINK_POINTER_HOST_CLASS, pointerShown);
    },
    dispose() {
      for (const mark of marks.values()) drop(mark);
      marks.clear();
      deps.host?.classList.toggle(LINK_POINTER_HOST_CLASS, false);
    },
  };
}

function keyOf(link: MarkedLink): string {
  const { start, end } = link.range;
  return `${link.kind} ${start.y}:${start.x}-${end.y}:${end.x} ${link.uri ?? ''} ${link.text}`;
}

/**
 * The marks that light up with `hovered` (FR-131): the link itself — and, for an OSC 8 link, every
 * row of the same target that continues it. xterm reports a wrapped OSC 8 link one ROW at a time, so
 * without this only the row under the pointer would light.
 */
function hoverGroup(hovered: MarkedLink, live: readonly MarkedLink[]): Set<string> {
  const group = new Set<string>();
  const hoveredKey = keyOf(hovered);
  if (!live.some((l) => keyOf(l) === hoveredKey)) return group; // a dead link has no hover state
  group.add(hoveredKey);
  if (hovered.kind !== 'osc8') return group;
  const same = live.filter((l) => l.kind === 'osc8' && l.uri === hovered.uri);
  let top = hovered.range.start.y;
  let bottom = hovered.range.end.y;
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of same) {
      const key = keyOf(l);
      if (group.has(key)) continue;
      if (l.range.end.y === top - 1 || l.range.start.y === bottom + 1) {
        group.add(key);
        top = Math.min(top, l.range.start.y);
        bottom = Math.max(bottom, l.range.end.y);
        grew = true;
      }
    }
  }
  return group;
}
