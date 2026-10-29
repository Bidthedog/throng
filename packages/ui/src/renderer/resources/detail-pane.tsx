/**
 * The right column (055 FR-097): everything about the selected node — or, with nothing selected, about the
 * level the left column shows — and nothing about a selection appears anywhere else. Top to bottom: its
 * name and kind and the actions on it; what it is made of (`share-bars.tsx`); its facts (FR-012's process
 * facts); and a line graph per metric of its own usage (`line-graph.tsx`), where each figure reads once —
 * with a Y scale, its band, digit-grouped, estimated and not-measured ones saying so (FR-024, FR-012,
 * FR-120). There is no separate list of the figures.
 *
 * Unlike the left list this column does not hold still under the pointer — it is the one that keeps
 * updating (FR-095) — except for the bars, which hold their own order so a click on one lands on it.
 */
import { type ReactElement } from 'react';
import type { ResourceNodeKind } from '@throng/core';
import { formatDuration } from './format.js';
import { LineGraphs } from './line-graph.js';
import { NodeActionBar } from './node-actions.js';
import { ownerNames } from './owner-names.js';
import { ShareBars } from './share-bars.js';
import { useSubject, type Subject } from './use-subject.js';

/** The root has no kind line (FR-117): its name is "throng" and that is enough. */
const KIND_LABEL: Readonly<Partial<Record<ResourceNodeKind, string>>> = {
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

function Details({ subject }: { subject: Subject }): ReactElement {
  const { node, ended, tree, frame } = subject;
  const p = node.process;
  return (
    <>
      {/* The item's actions sit beside its name (FR-110): its standard action, the kills and Activate. */}
      <header className="detail-pane__header" data-testid="detail-header">
        <h3 className="detail-pane__name" data-testid="detail-name">
          {node.label}
        </h3>
        <NodeActionBar node={node} />
      </header>
      {KIND_LABEL[node.kind] !== undefined ? (
        <p className="detail-pane__kind" data-testid="detail-kind">
          {KIND_LABEL[node.kind]}
        </p>
      ) : null}
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
        {/* No list of the item's figures (FR-120): each reads once, beside its graph. */}
      </dl>
      <LineGraphs subject={subject} />
    </>
  );
}

export function DetailPane(): ReactElement {
  const subject = useSubject();
  return (
    <section className="detail-pane" data-testid="detail-pane" aria-label="Details" tabIndex={0}>
      {subject ? <Details subject={subject} /> : <p className="detail-pane__empty">Nothing selected yet</p>}
    </section>
  );
}
