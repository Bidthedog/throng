/**
 * A treemap of a section's nodes by the chosen metric (055 FR-060, research R10): the LAYOUT is
 * d3-hierarchy's squarify; the rectangles are absolutely positioned HTML cells (no inline artwork,
 * SC-002), so every tile is an element that can be clicked, titled, themed and found by an assistive
 * technology.
 *
 * ══ WHAT A TILE DOES ══
 *
 * A click SELECTS the node and a second click clears it; a node with children carries a drill-down
 * `IconButton` beside the tile that opens it, and Enter on the focused tile opens it too (FR-088). The
 * button is a SIBLING of the tile, not inside it: a button in a button is not a control a screen reader
 * can use. Right-click opens the same menu as the node's row. Exactly the selected node's tile is marked
 * (FR-089) — `data-selected` — which is not the same as the node the keyboard is on.
 *
 * Tab does not walk the tiles: a treemap of two hundred contributors is not two hundred tab stops. The
 * keyboard's route is the rows beside it (one roving stop, `use-breakdown-keys.ts`). Each tile is still
 * focusable programmatically and Enter opens it.
 *
 * ══ COLOUR IS HOW MUCH OF THE MACHINE IT TAKES (FR-094) ══
 *
 * The fill is core's `heatFor` — 0 at nothing, 0.5 at the warning threshold, 1 at the critical one —
 * handed to the stylesheet as `--heat`; the stylesheet mixes the theme's success, warning and danger
 * colours from it. No colour is computed or written here.
 *
 * ══ AND IT HOLDS STILL (FR-090) ══
 *
 * Tiles come in the order the section gives them. While the order is held they are laid out in that
 * order rather than re-sorted by size; otherwise largest first. When the order changes, the tiles that
 * moved slide from where they were (`flip.ts`) — their old place is the previous layout, in memory, so no
 * layout is read back.
 *
 * Re-laid-out only when the tiles, their sizes or the available space change (Principle XII), never on
 * a hover or a focus move.
 */
import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import type { HeatMetric, ResourceNode, UsageThresholds } from '@throng/core';
import { formatGrouped, heatFor } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { moveFrom } from './flip.js';
import { figureOf, FIGURE_LABEL, type FigureId } from './figures.js';
import { valueText, type FigureContext, type OthersItem, type TileItem } from './monitor-model.js';
import { useElementSize } from './use-size.js';

export interface TreemapProps {
  readonly sectionId: string;
  readonly tiles: readonly (TileItem | OthersItem)[];
  readonly metric: FigureId;
  readonly ctx: FigureContext;
  /** The highest total I/O rate reached this session: what I/O tiles are coloured against. */
  readonly ioPeak: number;
  /** The selected node, if any — the only tile marked. */
  readonly selectedId: string | null;
  /** The order is being held: lay tiles out as given instead of largest first. */
  readonly hold: boolean;
  readonly onSelect: (id: string) => void;
  readonly onOpen: (path: readonly string[]) => void;
  readonly onMenu: ((event: ReactMouseEvent, node: ResourceNode) => void) | undefined;
}

interface Leaf {
  readonly key: string;
  readonly value: number;
}

interface Rect {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const FALLBACK = { width: 600, height: 240 } as const;
/** Smallest tile that still has room for a readable label. */
const LABEL_MIN_W = 56;
const LABEL_MIN_H = 30;
/** The drill-down button's box, and its inset from the tile's top-right corner (theme.css `.treemap__open`). */
const OPEN_SIZE = 20;
const OPEN_INSET = 2;

export function layoutTiles(leaves: readonly Leaf[], width: number, height: number, sortBySize = true): Rect[] {
  if (leaves.length === 0 || width <= 0 || height <= 0) return [];
  const root = hierarchy<{ key: string; value: number; children?: Leaf[] }>({ key: '', value: 0, children: [...leaves] }).sum((d) =>
    d.children ? 0 : d.value,
  );
  // Squarify is best on largest-first; a held order is the order the user is looking at, so it wins.
  if (sortBySize) root.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  treemap<{ key: string; value: number; children?: Leaf[] }>().tile(treemapSquarify).size([width, height]).paddingInner(2).round(true)(root);
  return (root.leaves() as unknown as { data: Leaf; x0: number; y0: number; x1: number; y1: number }[]).map((l) => ({
    key: l.data.key,
    x: l.x0,
    y: l.y0,
    width: l.x1 - l.x0,
    height: l.y1 - l.y0,
  }));
}

function TreemapView({ sectionId, tiles, metric, ctx, ioPeak, selectedId, hold, onSelect, onOpen, onMenu }: TreemapProps): ReactElement {
  const [ref, size] = useElementSize<HTMLDivElement>(FALLBACK);
  const keyed = useMemo(
    () => tiles.map((t) => ({ key: t.kind === 'node' ? t.node.id : `others-${sectionId}`, tile: t })),
    [tiles, sectionId],
  );
  // Whether the order is held is READ when the tiles change, not depended on: a hold BEGINNING keeps the
  // layout on screen as it is, and a hold ending comes with new tiles (the re-ranked ones).
  const held = useRef(hold);
  held.current = hold;
  const rects = useMemo(
    () => layoutTiles(keyed.map((k) => ({ key: k.key, value: k.tile.value })), size.width, size.height, !held.current),
    [keyed, size.width, size.height],
  );
  const byKey = useMemo(() => new Map(rects.map((r) => [r.key, r])), [rects]);

  // Tiles that changed place when the order changed slide there; a resize, or a figure moving a
  // boundary a little, does not.
  const cells = useRef<HTMLDivElement | null>(null);
  const before = useRef<Map<string, Rect>>(new Map());
  useLayoutEffect(() => {
    const previous = before.current;
    before.current = byKey;
    const root = cells.current;
    if (root === null || previous.size === 0 || !reordered(previous, byKey)) return;
    for (const el of root.querySelectorAll<HTMLElement>('[data-tile-key]')) {
      const key = el.getAttribute('data-tile-key') ?? '';
      const was = previous.get(key);
      const now = byKey.get(key);
      if (was !== undefined && now !== undefined && (was.x !== now.x || was.y !== now.y)) moveFrom(el, was.x - now.x, was.y - now.y);
    }
  }, [byKey]);

  return (
    <div ref={ref} className="treemap" data-testid={`treemap-${sectionId}`}>
      {tiles.length === 0 ? (
        <p className="treemap__empty">Nothing measured here</p>
      ) : (
        <div ref={cells} className="treemap__cells" role="group" aria-label="Proportional breakdown">
          {keyed.map(({ key, tile }) => {
            const r = byKey.get(key);
            if (r === undefined) return null;
            return tile.kind === 'others' ? (
              <OthersTile key={key} tileKey={key} rect={r} tile={tile} sectionId={sectionId} />
            ) : (
              <NodeTile
                key={key}
                rect={r}
                tile={tile}
                metric={metric}
                ctx={ctx}
                ioPeak={ioPeak}
                selected={selectedId === tile.node.id}
                onSelect={onSelect}
                onOpen={onOpen}
                onMenu={onMenu}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** True when the tiles both layouts share are in a different order — not merely a different size. */
function reordered(previous: ReadonlyMap<string, Rect>, next: ReadonlyMap<string, Rect>): boolean {
  const common = [...next.keys()].filter((k) => previous.has(k));
  const was = [...previous.keys()].filter((k) => next.has(k));
  return common.some((k, i) => k !== was[i]);
}

/** The metric the machine-share scale takes for a figure (the tile's own figure, so the colour agrees with the size). */
const HEAT_METRIC: Readonly<Record<FigureId, HeatMetric>> = { cpu: 'cpu', memory: 'memory', gpu: 'gpu', io: 'io' };

const NodeTile = memo(function NodeTile({
  rect,
  tile,
  metric,
  ctx,
  ioPeak,
  selected,
  onSelect,
  onOpen,
  onMenu,
}: {
  rect: Rect;
  tile: TileItem;
  metric: FigureId;
  ctx: FigureContext;
  ioPeak: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (path: readonly string[]) => void;
  onMenu: ((event: ReactMouseEvent, node: ResourceNode) => void) | undefined;
}): ReactElement {
  const node: ResourceNode = tile.node;
  // The same figure the rows and the status bar show, banded by the same rule (core's `bandFor`).
  const figure = figureOf(metric, node.rolled, ctx.thresholds, ctx.machine);
  const band = figure.band;
  const label = node.label;
  const showLabel = rect.width >= LABEL_MIN_W && rect.height >= LABEL_MIN_H;
  const text = figure.text;
  const heat = heatFor(HEAT_METRIC[metric], tile.value, ctx.thresholds, ctx.machine, ioPeak);
  const opens = node.children.length > 0;
  const open = (): void => onOpen(tile.path);
  return (
    <>
      <div
        className="treemap__tile"
        data-testid={`treemap-tile-${node.id}`}
        data-tile-key={node.id}
        data-node-id={node.id}
        data-value={tile.value}
        data-width={rect.width}
        data-height={rect.height}
        data-band={band}
        data-heat={heat === undefined ? 'none' : undefined}
        data-selected={selected ? 'true' : undefined}
        data-kind={node.kind}
        role="button"
        tabIndex={-1}
        aria-pressed={selected}
        aria-label={`${label}, ${text}`}
        title={valueText(node, false, ctx)}
        style={place(rect, heat)}
        onClick={() => onSelect(node.id)}
        onContextMenu={onMenu ? (e) => onMenu(e, node) : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && opens) open();
          else if (e.key === ' ') {
            e.preventDefault();
            onSelect(node.id);
          }
        }}
      >
        {showLabel ? (
          <>
            <span className="treemap__label">{clip(label, rect.width)}</span>
            <span className="treemap__value">{text}</span>
          </>
        ) : null}
      </div>
      {opens ? (
        <span className="treemap__open" data-tile-key={node.id} style={openPlace(rect)}>
          <IconButton
            token="chevron"
            title={`Open ${label}`}
            testId={`treemap-tile-open-${node.id}`}
            className="icon-button treemap__open-button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
          />
        </span>
      ) : null}
    </>
  );
});

/** A cell's place and size come from the layout alone; everything visual is the stylesheet's. */
function place(r: Rect, heat: number | undefined): CSSProperties {
  const box: CSSProperties = { left: r.x, top: r.y, width: r.width, height: r.height };
  // `--heat` is a number the stylesheet turns into a colour; a node with nothing measured sets none.
  return heat === undefined ? box : ({ ...box, ['--heat']: Math.round(heat * 1000) / 1000 } as CSSProperties);
}

const openPlace = (r: Rect): CSSProperties => ({
  left: r.x + Math.max(0, r.width - OPEN_SIZE - OPEN_INSET),
  top: r.y + OPEN_INSET,
});

function OthersTile({ rect, tile, sectionId, tileKey }: { rect: Rect; tile: OthersItem; sectionId: string; tileKey: string }): ReactElement {
  const label = `${formatGrouped(tile.count)} others`;
  return (
    <div
      className="treemap__tile treemap__tile--others"
      data-testid={`treemap-tile-others-${sectionId}`}
      data-tile-key={tileKey}
      data-value={tile.value}
      data-width={rect.width}
      data-height={rect.height}
      role="img"
      aria-label={label}
      title={`${label} — listed below`}
      style={place(rect, undefined)}
    >
      {rect.width >= LABEL_MIN_W && rect.height >= 18 ? <span className="treemap__label">{label}</span> : null}
    </div>
  );
}

/** A label is clipped to roughly what fits at the tile's width (a character is about 6.5 px). */
function clip(label: string, width: number): string {
  const max = Math.max(3, Math.floor((width - 12) / 6.5));
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

export const Treemap = memo(TreemapView);

// ── the key to the scale (FR-094) ────────────────────────────────────────────────────────────────

/** The two thresholds the scale passes through for `metric`, and what they are a share of. */
function scaleFor(metric: FigureId, t: UsageThresholds): { warning: string; critical: string; of: string } {
  switch (metric) {
    case 'memory':
      return { warning: `${formatGrouped(t.memoryWarning)}%`, critical: `${formatGrouped(t.memoryCritical)}%`, of: 'installed memory' };
    case 'io':
      return { warning: `${formatGrouped(t.cpuWarning)}%`, critical: `${formatGrouped(t.cpuCritical)}%`, of: 'the highest I/O rate this session' };
    case 'gpu':
      return { warning: `${formatGrouped(t.cpuWarning)}%`, critical: `${formatGrouped(t.cpuCritical)}%`, of: 'the GPU' };
    case 'cpu':
      return { warning: `${formatGrouped(t.cpuWarning)}%`, critical: `${formatGrouped(t.cpuCritical)}%`, of: 'all processors' };
  }
}

/** A bar from the low colour to the high one, labelled with where it turns amber and red. */
export function HeatKey({ metric, thresholds }: { metric: FigureId; thresholds: UsageThresholds }): ReactElement {
  const s = scaleFor(metric, thresholds);
  return (
    <div
      className="treemap-key"
      data-testid="treemap-key"
      role="img"
      aria-label={`Tile colour: share of ${s.of}. Low is green, amber from ${s.warning}, red from ${s.critical}.`}
      title={`Tile colour is the ${FIGURE_LABEL[metric]} share of ${s.of}`}
    >
      <span className="treemap-key__label treemap-key__label--high">Red {s.critical}</span>
      <span className="treemap-key__bar" aria-hidden="true" />
      <span className="treemap-key__label treemap-key__label--mid">Amber {s.warning}</span>
      <span className="treemap-key__label treemap-key__label--low">Low</span>
    </div>
  );
}
