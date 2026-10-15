/**
 * The time-series region (055 FR-060): the four charts for the node the detail pane describes — the
 * selected row, or the node in focus — stacked by its children. A region of its own in the Tab order
 * (FR-068), named for the node it plots.
 */
import { type ReactElement } from 'react';
import { TimeseriesCharts } from './charts/timeseries.js';
import { useSubject } from './use-subject.js';

export function ChartPane(): ReactElement {
  const subject = useSubject();
  return (
    <section
      className="chart-pane"
      data-testid="chart-pane"
      aria-label={subject ? `Usage over time: ${subject.node.label}` : 'Usage over time'}
      tabIndex={0}
    >
      {subject ? <TimeseriesCharts focusId={subject.node.id} /> : null}
    </section>
  );
}
