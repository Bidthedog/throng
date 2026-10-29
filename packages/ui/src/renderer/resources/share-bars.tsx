/**
 * What the selected item is made of (055 FR-097, research R16): its children as ranked bars, each as long
 * as its share of the item for the chosen metric and coloured by how much of the machine it takes
 * (FR-094), with every one of its figures beside it (FR-109). The list is read-only (FR-108): the right
 * column describes the left's selection and changes nothing on a click. This replaces the treemap.
 *
 * ══ COLOUR IS HOW MUCH OF THE MACHINE IT TAKES (FR-094) ══
 *
 * The fill is core's `heatFor` — 0 at nothing, 0.5 at the warning threshold, 1 at the critical one —
 * handed to the stylesheet as `--heat`; the stylesheet mixes the theme's success, warning and danger
 * colours from it. No colour is computed or written here. The LENGTH is a share of the item, the COLOUR a
 * share of the machine: a long green bar is most of something small.
 *
 * ══ AND IT HOLDS STILL (FR-095) ══
 *
 * While the pointer is over the bars they are drawn from the item as it was when the pointer arrived —
 * order and figures — so a bar never moves under a click. The rest of the right column stays live.
 */
import { useMemo, type CSSProperties, type ReactElement } from 'react';
import { formatGrouped, heatFor, type HeatMetric, type UsageThresholds } from '@throng/core';
import { FIGURE_LABEL, isUnelevated, orderMetric, type FigureId } from './figures.js';
import { barsFor, figuresOf, type BarItem, type FigureContext } from './monitor-model.js';
import { getIoPeak, getNetworkPeak, isEnded, useListView } from './monitor-session.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';
import { usePointerHold } from './use-pointer-hold.js';
import type { Subject } from './use-subject.js';

/** The metric the machine-share scale takes for a figure (the bar's own figure, so the colour agrees with the length). */
const HEAT_METRIC: Readonly<Record<FigureId, HeatMetric>> = { cpu: 'cpu', memory: 'memory', gpu: 'gpu', io: 'io', network: 'network' };

/** A bar never vanishes for being small: a sliver says "something, but little". */
const MIN_FILL_PERCENT = 0.5;

function Bar({
  bar,
  metric,
  ctx,
  ioPeak,
}: {
  bar: BarItem;
  metric: FigureId;
  ctx: FigureContext;
  ioPeak: number;
}): ReactElement {
  const { node } = bar;
  // Every figure, always (FR-109); only the bar's length and colour follow Order by.
  const figures = figuresOf(node, ctx);
  const chosen = figures.find((f) => f.id === metric);
  const heat = heatFor(HEAT_METRIC[metric], bar.value, ctx.thresholds, ctx.machine, ioPeak);
  const fill: CSSProperties = { width: `${Math.max(bar.share * 100, MIN_FILL_PERCENT)}%` };
  // `--heat` is a number the stylesheet turns into a colour; a bar with nothing measured to colour it sets none.
  if (heat !== undefined) (fill as Record<string, unknown>)['--heat'] = Math.round(heat * 1000) / 1000;
  return (
    // Named, never valued: a title that moved with the figure would be closed by the browser every capture (FR-095).
    // Read-only (FR-108): no click, no selection, no drill — the right column describes the left's selection.
    <li className="share-bar" data-testid={`share-bar-${node.id}`} data-node-id={node.id} data-band={chosen?.band} data-kind={node.kind} title={node.label}>
      <span className="share-bar__name">{node.label}</span>
      <span className="share-bar__track" aria-hidden="true">
        <span
          className="share-bar__fill"
          data-testid={`share-bar-fill-${node.id}`}
          data-share={bar.share.toFixed(3)}
          data-heat={heat === undefined ? 'none' : undefined}
          style={fill}
        />
      </span>
      <span className="share-bar__figures">
        {figures.map((f) => (
          <span
            key={f.id}
            className="share-bar__figure"
            data-testid={`share-bar-figure-${node.id}-${f.id}`}
            data-metric={f.id}
            data-chosen={f.id === metric ? 'true' : undefined}
            title={f.title}
          >
            {f.text}
          </span>
        ))}
      </span>
    </li>
  );
}

export function ShareBars({ subject }: { subject: Subject }): ReactElement {
  // The bars follow what the rows are ordered by: a chosen Network is CPU while it is not measured (FR-099).
  const metric = orderMetric(useListView().metric, subject.tree);
  const { thresholds } = useResourceMonitorSettings();
  // A hold belongs to the item it was taken on: a new selection on the left takes a new one.
  const hold = usePointerHold(subject.node, (live) => live, (live) => live, subject.node.id);
  const node = hold.value;
  const machine = subject.frame.machine;
  const unelevated = isUnelevated(subject.tree);
  const ctx = useMemo<FigureContext>(() => ({ thresholds, machine, unelevated }), [thresholds, machine, unelevated]);
  const model = useMemo(() => barsFor(node, metric, isEnded), [node, metric]);
  // I/O and Network are coloured against the highest rate this session has seen (FR-094, FR-113).
  const ioPeak = metric === 'network' ? getNetworkPeak() : getIoPeak();

  return (
    <section className="share-bars" data-testid="share-bars" aria-label={`What ${node.label} is made of, by ${FIGURE_LABEL[metric]}`} {...hold.bind}>
      {/* No heading (FR-117): the region's accessible name says what it is. */}
      {model.bars.length === 0 ? (
        <p className="share-bars__empty" data-testid="share-bars-empty">
          Nothing under it uses any {FIGURE_LABEL[metric]}
        </p>
      ) : (
        <div className="share-bars__body">
          <ul className="share-bars__list">
            {model.bars.map((bar) => (
              <Bar key={bar.node.id} bar={bar} metric={metric} ctx={ctx} ioPeak={ioPeak} />
            ))}
            {model.others !== null ? (
              <li className="share-bar share-bar--others" data-testid="share-bars-others" title="The smaller contributors, grouped">
                <span className="share-bar__name">{formatGrouped(model.others.count)} others</span>
                <span className="share-bar__track" aria-hidden="true">
                  <span className="share-bar__fill" data-heat="none" style={{ width: `${Math.max(model.others.share * 100, MIN_FILL_PERCENT)}%` }} />
                </span>
                <span className="share-bar__figures" />
              </li>
            ) : null}
          </ul>
          <HeatKey metric={metric} thresholds={thresholds} />
        </div>
      )}
    </section>
  );
}

// ── the key to the scale (FR-094) ────────────────────────────────────────────────────────────────

/** The two thresholds the scale passes through for `metric`, and what they are a share of. */
function scaleFor(metric: FigureId, t: UsageThresholds): { warning: string; critical: string; of: string } {
  switch (metric) {
    case 'memory':
      return { warning: `${formatGrouped(t.memoryWarning)}%`, critical: `${formatGrouped(t.memoryCritical)}%`, of: 'installed memory' };
    case 'io':
      return { warning: `${formatGrouped(t.cpuWarning)}%`, critical: `${formatGrouped(t.cpuCritical)}%`, of: 'the highest I/O rate this session' };
    case 'network':
      return { warning: `${formatGrouped(t.cpuWarning)}%`, critical: `${formatGrouped(t.cpuCritical)}%`, of: 'the highest network rate this session' };
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
      className="share-key"
      data-testid="share-key"
      role="img"
      aria-label={`Bar colour: share of ${s.of}. Low is green, amber from ${s.warning}, red from ${s.critical}.`}
      title={`Bar colour is the ${FIGURE_LABEL[metric]} share of ${s.of}`}
    >
      <span className="share-key__label share-key__label--high">Red {s.critical}</span>
      <span className="share-key__bar" aria-hidden="true" />
      <span className="share-key__label share-key__label--mid">Amber {s.warning}</span>
      <span className="share-key__label share-key__label--low">Low</span>
    </div>
  );
}
