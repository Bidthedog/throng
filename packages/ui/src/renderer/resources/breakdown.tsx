/**
 * The left column (055 US2, FR-020 – FR-024, FR-088 – FR-096): the lists — Components and Projects at the
 * top, the children of whatever has been drilled into below — as rows, under a header that says where the
 * user is. Everything about the SELECTED item is the right column's (`detail-pane.tsx`, FR-097).
 *
 * At the root it carries both halves of the intent from its first view (FR-020b) — throng's usage per
 * component and the user's usage per project — and everywhere else a single section for the focused
 * node's children. Everything it SHOWS is decided in `monitor-model.ts`; this draws it.
 *
 * ══ ONE ROVING TAB STOP ══
 *
 * Tab enters the list once, on the row with the keyboard (`use-breakdown-keys.ts`), not once per row: two
 * hundred processes are not two hundred stops (FR-068).
 *
 * ══ A CLICK SELECTS, A DOUBLE-CLICK OPENS (FR-088, FR-096) ══
 *
 * A click on a row selects its node and shows it on the right; a second click on it — or a click on empty
 * space — clears the selection; a double-click, Enter or Right opens it (a node with nothing under it does
 * not). No row carries a button for that. Exactly the selected node is marked (FR-089); which row has the
 * KEYBOARD is a separate thing and is not drawn as a selection.
 *
 * ══ THE LIST HOLDS STILL (FR-090, FR-095) ══
 *
 * Figures change every capture, and a list that moves every capture cannot be clicked — nor can a tooltip
 * stay up on a row whose text changes. While the pointer is over the list it is drawn from the capture it
 * had when the pointer arrived — order, figures, sparklines — and catches up when the pointer leaves. With
 * a node selected and the pointer elsewhere the ORDER alone holds (new rows after, gone ones dropped) and the
 * figures move; when that ends the rows re-rank, and the ones that moved slide to their new place
 * (`flip.ts`).
 *
 * ══ WHAT ONE KEYSTROKE OR CLICK COSTS (SC-010) ══
 *
 * Every callback and prop handed to a row is stable, so a selection re-renders the two rows whose mark
 * changed rather than all of them. The model is built from the DEFERRED view, so a keystroke in the filter
 * shows in the field at once and the matches follow in a render React may interrupt.
 *
 * ══ WORDS, NEVER BARE NUMBERS ══
 *
 * A figure that is not a number reads "-" with its reason in its title, and an estimate reads "~" before
 * its figure (FR-107); an ended process reads `ended`; a partial total carries its reason (FR-012, FR-024,
 * FR-044, FR-065a).
 */
import {
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { IDLE_SAMPLES, describeNode, formatGrouped, type ResourceNode } from '@throng/core';
import { publishShownPath } from './monitor-location.js';
import { FIGURE_LABEL, networkUnavailableTitle, orderMetric, type Figure, type FigureId } from './figures.js';
import { moveFrom } from './flip.js';
import {
  allRows,
  buildBreakdown,
  descendants,
  figuresOf,
  type BreakdownModel,
  type BreakdownRow,
  type BreakdownSection,
  type BreakdownTotal,
  type FigureContext,
} from './monitor-model.js';
import {
  focusOn,
  getHistory,
  isEnded,
  setSelection,
  setView,
  toggleSelection,
  useSelection,
  useSession,
  useListView,
} from './monitor-session.js';
import { useNodeActionsContext } from './node-actions.js';
import { Sparkline, holdSparklines } from './sparkline.js';
import { useBreakdownKeys } from './use-breakdown-keys.js';
import { useColumnFit, type ColumnFit, type ColumnId } from './use-column-fit.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';
import { usePointerHold } from './use-pointer-hold.js';

/** What a row is when it cannot be measured (jsdom has no layout; a real one never reads 0). */
const ROW_HEIGHT_FALLBACK_PX = 24;

/**
 * What a row's hover title says: what it is, never how much (FR-095). A native tooltip whose text changes
 * is closed by the browser, so a title that moved with the figures would flash up and vanish every capture.
 */
function rowTitle(node: ResourceNode, ended: boolean): string {
  if (node.kind === 'limitation') return `${node.label}: ${node.reason ?? 'not measured'}`;
  // A component, or one of throng's own processes, says why it exists (FR-102) — the same words as the help.
  const description = describeNode(node);
  if (description !== undefined) return ended ? `${description} — ended` : description;
  return `${node.label}${ended ? ' — ended' : ''}`;
}


interface RowProps {
  readonly row: BreakdownRow;
  readonly ctx: FigureContext;
  readonly metric: FigureId;
  /** The columns that fit the list's width (FR-106), in display order; one identity while they do not change. */
  readonly columns: readonly ColumnId[];
  readonly active: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly onOpen: (path: readonly string[]) => void;
  /** Right-click, or the menu key, on the row: the node's actions (T078). Absent outside the monitor. */
  readonly onMenu: ((event: ReactMouseEvent, node: ResourceNode) => void) | undefined;
}

/** Tests only: told the id of every row as it is drawn, to prove that a capture redraws only the rows that changed. */
let rowDrawn: ((nodeId: string) => void) | undefined;
export function __onRowDrawn(listener: ((nodeId: string) => void) | undefined): void {
  rowDrawn = listener;
}

function RowView({ row, ctx, metric, columns, active, selected, onSelect, onOpen, onMenu }: RowProps): ReactElement {
  const { node, ended } = row;
  rowDrawn?.(node.id);
  const testId = `breakdown-row-${node.id}`;
  const limitation = node.kind === 'limitation';
  const figures = limitation || ended ? [] : figuresOf(node, ctx);
  const opens = node.children.length > 0;
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
  const cell = (id: FigureId, i: number): ReactElement => {
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
        title={ended ? undefined : f?.title}
      >
        {ended ? (i === 0 ? 'ended' : '') : f?.text}
      </span>
    );
  };

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
      title={rowTitle(node, ended)}
      style={{ ['--breakdown-depth' as string]: row.depth }}
      // The second click of a double-click is the open's, not a deselection.
      onClick={(e) => (e.detail > 1 ? undefined : onSelect(node.id))}
      onDoubleClick={opens ? () => onOpen(row.path) : undefined}
      onContextMenu={onMenu ? (e) => onMenu(e, node) : undefined}
    >
      <span className="breakdown-row__name">
        {node.label}
        {ended ? <span className="breakdown-row__tag"> ended</span> : null}
        {node.sharedWith ? <span className="breakdown-row__tag"> shares another panel’s document</span> : null}
      </span>
      {limitation ? (
        <span className="breakdown-row__reason" data-testid={`${testId}-reason`}>
          {node.reason}
        </span>
      ) : (
        <>
          {/* Only the columns that fit (FR-106): the grid has a track for each of these and no others. */}
          {columns.map((id, i) =>
            id === 'trend' ? (
              <span key={id} className="breakdown-row__spark">
                {ended ? null : <Sparkline nodeId={node.id} metric={metric} />}
              </span>
            ) : (
              cell(id, columns[0] === 'trend' ? i - 1 : i)
            ),
          )}
        </>
      )}
    </li>
  );
}

function sameFigures(a: readonly Figure[], b: readonly Figure[]): boolean {
  return a.length === b.length && a.every((f, i) => {
    const g = b[i]!;
    return f.id === g.id && f.text === g.text && f.band === g.band && f.partial === g.partial;
  });
}

/**
 * Whether a row would draw what it drew. Every capture hands every node over as a new object, so
 * identity says nothing; what a row DRAWS is its name, its marks and its four figures as text — a CPU of
 * 10.001% and one of 10% print the same, and a row that prints the same is left alone (SC-010: a capture
 * re-renders only the rows whose node changed). Its sparkline is not its parent's to redraw: it follows
 * the session itself (`sparkline.tsx`).
 */
function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.metric !== b.metric || a.columns !== b.columns || a.active !== b.active || a.selected !== b.selected) return false;
  if (a.onSelect !== b.onSelect || a.onOpen !== b.onOpen || a.onMenu !== b.onMenu) return false;
  if (a.ctx.thresholds !== b.ctx.thresholds || a.ctx.machine.installedRamBytes !== b.ctx.machine.installedRamBytes) return false;
  if (a.row === b.row) return true;
  const x = a.row;
  const y = b.row;
  const n = x.node;
  const m = y.node;
  if (x.depth !== y.depth || x.ended !== y.ended || x.path.join('/') !== y.path.join('/')) return false;
  if (n.id !== m.id || n.kind !== m.kind || n.label !== m.label || n.projectState !== m.projectState) return false;
  if (n.estimated !== m.estimated || n.sharedWith !== m.sharedWith || n.reason !== m.reason || n.role !== m.role) return false;
  if (n.children.length > 0 !== m.children.length > 0) return false;
  // A limitation or an ended row draws no figures.
  if (n.kind === 'limitation' || x.ended) return true;
  return sameFigures(figuresOf(n, a.ctx), figuresOf(m, b.ctx));
}

const Row = memo(RowView, sameRow);

function Section({
  section,
  ctx,
  metric,
  activeId,
  selectedId,
  onSelect,
  onOpen,
  onMenu,
  networkTitle,
  fit,
}: {
  section: BreakdownSection;
  ctx: FigureContext;
  metric: FigureId;
  fit: ColumnFit;
  /** Why Network cannot be ordered by, or `null` when it is measured. */
  networkTitle: string | null;
  activeId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (path: readonly string[]) => void;
  onMenu: ((event: ReactMouseEvent, node: ResourceNode) => void) | undefined;
}): ReactElement {
  return (
    <section className="breakdown__section" data-testid={`breakdown-section-${section.id}`} aria-label={section.title}>
      <h3 className="breakdown__heading">{section.title}</h3>
      {section.rows.length === 0 ? (
        <p className="breakdown__empty" data-testid="breakdown-empty">
          Nothing to show here
        </p>
      ) : (
        <>
          <Columns sectionId={section.id} chosen={metric} network={networkTitle} fit={fit} />
          <ul className="breakdown__rows" role="tree" aria-label={section.title}>
          {section.rows.map((row) => (
            <Row
              key={row.path.join('/')}
              row={row}
              ctx={ctx}
              metric={metric}
              columns={fit.visible}
              active={row.node.id === activeId}
              selected={row.node.id === selectedId}
              onSelect={onSelect}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          ))}
          </ul>
        </>
      )}
      <TotalRow sectionId={section.id} total={section.total} ctx={ctx} columns={fit.visible} />
    </section>
  );
}

/**
 * The last line of every list (FR-104): the listed node's own rolled-up figure per column — what the rows
 * above it add up to, ended processes never among them. The filter does not change it; it says instead how
 * many of the rows it counts are hidden. Not a row of the tree: not selectable, no actions, no sparkline.
 */
function TotalRow({
  sectionId,
  total,
  ctx,
  columns,
}: {
  sectionId: string;
  total: BreakdownTotal;
  ctx: FigureContext;
  columns: readonly ColumnId[];
}): ReactElement {
  const testId = `breakdown-total-${sectionId}`;
  const figures = figuresOf(total.node, ctx).filter((f) => columns.includes(f.id));
  return (
    <div className="breakdown-total" data-testid={testId}>
      <span className="breakdown-total__name">
        Total
        {total.hidden > 0 ? (
          <span className="breakdown-total__hidden" data-testid={`${testId}-hidden`}>
            {' '}
            includes {formatGrouped(total.hidden)} hidden
          </span>
        ) : null}
      </span>
      {columns.includes('trend') ? <span className="breakdown-total__spark" /> : null}
      {figures.map((f) => (
        <span key={f.id} className="breakdown-row__cell" data-testid={`${testId}-${f.id}`} data-metric={f.id} title={f.title}>
          {f.text}
        </span>
      ))}
    </div>
  );
}

/**
 * The names of the columns the rows are drawn in (FR-092), the chosen metric's marked. Each metric's name is
 * a button that orders the list by it (FR-099) — a text button, the column's own name, as a table header
 * is; Network is disabled, saying why, while it is not measured (FR-113).
 */
function Columns({
  sectionId,
  chosen,
  network,
  fit,
}: {
  sectionId: string;
  chosen: FigureId;
  network: string | null;
  fit: ColumnFit;
}): ReactElement {
  return (
    <div className="breakdown__columns" data-testid={`breakdown-columns-${sectionId}`} role="group" aria-label="Columns">
      <span />
      {fit.visible.map((id) => {
        if (id === 'trend') {
          return (
            <span key={id} className="breakdown__column" data-testid="breakdown-column-trend" data-column="trend">
              Trend
            </span>
          );
        }
        const why = id === 'network' ? network : null;
        return (
          <button
            key={id}
            type="button"
            className="breakdown__column breakdown__column--order"
            data-testid={`breakdown-column-${id}`}
            data-column={id}
            data-chosen={id === chosen ? 'true' : undefined}
            aria-pressed={id === chosen}
            disabled={why !== null}
            title={why ?? `Order by ${FIGURE_LABEL[id]}`}
            onClick={() => setView({ metric: id })}
          >
            {FIGURE_LABEL[id]}
          </button>
        );
      })}
      {/* FR-106: the list does not scroll sideways, so what did not fit is named here instead. */}
      {fit.hidden.length > 0 ? (
        <span
          className="breakdown__columns-hidden"
          data-testid="breakdown-columns-hidden"
          title={`Hidden: ${fit.hidden.map(columnLabel).join(', ')}. Widen the list or the window to see them`}
          aria-label={`${formatGrouped(fit.hidden.length)} ${fit.hidden.length === 1 ? 'column' : 'columns'} hidden: ${fit.hidden.map(columnLabel).join(', ')}`}
        >
          »
        </span>
      ) : null}
    </div>
  );
}

const columnLabel = (id: ColumnId): string => (id === 'trend' ? 'Trend' : FIGURE_LABEL[id]);

const plural = (n: number, one: string, many: string): string => `${formatGrouped(n)} ${n === 1 ? one : many}`;

/** What the filter matched and what Hide idle left out: said in words, so an empty list explains itself. */
function Status({ model, filterText, hideIdle }: { model: BreakdownModel; filterText: string; hideIdle: boolean }): ReactElement | null {
  const text = filterText.trim();
  return (
    <>
      {text === '' ? null : (
        <p className="breakdown__status" role="status" data-testid="breakdown-filter-status">
          {model.matches === 0 ? `No process matches '${text}'` : `${plural(model.matches, 'process', 'processes')} ${model.matches === 1 ? 'matches' : 'match'} '${text}'`}
        </p>
      )}
      {hideIdle && model.hiddenIdle > 0 ? (
        <p className="breakdown__status" data-testid="breakdown-idle-status">
          {plural(model.hiddenIdle, 'idle process', 'idle processes')} hidden
        </p>
      ) : null}
    </>
  );
}

/**
 * What the rows are ordered by (FR-092). Back and the breadcrumb are in the window's header (FR-112,
 * the Monitor location), which does not scroll with the list.
 */
function Header({ metric }: { metric: FigureId }): ReactElement {
  return (
    <header className="breakdown__header" data-testid="breakdown-header">
      <span className="breakdown__sorted-by" data-testid="breakdown-sorted-by">
        Ordered by {FIGURE_LABEL[metric]}
      </span>
    </header>
  );
}

/** What stands in the way of a click being a click: a click on any of these is theirs, not "empty space". */
const CLICKABLE = '[data-node-id], button, [role="button"], a, input, select';

/**
 * Slide the rows that changed place to where they now are (FR-090). Which rows moved is decided from the
 * previous render's order in memory; the one thing read back from the layout is a single row's height.
 */
function useRowMoves(model: BreakdownModel | null, container: { readonly current: HTMLElement | null }): void {
  const placed = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    if (model === null) return;
    const next = new Map<string, number>();
    for (const section of model.sections) section.rows.forEach((r, i) => next.set(`${section.id}|${r.node.id}`, i));
    const previous = placed.current;
    placed.current = next;
    if (previous.size === 0) return;

    // Rank among the rows both renders share, so a row appearing or going does not "move" everything below it.
    const was = [...previous.keys()].filter((k) => next.has(k));
    const now = [...next.keys()].filter((k) => previous.has(k));
    const wasRank = new Map(was.map((k, i) => [k, i] as const));
    const moved = now.filter((k, i) => wasRank.get(k) !== i);
    if (moved.length === 0) return;

    const byId = new Map<string, HTMLElement>();
    for (const el of container.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []) byId.set(el.getAttribute('data-node-id') ?? '', el);
    const height = byId.get(moved[0]!.slice(moved[0]!.indexOf('|') + 1))?.offsetHeight || ROW_HEIGHT_FALLBACK_PX;
    for (const key of moved) {
      const el = byId.get(key.slice(key.indexOf('|') + 1));
      if (el !== undefined) moveFrom(el, 0, ((previous.get(key) ?? 0) - (next.get(key) ?? 0)) * height);
    }
  }, [model, container]);
}

/** What the list draws from: the latest capture, or the one the pointer arrived at. */
interface Seen {
  readonly tree: ResourceNode | null;
  readonly frame: ReturnType<typeof useSession>['frame'];
  readonly version: number;
  /** Which processes had ended at that capture; `null` means ask the session as it stands. */
  readonly ended: ReadonlySet<string> | null;
}

export function Breakdown(): ReactElement | null {
  const actions = useNodeActionsContext();
  const session = useSession();
  // A frame is not urgent (Principle XII): the store tells this component at once, but the rows are
  // rebuilt from the DEFERRED snapshot, in a render React may interrupt for a keystroke or a click. The
  // frame is deferred WITH the tree it carries: read live, its machine figures would be new in the urgent
  // render while the rows were still the last capture's, and every row would be drawn twice per capture. The
  // filter text is deferred for the same reason: typing must show in the field before the matches do. The
  // rest of the view (the focus, the metric) is not — a drill or a metric choice is a click, and the
  // keyboard's focus follows the rows it asked for.
  const liveTree = useDeferredValue(session.tree);
  const liveFrame = useDeferredValue(session.frame);
  const liveVersion = useDeferredValue(session.version);
  const liveView = useListView();
  const filterText = useDeferredValue(liveView.filterText);
  // A chosen Network orders by CPU while Network is not measured (FR-099, derived); the choice itself is kept.
  const networkTitle = liveTree === null ? null : networkUnavailableTitle(liveTree.rolled);
  const metric = orderMetric(liveView.metric, liveTree);
  const view = useMemo(
    () => (filterText === liveView.filterText && metric === liveView.metric ? liveView : { ...liveView, filterText, metric }),
    [liveView, filterText, metric],
  );
  const heldKey = `${view.metric}|${view.focusPath.join('/')}`;
  // The pointer over the list freezes what it draws at what it was when the pointer arrived (FR-095): the
  // tree, the frame, the history the idle rule reads, and which processes had ended — the last is mutated in
  // place by the session, so it is copied. A drill, a Back or a metric change is a new level: the list is
  // replaced anyway, so it takes a fresh snapshot rather than showing minutes-old figures (`heldKey` is its scope).
  const pointer = usePointerHold<Seen>(
    { tree: liveTree, frame: liveFrame, version: liveVersion, ended: null },
    (live) => ({
      ...live,
      ended: new Set(live.tree === null ? [] : descendants(live.tree).filter((n) => isEnded(n.id)).map((n) => n.id)),
    }),
    (live) => live.version,
    heldKey,
  );
  const { tree, frame, version, ended } = pointer.value;
  const selectedId = useSelection();
  const { thresholds } = useResourceMonitorSettings();
  const machine = frame?.machine;

  // ── holding the order (FR-090) ──
  const hold = pointer.held || selectedId !== null;
  const holdNow = useRef(hold);
  holdNow.current = hold;
  /** The order the rows were last drawn in while nothing held it. */
  const drawn = useRef<{ key: string; ids: readonly string[] } | null>(null);
  // Starting to hold needs nothing: what is on screen IS the order to keep. Ending it does — re-rank now.
  const [released, setReleased] = useState(0);
  const wasHeld = useRef(false);
  useEffect(() => {
    if (wasHeld.current && !hold) setReleased((n) => n + 1);
    wasHeld.current = hold;
  }, [hold]);

  const ctx = useMemo<FigureContext | null>(() => (machine ? { thresholds, machine } : null), [thresholds, machine]);
  const model = useMemo(
    () =>
      tree && ctx
        ? buildBreakdown(tree, view, {
            isEnded: ended === null ? isEnded : (id) => ended.has(id),
            // The idle rule reads the last three samples (FR-061a): hand it those, not the whole history —
            // and, under the pointer, not any sample newer than the capture being drawn.
            ownHistory: (id) => {
              const upTo = ended === null || frame === null ? Infinity : frame.at;
              return getHistory(id).filter((p) => p.at <= upTo).slice(-IDLE_SAMPLES).map((p) => p.own);
            },
            thresholds: ctx.thresholds,
            machine: ctx.machine,
            ...(holdNow.current && drawn.current?.key === heldKey ? { heldOrder: drawn.current.ids } : {}),
          })
        : null,
    // `version` moves with every ingest, and with it the history the idle rule reads. `released` re-ranks
    // when a hold ends; a hold beginning must NOT rebuild, so the hold is read, not depended on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, ctx, view, version, released],
  );
  useLayoutEffect(() => {
    // Recorded while nothing holds — and at a NEW level or metric even when something does: the first model
    // there was ranked (the old order is not this level's), and that is the order to hold from then on.
    if (model !== null && (!holdNow.current || drawn.current?.key !== heldKey)) drawn.current = { key: heldKey, ids: allRows(model).map((r) => r.node.id) };
  }, [model, heldKey]);

  const rows = useMemo(() => (model ? allRows(model) : []), [model]);
  const activeId = useMemo(() => {
    const ids = rows.map((r) => r.node.id);
    return selectedId !== null && ids.includes(selectedId) ? selectedId : (ids[0] ?? null);
  }, [rows, selectedId]);
  const keys = useBreakdownKeys({ rows, activeId, focusPath: model?.focusPath ?? ['root'] });
  useRowMoves(model, keys.ref);
  // The header's breadcrumb names the level this list resolved to, not merely the one asked for.
  const shownPath = model?.focusPath ?? null;
  useLayoutEffect(() => publishShownPath(shownPath), [shownPath]);
  useEffect(() => () => publishShownPath(null), []);
  const fit = useColumnFit(keys.ref, view.metric, model !== null);
  // The sparklines hold with the figures beside them (FR-095).
  useEffect(() => {
    const list = keys.ref.current;
    return pointer.held && list !== null ? holdSparklines(list) : undefined;
  }, [pointer.held, keys.ref]);

  if (!tree || !model || !ctx) return null;

  const onMenu = actions?.openMenu;

  return (
    <div
      className="breakdown"
      data-testid="breakdown"
      onKeyDown={keys.onKeyDown}
      ref={keys.ref}
      {...pointer.bind}
      style={{ '--breakdown-columns': fit.template } as CSSProperties}
      // Empty space is not a node: a click on it clears the selection (FR-088).
      onClick={(e) => {
        if (!(e.target as Element).closest(CLICKABLE)) setSelection(null);
      }}
    >
      <Header metric={view.metric} />
      <Status model={model} filterText={view.filterText} hideIdle={view.hideIdle} />
      {model.sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          ctx={ctx}
          metric={view.metric}
          activeId={activeId}
          selectedId={selectedId}
          onSelect={toggleSelection}
          onOpen={focusOn}
          onMenu={onMenu}
          networkTitle={networkTitle}
          fit={fit}
        />
      ))}
      {/* No readout of the selected row's figures (FR-101): they are on the row, its detail on the right. */}
    </div>
  );
}
