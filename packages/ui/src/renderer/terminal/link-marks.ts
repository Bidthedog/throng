import { hyperlinkTargetKind } from './terminal-link-activation.js';

/**
 * The terminal's ONE link affordance, drawn as xterm decorations — 045 FR-130, FR-131, FR-135,
 * FR-136, FR-139, FR-154 (contracts/menus-and-gestures.md §7.6, §8.1; data-model §14.2, §15.3).
 *
 *   | at rest            | a dashed underline on EVERY row the link occupies (`linkUnderline`)   |
 *   | hovered            | solid, in `linkUnderlineHover`, on every row of THAT link (FR-131),  |
 *   |                    | and the hand pointer, with or without the modifier (FR-164)          |
 *
 * ══ THE HOVER MARK IS THE HOVERED LINK'S OWN (FR-172, D5) ══
 *
 * The hovered link is drawn from the range the provider (or xterm's OSC 8 hover) handed over, whether
 * or not the view pass has collected it yet. Output that never pauses used to leave the hovered link
 * out of the links in view, and so without any hover mark at all; now a hover is never waiting on a
 * pass. A hovered link not in view is marked for as long as it is hovered, and its marks go with it.
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
 * ══ AN UNFOLLOWABLE HYPERLINK IS TEXT (FR-154, as FR-163 amends it) ══
 *
 * An OSC 8 link is judged by its TARGET's resource class ALONE (FR-163): web, loopback, an allowlisted
 * protocol and any well-formed `file:` target — whatever it points at — are links, marked as drawn,
 * with nothing asked. An empty target, an unknown, refused or non-allowlisted scheme, and a target
 * carrying control characters or `%00` (FR-156) get no mark, no hover state and no pointer. The
 * judgement lives here so no caller can forget it.
 *
 * ══ THE HOVER TITLE (round five, maintainer correction) ══
 *
 * "Hovering over a link in a terminal … should simply show the link text, in full, in the HTML title
 * popup." xterm's canvas has no per-glyph DOM element to hang a native `title` on, so it goes on
 * `deps.host` — the same element `LINK_POINTER_HOST_CLASS` is already toggled on — for as long as a
 * FOLLOWABLE link is hovered, and is cleared the instant it is not (hover-out, a dead OSC 8 target, or
 * dispose). The bespoke floating tooltip this used to be is gone from the terminal entirely; only this
 * native title, and the click-triggered bottom-right hint (`renderer/links/link-hint.tsx`, unrelated to
 * this file), remain.
 *
 * The text is `hoverTitle` when the caller supplies one, else the mark's own `uri` (an OSC 8 target,
 * verbatim) or `text` (a web url, or a detected path's RAW span — not run through
 * `hoveredLinkReadoutText`'s by-name resolution, since this module never sees a base directory or a
 * project root). A caller that wants byte-parity with the status-bar readout for a relative path passes
 * the same string it already computed for `setTerminalLinkReadout` as `hoverTitle`.
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
  readonly buffer: {
    readonly active: { readonly baseY: number; readonly cursorY: number; readonly type?: 'normal' | 'alternate' };
  };
  /** `isDisposed`: xterm's own flag, set when the marker's line is trimmed or deleted. */
  registerMarker(cursorYOffset?: number): { dispose(): void; readonly isDisposed?: boolean } | undefined;
  registerDecoration(options: {
    readonly marker: { dispose(): void; readonly isDisposed?: boolean };
    readonly x?: number;
    readonly width?: number;
    readonly height?: number;
  }): MarkDecoration | undefined;
}

export interface LinkMarksDeps {
  readonly terminal: LinkMarkTerminal;
  /** Columns in a row — a number, or a reader for a terminal that resizes. */
  readonly cols: number | (() => number);
  /**
   * Where the hand pointer is shown (FR-135): the class is toggled on this element. Round five: also
   * where the hovered link's native `title` is set and cleared — see "THE HOVER TITLE" above. A real
   * `HTMLElement` (xterm's mount point) satisfies this structurally; `title` is declared here only
   * because that is all this module reads or writes on it.
   */
  readonly host?:
    | ({ readonly classList: { toggle(c: string, on?: boolean): boolean | void } } & { title?: string })
    | null;
  /** FR-159: the current protocol allowlist, read per sync. Absent: the shipped one. */
  readonly allowlist?: () => ReadonlySet<string>;
}

export interface LinkMarks {
  /**
   * Mark exactly `links` (the ones in view) plus `hovered`, and put `hovered` in the hover state with
   * the pointer. `modifierHeld` no longer changes anything drawn — FR-164 withdrew the modifier-only
   * hand — and is accepted so a caller that still tracks the modifier need not change shape.
   *
   * Round five: also sets `deps.host`'s native `title` to `hoverTitle` while `hovered` is a LIVE,
   * followable link (dropped to `''` the instant it is not — hover-out, or a dead OSC 8 target with no
   * hover state at all). `hoverTitle` absent falls back to `hovered.uri ?? hovered.text` — see "THE
   * HOVER TITLE" at the top of this file.
   */
  sync(
    links: readonly MarkedLink[],
    hovered: MarkedLink | null,
    modifierHeld?: boolean,
    hoverTitle?: string | null,
  ): void;
  dispose(): void;
}

export const LINK_MARK_CLASS = 'terminal-link-mark';
export const LINK_MARK_HOVER_CLASS = 'terminal-link-mark--hover';
export const LINK_MARK_POINTER_CLASS = 'terminal-link-mark--pointer';
/** On the host while a followable link is hovered — the hand, with or without the modifier (FR-164). */
export const LINK_POINTER_HOST_CLASS = 'terminal-link-pointer';
/**
 * On the host while the ALTERNATE buffer is active (045 T280, D5, FR-172). xterm 6's decoration renderer
 * sets `display: none` on every decoration while that buffer is shown, so without this a full-screen
 * program's links were marked but invisible. `terminal.css` shows the marks again under it; the
 * alternate buffer has no scrollback, so there is no out-of-view mark for xterm's hiding to protect.
 */
export const LINK_ALT_BUFFER_HOST_CLASS = 'terminal-alt-buffer';

interface Mark {
  readonly link: MarkedLink;
  readonly parts: { marker: { dispose(): void; readonly isDisposed?: boolean }; decoration: MarkDecoration }[];
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

  /** FR-154 / FR-163: whether this link may be drawn at all. Only an OSC 8 target can be unfollowable. */
  const followable = (link: MarkedLink): boolean => {
    if (link.kind !== 'osc8') return true;
    const uri = link.uri ?? '';
    if (uri.length === 0) return false;
    // The one scheme gate (T290), sanitised first (FR-156): a web, loopback, allowlisted protocol or
    // well-formed `file:` target is a link, by its class alone (FR-163).
    return hyperlinkTargetKind(uri, deps.allowlist?.()) !== null;
  };

  return {
    sync(links, hovered, _modifierHeld, hoverTitle) {
      const live = new Map<string, MarkedLink>();
      for (const link of links) if (followable(link)) live.set(keyOf(link), link);
      // FR-172: the hovered link is marked from its own range, collected by a pass or not. A dead
      // one (FR-154) is still not a link, so it is still not drawn.
      if (hovered !== null && followable(hovered)) live.set(keyOf(hovered), hovered);

      for (const [key, mark] of marks) {
        // 045 T280 (D5): a mark whose marker xterm disposed — its line trimmed or deleted, which a
        // full-screen program's repaint does on the alternate screen while the link stays put — draws
        // nothing any more. Its key is unchanged, so it is dropped here and redrawn below.
        if (live.has(key) && !mark.parts.some((part) => part.marker.isDisposed === true)) continue;
        drop(mark);
        marks.delete(key);
      }
      for (const [key, link] of live) if (!marks.has(key)) marks.set(key, create(link));

      const hoveredKeys = hovered === null ? new Set<string>() : hoverGroup(hovered, [...live.values()]);
      let pointerShown = false;
      for (const [key, mark] of marks) {
        mark.hover = hoveredKeys.has(key);
        mark.pointer = mark.hover; // FR-164: the hand on every hover of a valid link
        pointerShown ||= mark.pointer;
        for (const element of mark.elements) paint(mark, element);
      }
      deps.host?.classList.toggle(LINK_POINTER_HOST_CLASS, pointerShown);
      // Read per sync: a buffer switch clears the marks through a sync (D5), so this follows it.
      deps.host?.classList.toggle(LINK_ALT_BUFFER_HOST_CLASS, deps.terminal.buffer.active.type === 'alternate');
      // Round five — "THE HOVER TITLE" above: a live hover gets a native title (the caller's exact
      // wording, or the mark's own uri/text as a fallback); anything else — nothing hovered, or a
      // hovered target that turned out not to be a live link (FR-154) — clears it, so a title never
      // survives past the pointer leaving the link.
      if (deps.host) {
        deps.host.title = hoveredKeys.size > 0 ? (hoverTitle ?? hovered!.uri ?? hovered!.text) : '';
      }
    },
    dispose() {
      for (const mark of marks.values()) drop(mark);
      marks.clear();
      deps.host?.classList.toggle(LINK_POINTER_HOST_CLASS, false);
      deps.host?.classList.toggle(LINK_ALT_BUFFER_HOST_CLASS, false);
      if (deps.host) deps.host.title = '';
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
