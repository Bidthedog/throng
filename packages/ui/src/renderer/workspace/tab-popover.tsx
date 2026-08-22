/**
 * 031 US6 / FR-051 — the tab hover POPOVER.
 *
 * FR-043 said the hover names the tab, counts its panels and then lists them "one per line", and it
 * was implemented as the native `title` attribute because that was the only thing to hand. A native
 * tooltip is a single run of plain text: it cannot indent, cannot weight the tab's own name against
 * the panels inside it, and renders every line as a peer of every other. So the answer to "what is
 * in this tab?" arrived as a flat wall the user had to parse. FR-051 supersedes that phrasing — the
 * hover is a real surface with a real structure, and this is it.
 *
 * FR-050b is the other half. A tab whose title is too wide is ellipsised in the strip, and this
 * shows the name IN FULL — the ellipsised form is what the user is hovering to see past.
 *
 * ══ IT IS A FLOATING SURFACE, SO IT FLIPS AND CLAMPS ══
 *
 * Registered in `floating-surfaces.test.ts` (018 / FR-013). It anchors under its chip and opens
 * down-left by default; the shared {@link clampToViewport} — the same positioner the context menu
 * and the colour picker use — flips it to right-align when opening at the chip's left edge would
 * run off the window (the last tab in the strip, which is exactly where a hover popover is most
 * likely to be asked for), flips it ABOVE the chip when there is no room below, and clamps whatever
 * remains so no part of it leaves the viewport.
 *
 * Measured in a layout effect and held INVISIBLE until it has been placed, so it never paints for a
 * frame at the wrong position. It is portaled to `document.body` because `.tab-strip` is
 * `overflow: hidden` — anything rendered inside the strip would be clipped by it — and it is
 * `pointer-events: none` so it can never swallow a click meant for the strip underneath, and can
 * never strand a hover of its own.
 */
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { clampToViewport } from '../common/clamp-to-viewport.js';
import { Icon } from '../common/icon.js';
import type { PanelListEntry } from './use-panel-display-names.js';

/** Breathing room between the chip and the surface, baked into the anchor rect. */
const GAP = 6;

/**
 * Whether the popover carries the tab's name, and the whole of #296 (031 FR-043, narrowed).
 *
 * Pure, and separate from the component, because the two inputs are found in completely different
 * ways: `shortened` is a string comparison the strip already makes, while `ellipsised` can only
 * come from measuring the rendered chip. Keeping the DECISION here means it can be asserted without
 * a layout engine, leaving only the measurement itself to a layer that has one.
 *
 * Returns `null` when the chip is already showing the name in full — the common case, where
 * repeating it costs the panel list a line and tells the user nothing.
 */
export function popoverTabName(
  title: string,
  shortened: boolean,
  ellipsised: boolean,
): string | null {
  return shortened || ellipsised ? title : null;
}

export interface TabPopoverProps {
  /** The tab this describes — exposed as `data-tab-id` so a test can tell whose popover is open. */
  tabId: string;
  /**
   * The tab's FULL name (FR-050b) — never the ellipsised or shortened form — or `null` to omit the
   * line entirely (#296).
   *
   * `null` is for the common case where the chip under the pointer is already showing the name in
   * full, so repeating it here pushes the panel list — the thing the popover exists to reveal — one
   * line further down for no gain. It is NOT a removal of FR-050b: whenever the chip cannot show
   * the name in full, because `tabs.maxWidth` ellipsised it or `tabs.maxNameLength` truncated it,
   * the caller passes the name and this stays the only place it can be read.
   */
  name: string | null;
  /** Each panel's row — its name and its type — in layout order. */
  panelNames: PanelListEntry[];
  /** The chip to anchor against. `null` renders nothing. */
  anchor: HTMLElement | null;
}

export function TabPopover({
  tabId,
  name,
  panelNames,
  anchor,
}: TabPopoverProps): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /*
   * The CONTENT, as one value the effect below can depend on. A panel renamed while the popover is
   * open changes the surface's size, and a surface positioned for the size it used to be is a
   * surface off the edge of the screen.
   */
  const contents = panelNames.map((p) => `${p.icon ?? ''}${p.name}`).join('\n');

  /*
   * Position BEFORE paint. The size is measured from the rendered element rather than guessed — the
   * surface is as tall as the tab has panels and as wide as the longest name in it, so there is no
   * constant to guess with.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const next = clampToViewport(
      { left: a.left, right: a.right, top: a.top - GAP, bottom: a.bottom + GAP },
      { width: r.width, height: r.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos((prev) =>
      prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5
        ? prev
        : next,
    );
  }, [anchor, name, contents]);

  if (!anchor) return null;

  return createPortal(
    <div
      ref={ref}
      className="tabstrip-popover"
      data-testid="tabstrip-popover"
      data-tab-id={tabId}
      role="tooltip"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {name === null ? null : (
        <div className="tabstrip-popover__name" data-testid="tabstrip-popover-name">
          {name}
        </div>
      )}
      <div className="tabstrip-popover__count" data-testid="tabstrip-popover-count">
        {panelNames.length} panel{panelNames.length === 1 ? '' : 's'}
      </div>
      {panelNames.length === 0 ? null : (
        <ul className="tabstrip-popover__panels" data-testid="tabstrip-popover-panels">
          {panelNames.map((panel, index) => (
            <li
              className="tabstrip-popover__panel"
              // The names are not unique — two panels may legitimately wear the same one — so the
              // index is part of the key rather than a fallback for it.
              key={`${index}:${panel.name}`}
            >
              {/*
               * The panel's TYPE, as its icon, standing where the list bullet used to (#304).
               *
               * It carries a `title` because an icon on its own names nothing: the type is the
               * information, and a user who cannot resolve the glyph — or is reading this with a
               * screen reader — must still be able to get at it. The same string the panel header's
               * own kind marker uses, from the same registry.
               *
               * An untyped panel has no icon and gets a plain bullet — the marker the whole list
               * used to wear. It keeps the row's names aligned, and it says the honest thing: this
               * is a panel, and there is nothing yet to say about what kind. `aria-hidden` because
               * a bullet read aloud is noise, and unlike the type icons it names nothing to lose.
               */}
              {panel.icon === null ? (
                <span className="tabstrip-popover__panel-icon" aria-hidden="true">
                  •
                </span>
              ) : (
                <span
                  className="tabstrip-popover__panel-icon"
                  title={panel.typeLabel ?? undefined}
                  data-testid={`tabstrip-popover-panel-kind-${index}`}
                >
                  <Icon token={panel.icon} />
                </span>
              )}
              <span className="tabstrip-popover__panel-name">{panel.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
