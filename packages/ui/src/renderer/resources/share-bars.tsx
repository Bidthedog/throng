/**
 * What the selected item is made of (055 FR-097, research R16): its children as ranked bars, each as long
 * as its share of the item for the chosen metric and coloured by how much of the machine it takes
 * (FR-094), with the figure beside it. A click on one selects that child — the right column then describes
 * it. This replaces the treemap, which asked for a box of its own and a key beside it.
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
import { formatGrouped, heatFor, type HeatMetric, type ResourceNode, type UsageThresholds } from '@throng/core';
import { FIGURE_LABEL, figureOf, type FigureId } from './figures.js';
import { barsFor, type BarItem } from './monitor-model.js';
import { focusOn, getIoPeak, isEnded, setSelection, useView } from './monitor-session.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';
import { usePointerHold } from './use-pointer-hold.js';
import type { Subject } from './use-subject.js';

/** The metric the machine-share scale takes for a figure (the bar's own figure, so the colour agrees with the length). */
const HEAT_METRIC: Readonly<Record<FigureId, HeatMetric>> = { cpu: 'cpu', memory: 'memory', gpu: 'gpu', io: 'io' };

/** The ids from the root down to `id`, or `null` when it is not in the tree. */
function pathTo(root: ResourceNode, id: string): string[] | null {
  if (root.id === id) return [id];
  for (const child of root.children) {
    const below = pathTo(child, id);
    if (below !== null) return [root.id, ...below];
  }
  return null;
}

/** A bar never vanishes for being small: a sliver says "something, but little". */
const MIN_FILL_PERCENT = 0.5;

function Bar({
  bar,
  metric,
  thresholds,
  machine,
  ioPeak,
  onPick,
}: {
  onPick: (child: ResourceNode, from: Element) => void;
  bar: BarItem;
  metric: FigureId;
  thresholds: UsageThresholds;
  machine: Subject['frame']['machine'];
  ioPeak: number;
}): ReactElement {
  const { node } = bar;
  const figure = figureOf(metric, node.rolled, thresholds, machine);
  const heat = heatFor(HEAT_METRIC[metric], bar.value, thresholds, machine, ioPeak);
  const fill: CSSProperties = { width: `${Math.max(bar.share * 100, MIN_FILL_PERCENT)}%` };
  // `--heat` is a number the stylesheet turns into a colour; a bar with nothing measured to colour it sets none.
  if (heat !== undefined) (fill as Record<string, unknown>)['--heat'] = Math.round(heat * 1000) / 1000;
  return (
    // Named, never valued: a title that moved with the figure would be closed by the browser every capture (FR-095).
    <li
      className="share-bar"
      data-testid={`share-bar-${node.id}`}
      data-node-id={node.id}
      data-band={figure.band}
      data-kind={node.kind}
      title={node.label}
      onClick={(e) => onPick(node, e.currentTarget)}
    >
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
      <span className="share-bar__figure" data-testid={`share-bar-figure-${node.id}`}>
        {figure.text}
      </span>
    </li>
  );
}

export function ShareBars({ subject }: { subject: Subject }): ReactElement {
  const { metric } = useView();
  const { thresholds } = useResourceMonitorSettings();
  // A hold belongs to the item it was taken on: choosing another item (a click on a bar does) takes a new one.
  const hold = usePointerHold(subject.node, (live) => live, (live) => live, subject.node.id);
  const node = hold.value;
  const { tree } = subject;
  const subjectId = subject.node.id;
  const pick = (child: ResourceNode, from: Element): void => {
    // A child with no row on the left (the left lists projects, the click was on a project's tab) is
    // opened for first: the left shows the item the bars belong to, and the child is marked there (FR-089).
    const listed = from.ownerDocument.querySelector(`[role="treeitem"][data-node-id="${child.id}"]`) !== null;
    if (!listed) {
      const path = pathTo(tree, subjectId);
      if (path !== null) focusOn(path);
    }
    setSelection(child.id);
  };
  const machine = subject.frame.machine;
  const model = useMemo(() => barsFor(node, metric, isEnded), [node, metric]);
  const ioPeak = getIoPeak();

  return (
    <section className="share-bars" data-testid="share-bars" aria-label={`What ${node.label} is made of, by ${FIGURE_LABEL[metric]}`} {...hold.bind}>
      <h4 className="share-bars__heading">
        Made up of <span className="share-bars__metric">by {FIGURE_LABEL[metric]}</span>
      </h4>
      {model.bars.length === 0 ? (
        <p className="share-bars__empty" data-testid="share-bars-empty">
          Nothing under it uses any {FIGURE_LABEL[metric]}
        </p>
      ) : (
        <div className="share-bars__body">
          <ul className="share-bars__list">
            {model.bars.map((bar) => (
              <Bar key={bar.node.id} onPick={pick} bar={bar} metric={metric} thresholds={thresholds} machine={machine} ioPeak={ioPeak} />
            ))}
            {model.others !== null ? (
              <li className="share-bar share-bar--others" data-testid="share-bars-others" title="The smaller contributors, grouped">
                <span className="share-bar__name">{formatGrouped(model.others.count)} others</span>
                <span className="share-bar__track" aria-hidden="true">
                  <span className="share-bar__fill" data-heat="none" style={{ width: `${Math.max(model.others.share * 100, MIN_FILL_PERCENT)}%` }} />
                </span>
                <span className="share-bar__figure" />
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
