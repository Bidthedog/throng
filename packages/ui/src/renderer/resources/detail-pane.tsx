/**
 * The detail pane (055 US2 scenario 8): what the selected node — or, with nothing selected, the node in
 * focus — is. For a process: its name, id, full command line, executable path, start time, how long it
 * has run, and what owns it; for any node, its figures, banded and digit-grouped. Estimated and
 * not-measured figures say so (FR-024, FR-012).
 *
 * The time-series charts that go with it are `chart-pane.tsx`'s: a separate Tab region (FR-068).
 */
import { type ReactElement } from 'react';
import { FIGURE_HINT, FIGURE_LABEL, type Figure } from './figures.js';
import { formatDuration } from './format.js';
import { figuresOf, type FigureContext } from './monitor-model.js';
import { NodeActionBar } from './node-actions.js';
import { ownerNames } from './owner-names.js';
import { useSubject, type Subject } from './use-subject.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

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

function FigureFact({ figure, estimated }: { figure: Figure; estimated: boolean }): ReactElement {
  let title = `${FIGURE_LABEL[figure.id]}: ${figure.text}`;
  if (figure.band) title += ` (${figure.band})`;
  title += ` — ${FIGURE_HINT[figure.id]}`;
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
        {estimated && figure.id === 'memory' ? <span className="detail-pane__tag"> estimated</span> : null}
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
      <h3 className="detail-pane__name" data-testid="detail-name">
        {node.label}
      </h3>
      <NodeActionBar node={node} />
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
          <FigureFact key={f.id} figure={f} estimated={node.estimated === true} />
        ))}
      </dl>
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
