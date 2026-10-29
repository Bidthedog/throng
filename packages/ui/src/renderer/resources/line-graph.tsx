/**
 * A small line graph per metric of the selected item's own usage over the time the window has been open
 * (055 FR-097, research R16) — CPU, Memory, GPU, I/O and Network, each with its current value. This replaces the
 * large stacked area charts, which took the room of the whole column to say what a line and a number say.
 *
 * It is drawn the way the rows' sparklines are (`sparkline.tsx`): one canvas, redrawn by the session's single
 * listener, in the theme's accent. One point is not a trend, so with fewer than two it shows a spinner in the
 * graph's box (FR-091, FR-114).
 *
 * ══ A Y SCALE, AND THE VALUE WITH ITS BAND (FR-120) ══
 *
 * The line is drawn from ZERO, and a scale beside it names its two ends in the figure's own unit — 0 at the
 * foot, the largest value plotted at the top — through `format.ts`, so the quantities are digit-grouped. The
 * current value reads with its band (CPU and Memory have one: "Normal", "Warning", "Critical") immediately to
 * its left, in words as well as colour. The right column no longer lists the figures a second time.
 */
import { type ReactElement } from 'react';
import type { UsageBand } from '@throng/core';
import { FIGURE_HINT, FIGURE_LABEL, FIGURE_ORDER, isUnelevated, metricNumber, neverDrawn, type Figure, type FigureId } from './figures.js';
import { formatMetric } from './format.js';
import { figuresOf } from './monitor-model.js';
import { getHistory } from './monitor-session.js';
import { LoadingSpinner, PlotCanvas, useHasLine } from './sparkline.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';
import type { Subject } from './use-subject.js';

/** The CSS box of one graph (`.line-graph__plot` in theme.css). */
const WIDTH = 220;
const HEIGHT = 44;

const BAND_LABEL: Readonly<Record<UsageBand, string>> = { normal: 'Normal', warning: 'Warning', critical: 'Critical' };

/** A figure in its own unit, as the scale writes it: I/O and Network are rates, CPU and GPU percentages, Memory bytes. */
const scaleText = (metric: FigureId, value: number): string => formatMetric(metric === 'io' ? 'ioRead' : metric, value);

/** The largest value the node's history holds for `metric`: the top of the scale. */
function plottedMax(nodeId: string, metric: FigureId): number {
  let max = 0;
  for (const point of getHistory(nodeId)) max = Math.max(max, metricNumber(point.rolled, metric));
  return max;
}

/**
 * What the value's hover title says (FR-107): what the figure IS, and why it reads "-", "~" or is partial —
 * never what it reads, which is the text beside it (a title that moved with every capture would be closed
 * by the browser under a resting pointer, FR-095). A figure nothing will measure keeps its own reason.
 */
function valueTitle(metric: FigureId, figure: Figure | undefined, measured: boolean, ended: boolean): string | undefined {
  if (ended || figure === undefined) return undefined;
  if (!measured) return figure.title;
  let title = `${FIGURE_LABEL[metric]} — ${FIGURE_HINT[metric]}`;
  if (figure.note !== undefined) title += `; ${figure.note}`;
  if (figure.partial !== undefined) title += `; partial: ${figure.partial}`;
  return title;
}

function LineGraph({ subject, metric }: { subject: Subject; metric: FigureId }): ReactElement {
  const { node, ended, frame } = subject;
  const { thresholds } = useResourceMonitorSettings();
  const hasLine = useHasLine(node.id);
  const figure = figuresOf(node, { thresholds, machine: frame.machine, unelevated: isUnelevated(subject.tree) }).find((f) => f.id === metric);
  const current = ended ? 'ended' : (figure?.text ?? '');
  // An UNAVAILABLE figure (Network unelevated, FR-113) has no line to draw: a line of zeros would claim a
  // reading. Its "-" carries the reason in its title, as the list's cell does (FR-107). Nor has one that
  // nothing will ever measure — an editor panel's CPU, Terminal buffers' I/O (T180). One that is merely not
  // measured YET (a first sighting has no rate) is still loading: the spinner, until two points (FR-114).
  const measured = ended || figure === undefined || !neverDrawn(figure.value, node);
  // The band is the live figure's: an ended item or a figure that is not a number has none to give.
  const band = ended || figure === undefined || typeof figure.value !== 'number' ? undefined : figure.band;
  const plotted = measured && hasLine;
  return (
    <figure className="line-graph" data-testid={`line-graph-${metric}`} aria-label={`${FIGURE_LABEL[metric]} of ${node.label} over time`}>
      <figcaption className="line-graph__caption">
        <span className="line-graph__name">{FIGURE_LABEL[metric]}</span>
        <span className="line-graph__reading">
          {band !== undefined ? (
            <>
              <span className="line-graph__band" data-band={band} data-testid={`line-graph-${metric}-band`}>
                {BAND_LABEL[band]}
              </span>{' '}
            </>
          ) : null}
          <span className="line-graph__value" data-testid={`line-graph-${metric}-value`} title={valueTitle(metric, figure, measured, ended)}>
            {current}
          </span>
        </span>
      </figcaption>
      {!measured ? (
        <div className="line-graph__plot line-graph__plot--none" data-testid={`line-graph-${metric}-none`} aria-hidden="true" />
      ) : hasLine ? (
        <div className="line-graph__body">
          {/* The Y scale (FR-120): the largest value plotted at the top, zero at the foot, in the figure's unit. */}
          {plotted ? (
            <div className="line-graph__scale" aria-hidden="true">
              <span data-testid={`line-graph-${metric}-scale-max`}>{scaleText(metric, plottedMax(node.id, metric))}</span>
              <span data-testid={`line-graph-${metric}-scale-min`}>{scaleText(metric, 0)}</span>
            </div>
          ) : null}
          <PlotCanvas
            nodeId={node.id}
            metric={metric}
            width={WIDTH}
            height={HEIGHT}
            className="line-graph__plot"
            testId={`line-graph-plot-${metric}`}
            fromZero
          />
        </div>
      ) : (
        <div className="line-graph__building" data-testid={`line-graph-${metric}-building`}>
          <LoadingSpinner />
        </div>
      )}
    </figure>
  );
}

/** The five graphs for the item the right column describes. */
export function LineGraphs({ subject }: { subject: Subject }): ReactElement {
  return (
    <section className="line-graphs" data-testid="line-graphs" aria-label={`Usage over time: ${subject.node.label}`}>
      <h4 className="line-graphs__heading">Over time</h4>
      <div className="line-graphs__grid">
        {FIGURE_ORDER.map((metric) => (
          <LineGraph key={metric} subject={subject} metric={metric} />
        ))}
      </div>
    </section>
  );
}
