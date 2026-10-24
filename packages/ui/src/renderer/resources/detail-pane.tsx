/**
 * The right column (055 FR-097): everything about the selected node — or, with nothing selected, about the
 * level the left column shows — and nothing about a selection appears anywhere else. Top to bottom: its
 * name and kind and the actions on it; what it is made of (`share-bars.tsx`); its facts and figures,
 * banded and digit-grouped, estimated and not-measured ones saying so (FR-024, FR-012); and a line graph
 * per metric of its own usage (`line-graph.tsx`).
 *
 * Unlike the left list this column does not hold still under the pointer — it is the one that keeps
 * updating (FR-095) — except for the bars, which hold their own order so a click on one lands on it.
 */
import { type ReactElement } from 'react';
import type { ResourceNodeKind } from '@throng/core';
import { FIGURE_HINT, FIGURE_LABEL, type Figure } from './figures.js';
import { formatDuration } from './format.js';
import { LineGraphs } from './line-graph.js';
import { figuresOf, type FigureContext } from './monitor-model.js';
import { NodeActionBar } from './node-actions.js';
import { ownerNames } from './owner-names.js';
import { ShareBars } from './share-bars.js';
import { useSubject, type Subject } from './use-subject.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

const KIND_LABEL: Readonly<Record<ResourceNodeKind, string>> = {
  root: 'Everything throng runs',
  component: 'Component',
  project: 'Project',
  tab: 'Tab',
  panel: 'Panel',
  buffers: 'Documents in memory',
  process: 'Process',
  limitation: 'Not measured',
};

function Fact({ name, label, children }: { name: string; label: string; children: ReactElement | string }): ReactElement {
  return (
    <>
      <dt className="detail-pane__term">{label}</dt>
      <dd className="detail-pane__value" data-testid={`detail-${name}`}>
        {children}
      </dd>
    </>
  );
}

function FigureFact({ figure }: { figure: Figure }): ReactElement {
  // What the figure IS, and why it reads "-", "~" or is partial (FR-107) — never its value, which is the text
  // beside it: a title that moved with every capture would be closed by the browser under a resting pointer (FR-095).
  let title = `${FIGURE_LABEL[figure.id]} — ${FIGURE_HINT[figure.id]}`;
  if (figure.note !== undefined) title += `; ${figure.note}`;
  if (figure.partial !== undefined) title += `; partial: ${figure.partial}`;
  return (
    <>
      <dt className="detail-pane__term">{FIGURE_LABEL[figure.id]}</dt>
      <dd
        className="detail-pane__value"
        data-testid={`detail-figure-${figure.id}`}
        data-band={figure.band}
        data-partial={figure.partial !== undefined ? 'true' : undefined}
        title={title}
      >
        {figure.text}
        {figure.band ? <span className="detail-pane__tag"> ({figure.band})</span> : null}
      </dd>
    </>
  );
}

function Details({ subject, ctx }: { subject: Subject; ctx: FigureContext }): ReactElement {
  const { node, ended, tree, frame } = subject;
  const p = node.process;
  const figures = ended || node.kind === 'limitation' ? [] : figuresOf(node, ctx);
  return (
    <>
      {/* The item's actions sit beside its name (FR-110): its standard action, the kills and Activate. */}
      <header className="detail-pane__header" data-testid="detail-header">
        <h3 className="detail-pane__name" data-testid="detail-name">
          {node.label}
        </h3>
        <NodeActionBar node={node} />
      </header>
      <p className="detail-pane__kind" data-testid="detail-kind">
        {KIND_LABEL[node.kind]}
      </p>
      <ShareBars subject={subject} />
      <dl className="detail-pane__facts">
        {p ? (
          <>
            <Fact name="state" label="State">
              {ended ? 'Ended' : 'Running'}
            </Fact>
            <Fact name="pid" label="Process id">
              {String(p.pid)}
            </Fact>
            <Fact name="command-line" label="Command line">
              {p.commandLine ?? p.unavailableReason ?? 'Not available'}
            </Fact>
            <Fact name="executable-path" label="Executable">
              {p.executablePath ?? p.unavailableReason ?? 'Not available'}
            </Fact>
            {p.startedAt !== undefined ? (
              <>
                <Fact name="started" label="Started">
                  {new Date(p.startedAt).toLocaleString()}
                </Fact>
                {!ended ? (
                  <Fact name="running-for" label="Running for">
                    {formatDuration(frame.at - p.startedAt)}
                  </Fact>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        <Fact name="owner" label={node.owner.component === 'projects' ? 'Belongs to' : 'Component'}>
          {ownerNames(node, tree).join(' › ')}
        </Fact>
        {node.kind === 'limitation' ? (
          <Fact name="reason" label="Why">
            {node.reason ?? 'Not measured'}
          </Fact>
        ) : null}
        {figures.map((f) => (
          <FigureFact key={f.id} figure={f} />
        ))}
      </dl>
      <LineGraphs subject={subject} />
    </>
  );
}

export function DetailPane(): ReactElement {
  const subject = useSubject();
  const { thresholds } = useResourceMonitorSettings();
  const ctx: FigureContext | null = subject ? { thresholds, machine: subject.frame.machine } : null;
  return (
    <section className="detail-pane" data-testid="detail-pane" aria-label="Details" tabIndex={0}>
      {subject && ctx ? <Details subject={subject} ctx={ctx} /> : <p className="detail-pane__empty">Nothing selected yet</p>}
    </section>
  );
}
