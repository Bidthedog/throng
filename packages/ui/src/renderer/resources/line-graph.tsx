/**
 * A small line graph per metric of the selected item's own usage over the time the window has been open
 * (055 FR-097, research R16) — CPU, Memory, GPU, I/O and Network, each with its current value. This replaces the
 * large stacked area charts, which took the room of the whole column to say what a line and a number say.
 *
 * It is drawn the way the rows' sparklines are (`sparkline.tsx`): one canvas, redrawn by the session's single
 * listener, in the theme's accent, with no axes — the current value beside it is the scale's other end. One
 * point is not a trend, so with fewer than two it shows a spinner in the graph's box (FR-091, FR-114).
 */
import { type ReactElement } from 'react';
import { FIGURE_LABEL, FIGURE_ORDER, type FigureId } from './figures.js';
import { figuresOf } from './monitor-model.js';
import { LoadingSpinner, PlotCanvas, useHasLine } from './sparkline.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';
import type { Subject } from './use-subject.js';

/** The CSS box of one graph (`.line-graph__plot` in theme.css). */
const WIDTH = 220;
const HEIGHT = 44;

function LineGraph({ subject, metric }: { subject: Subject; metric: FigureId }): ReactElement {
  const { node, ended, frame } = subject;
  const { thresholds } = useResourceMonitorSettings();
  const hasLine = useHasLine(node.id);
  const figure = figuresOf(node, { thresholds, machine: frame.machine }).find((f) => f.id === metric);
  const current = ended ? 'ended' : (figure?.text ?? '');
  // A figure that is not measured (Network unelevated, FR-113) has no line to draw: a line of zeros would
  // claim a reading. Its "-" carries the reason in its title, as the list's cell does (FR-107).
  const measured = ended || typeof figure?.value === 'number';
  return (
    <figure className="line-graph" data-testid={`line-graph-${metric}`} aria-label={`${FIGURE_LABEL[metric]} of ${node.label} over time`}>
      <figcaption className="line-graph__caption">
        <span className="line-graph__name">{FIGURE_LABEL[metric]}</span>
        <span className="line-graph__value" data-testid={`line-graph-${metric}-value`} title={measured ? undefined : figure?.title}>
          {current}
        </span>
      </figcaption>
      {!measured ? (
        <div className="line-graph__plot line-graph__plot--none" data-testid={`line-graph-${metric}-none`} aria-hidden="true" />
      ) : hasLine ? (
        <PlotCanvas nodeId={node.id} metric={metric} width={WIDTH} height={HEIGHT} className="line-graph__plot" testId={`line-graph-plot-${metric}`} />
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
