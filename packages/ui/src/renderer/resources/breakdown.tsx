/**
 * The breakdown (055 US2, FR-020 – FR-024, FR-060): the node in focus split among its children, as a
 * treemap and as rows, under a breadcrumb.
 *
 * At the root it carries both halves of the intent from its first view (FR-020b) — throng's usage per
 * component and the user's usage per project — and everywhere else a single section for the focused
 * node's children. Everything it SHOWS is decided in `monitor-model.ts`; this draws it.
 *
 * ══ ONE ROVING TAB STOP ══
 *
 * Tab enters the breakdown once, on the row with the keyboard (`use-breakdown-keys.ts`), not once per
 * row or per tile: two hundred processes are not two hundred stops (FR-068).
 *
 * ══ WORDS, NEVER BARE NUMBERS ══
 *
 * A figure that is not a number reads `Not measured` or `Unavailable`; an ended process reads `ended`;
 * an estimate says `estimated`; a partial total carries its reason (FR-012, FR-024, FR-044, FR-065a).
 */
import { memo, useDeferredValue, useMemo, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import type { ResourceNode } from '@throng/core';
import { Breadcrumb } from './breadcrumb.js';
import { FIGURE_LABEL, FIGURE_ORDER, type Figure, type FigureId } from './figures.js';
import {
  allRows,
  buildBreakdown,
  figuresOf,
  tilesFor,
  valueText,
  type BreakdownRow,
  type BreakdownSection,
  type FigureContext,
} from './monitor-model.js';
import {
  focusOn,
  getHistory,
  isEnded,
  setSelection,
  useSelection,
  useSession,
  useView,
} from './monitor-session.js';
import { useNodeActionsContext } from './node-actions.js';
import { Sparkline } from './sparkline.js';
import { Treemap } from './treemap.js';
import { useBreakdownKeys } from './use-breakdown-keys.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

const CELL_ORDER: readonly FigureId[] = FIGURE_ORDER;

function cellTitle(rowLabel: string, f: Figure): string {
  let title = `${rowLabel}: ${f.text}`;
  if (f.band) title += ` (${f.band})`;
  if (f.partial !== undefined) title += ` — partial: ${f.partial}`;
  return title;
}

interface RowProps {
  readonly row: BreakdownRow;
  readonly ctx: FigureContext;
  readonly metric: FigureId;
  readonly version: number;
  readonly active: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly onOpen: (path: readonly string[]) => void;
  /** Right-click, or the menu key, on the row: the node's actions (T078). Absent outside the monitor. */
  readonly onMenu: ((event: ReactMouseEvent, node: ResourceNode) => void) | undefined;
}

function RowView({ row, ctx, metric, version, active, selected, onSelect, onOpen, onMenu }: RowProps): ReactElement {
  const { node, ended } = row;
  const testId = `breakdown-row-${node.id}`;
  const limitation = node.kind === 'limitation';
  const figures = limitation || ended ? [] : figuresOf(node, ctx);
  const className = [
    'breakdown-row',
    ended ? 'breakdown-row--ended' : '',
    node.projectState === 'unloaded' ? 'breakdown-row--unloaded' : '',
    limitation ? 'breakdown-row--limitation' : '',
    selected ? 'breakdown-row--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const hasPartial = figures.some((f) => f.partial !== undefined);

  return (
    <li
      className={className}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      data-testid={testId}
      data-node-id={node.id}
      data-kind={node.kind}
      data-project-state={node.projectState}
      data-estimated={node.estimated ? 'true' : undefined}
      data-ended={ended ? 'true' : undefined}
      data-partial={hasPartial ? 'true' : undefined}
      title={valueText(node, ended, ctx, figures)}
      style={{ ['--breakdown-depth' as string]: row.depth }}
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpen(row.path)}
      onContextMenu={onMenu ? (e) => onMenu(e, node) : undefined}
    >
      <span className="breakdown-row__name">
        {node.label}
        {node.estimated ? <span className="breakdown-row__tag"> estimated</span> : null}
        {ended ? <span className="breakdown-row__tag"> ended</span> : null}
        {node.sharedWith ? <span className="breakdown-row__tag"> shares another panel’s document</span> : null}
      </span>
      {limitation ? (
        <span className="breakdown-row__reason" data-testid={`${testId}-reason`}>
          {node.reason}
        </span>
      ) : (
        <>
          {ended ? <span className="breakdown-row__spark" /> : <span className="breakdown-row__spark"><Sparkline nodeId={node.id} metric={metric} version={version} /></span>}
          {CELL_ORDER.map((id, i) => {
            const f: Figure | undefined = figures.find((x) => x.id === id);
            return (
              <span
                key={id}
                className="breakdown-row__cell"
                data-testid={`${testId}-${id}`}
                data-metric={id}
                data-band={f?.band}
                data-partial={f?.partial !== undefined ? 'true' : undefined}
                data-unavailable={f && typeof f.value === 'object' && f.value.kind === 'unavailable' ? 'true' : undefined}
                title={f ? cellTitle(node.label, f) : undefined}
              >
                {ended ? (i === 0 ? 'ended' : '') : f?.text}
                {!ended && id === 'memory' && node.estimated ? <span className="breakdown-row__tag"> estimated</span> : null}
              </span>
            );
          })}
        </>
      )}
    </li>
  );
}

const Row = memo(RowView);

function Section({
  section,
  ctx,
  metric,
  version,
  activeId,
  selectedId,
  onSelect,
  onOpen,
  onMenu,
}: {
  section: BreakdownSection;
  ctx: FigureContext;
  metric: FigureId;
  version: number;
  activeId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (path: readonly string[]) => void;
  onMenu: ((event: ReactMouseEvent, node: ResourceNode) => void) | undefined;
}): ReactElement {
  const tiles = useMemo(() => tilesFor(section, metric, isEnded), [section, metric]);
  return (
    <section className="breakdown__section" data-testid={`breakdown-section-${section.id}`} aria-label={section.title}>
      <h3 className="breakdown__heading">{section.title}</h3>
      <Treemap sectionId={section.id} tiles={tiles} metric={metric} ctx={ctx} activeId={activeId} onOpen={onOpen} />
      {section.rows.length === 0 ? (
        <p className="breakdown__empty" data-testid="breakdown-empty">
          Nothing to show here
        </p>
      ) : (
        <ul className="breakdown__rows" role="tree" aria-label={section.title}>
          {section.rows.map((row) => (
            <Row
              key={row.path.join('/')}
              row={row}
              ctx={ctx}
              metric={metric}
              version={version}
              active={row.node.id === activeId}
              selected={row.node.id === selectedId}
              onSelect={onSelect}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The focused node's own line: its totals, with any partial reason in plain sight (FR-044). */
function FocusSummary({ node, ctx }: { node: ResourceNode; ctx: FigureContext }): ReactElement {
  const figures = figuresOf(node, ctx);
  return (
    <p className="breakdown__summary" data-testid="breakdown-focus-summary">
      <strong>{node.label}</strong>
      {figures.map((f) => (
        <span key={f.id} className="breakdown__summary-figure" data-band={f.band}>
          {' '}
          {FIGURE_LABEL[f.id]} {f.text}
          {f.partial !== undefined ? ` (partial: ${f.partial})` : ''}
        </span>
      ))}
    </p>
  );
}

export function Breakdown(): ReactElement | null {
  const actions = useNodeActionsContext();
  const session = useSession();
  const { frame } = session;
  // A frame is not urgent (Principle XII): the store tells this component at once, but the rows are
  // rebuilt from the DEFERRED snapshot, in a render React may interrupt for a keystroke or a click.
  const tree = useDeferredValue(session.tree);
  const version = useDeferredValue(session.version);
  const view = useView();
  const selectedId = useSelection();
  const { thresholds } = useResourceMonitorSettings();
  const machine = frame?.machine;

  const ctx = useMemo<FigureContext | null>(() => (machine ? { thresholds, machine } : null), [thresholds, machine]);
  const model = useMemo(
    () =>
      tree && ctx
        ? buildBreakdown(tree, view, {
            isEnded,
            ownHistory: (id) => getHistory(id).map((p) => p.own),
            thresholds: ctx.thresholds,
            machine: ctx.machine,
          })
        : null,
    // `version` moves with every ingest, and with it the history the idle rule reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, ctx, view, version],
  );

  const rows = useMemo(() => (model ? allRows(model) : []), [model]);
  const activeId = useMemo(() => {
    const ids = rows.map((r) => r.node.id);
    return selectedId !== null && ids.includes(selectedId) ? selectedId : (ids[0] ?? null);
  }, [rows, selectedId]);
  const keys = useBreakdownKeys({ rows, activeId, focusPath: model?.focusPath ?? ['root'] });

  if (!tree || !model || !ctx) return null;

  const activeRow = rows.find((r) => r.node.id === activeId);
  const onOpen = (path: readonly string[]): void => focusOn(path);
  const onMenu = actions?.openMenu;

  return (
    <div className="breakdown" data-testid="breakdown" onKeyDown={keys.onKeyDown} ref={keys.ref}>
      <Breadcrumb tree={tree} path={model.focusPath} onGo={focusOn} />
      <FocusSummary node={model.focus} ctx={ctx} />
      {model.sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          ctx={ctx}
          metric={view.metric}
          version={version}
          activeId={activeId}
          selectedId={selectedId}
          onSelect={setSelection}
          onOpen={onOpen}
          onMenu={onMenu}
        />
      ))}
      {/* What hovering the keyboard's row would show (FR-068): the same text, as its own announcement. */}
      <pre className="breakdown__readout" data-testid="breakdown-readout" aria-live="polite">
        {activeRow ? valueText(activeRow.node, activeRow.ended, ctx) : ''}
      </pre>
    </div>
  );
}
