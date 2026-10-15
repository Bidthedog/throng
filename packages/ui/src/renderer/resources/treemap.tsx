/**
 * A treemap of a section's nodes by the chosen metric (055 FR-060, research R10): the LAYOUT is
 * d3-hierarchy's squarify; the rectangles are absolutely positioned HTML cells (no inline artwork,
 * SC-002), so every tile is an element that can be clicked, titled, themed and found by an assistive
 * technology.
 *
 * Tab does not walk the tiles: a treemap of two hundred contributors is not two hundred tab stops. The
 * keyboard's route is the rows beside it (one roving stop, `use-breakdown-keys.ts`), and the tile for
 * the focused row is highlighted. Each tile is still focusable programmatically and Enter opens it.
 *
 * Re-laid-out only when the tiles, their sizes or the available space change (Principle XII), never on
 * a hover or a focus move.
 */
import { memo, useMemo, type CSSProperties, type ReactElement } from 'react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import type { ResourceNode } from '@throng/core';
import { formatGrouped } from '@throng/core';
import { figureOf, type FigureId } from './figures.js';
import { valueText, type FigureContext, type OthersItem, type TileItem } from './monitor-model.js';
import { useElementSize } from './use-size.js';

export interface TreemapProps {
  readonly sectionId: string;
  readonly tiles: readonly (TileItem | OthersItem)[];
  readonly metric: FigureId;
  readonly ctx: FigureContext;
  /** The node whose row has the keyboard, so its tile can be marked. */
  readonly activeId: string | null;
  readonly onOpen: (path: readonly string[]) => void;
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

export function layoutTiles(leaves: readonly Leaf[], width: number, height: number): Rect[] {
  if (leaves.length === 0 || width <= 0 || height <= 0) return [];
  const root = hierarchy<{ key: string; value: number; children?: Leaf[] }>({ key: '', value: 0, children: [...leaves] })
    .sum((d) => (d.children ? 0 : d.value))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  treemap<{ key: string; value: number; children?: Leaf[] }>().tile(treemapSquarify).size([width, height]).paddingInner(2).round(true)(root);
  return (root.leaves() as unknown as { data: Leaf; x0: number; y0: number; x1: number; y1: number }[]).map((l) => ({
    key: l.data.key,
    x: l.x0,
    y: l.y0,
    width: l.x1 - l.x0,
    height: l.y1 - l.y0,
  }));
}

function TreemapView({ sectionId, tiles, metric, ctx, activeId, onOpen }: TreemapProps): ReactElement {
  const [ref, size] = useElementSize<HTMLDivElement>(FALLBACK);
  const keyed = useMemo(
    () => tiles.map((t) => ({ key: t.kind === 'node' ? t.node.id : `others-${sectionId}`, tile: t })),
    [tiles, sectionId],
  );
  const rects = useMemo(
    () => layoutTiles(keyed.map((k) => ({ key: k.key, value: k.tile.value })), size.width, size.height),
    [keyed, size.width, size.height],
  );
  const byKey = new Map(rects.map((r) => [r.key, r]));

  return (
    <div ref={ref} className="treemap" data-testid={`treemap-${sectionId}`}>
      {tiles.length === 0 ? (
        <p className="treemap__empty">Nothing measured here</p>
      ) : (
        <div className="treemap__cells" role="group" aria-label="Proportional breakdown">
          {keyed.map(({ key, tile }) => {
            const r = byKey.get(key);
            if (r === undefined) return null;
            return tile.kind === 'others' ? (
              <OthersTile key={key} rect={r} tile={tile} sectionId={sectionId} />
            ) : (
              <NodeTile key={key} rect={r} tile={tile} metric={metric} ctx={ctx} active={activeId === tile.node.id} onOpen={onOpen} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function NodeTile({
  rect,
  tile,
  metric,
  ctx,
  active,
  onOpen,
}: {
  rect: Rect;
  tile: TileItem;
  metric: FigureId;
  ctx: FigureContext;
  active: boolean;
  onOpen: (path: readonly string[]) => void;
}): ReactElement {
  const node: ResourceNode = tile.node;
  // The same figure the rows and the status bar show, banded by the same rule (core's `bandFor`).
  const figure = figureOf(metric, node.rolled, ctx.thresholds, ctx.machine);
  const band = figure.band;
  const label = node.label;
  const showLabel = rect.width >= LABEL_MIN_W && rect.height >= LABEL_MIN_H;
  const text = figure.text;
  return (
    <div
      className="treemap__tile"
      data-testid={`treemap-tile-${node.id}`}
      data-value={tile.value}
      data-width={rect.width}
      data-height={rect.height}
      data-band={band}
      data-active={active ? 'true' : undefined}
      data-kind={node.kind}
      role="button"
      tabIndex={-1}
      aria-label={`${label}, ${text}. Open`}
      title={valueText(node, false, ctx)}
      style={place(rect)}
      onClick={() => onOpen(tile.path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(tile.path);
      }}
    >
      {showLabel ? (
        <>
          <span className="treemap__label">{clip(label, rect.width)}</span>
          <span className="treemap__value">{text}</span>
        </>
      ) : null}
    </div>
  );
}

/** A cell's place and size come from the layout alone; everything visual is the stylesheet's. */
const place = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.width, height: r.height });

function OthersTile({ rect, tile, sectionId }: { rect: Rect; tile: OthersItem; sectionId: string }): ReactElement {
  const label = `${formatGrouped(tile.count)} others`;
  return (
    <div
      className="treemap__tile treemap__tile--others"
      data-testid={`treemap-tile-others-${sectionId}`}
      data-value={tile.value}
      data-width={rect.width}
      data-height={rect.height}
      role="img"
      aria-label={label}
      title={`${label} — listed below`}
      style={place(rect)}
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
