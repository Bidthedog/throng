/**
 * The breakdown (055 US2, FR-020 – FR-024, FR-060, FR-088 – FR-094): the node in focus split among its
 * children, as a treemap and as rows, under a header that says where the user is.
 *
 * At the root it carries both halves of the intent from its first view (FR-020b) — throng's usage per
 * component and the user's usage per project — and everywhere else a single section for the focused
 * node's children. Everything it SHOWS is decided in `monitor-model.ts`; this draws it.
 *
 * ══ ONE ROVING TAB STOP ══
 *
 * Tab enters the breakdown once, on the row with the keyboard (`use-breakdown-keys.ts`), not once per
 * row or per tile: two hundred processes are not two hundred stops (FR-068). The drill-down buttons are
 * outside the Tab order for the same reason; Enter or Right on the row does what they do.
 *
 * ══ A CLICK SELECTS, A BUTTON OPENS (FR-088) ══
 *
 * "Use buttons to drill down, use clicks to select items." A click on a row or a tile selects its node, a
 * second click on it — or a click on empty space — clears the selection, and the node's drill-down
 * button opens it. Exactly the selected node is marked (FR-089); which row has the KEYBOARD is a
 * separate thing and is not drawn as a selection.
 *
 * ══ THE ORDER HOLDS (FR-090) ══
 *
 * Figures change every capture, and a list that re-sorts every capture cannot be clicked. While the
 * pointer is over the breakdown, or a node is selected, rows and tiles keep the order they had (new ones
 * after them, gone ones dropped) and only their figures update. When that ends they re-rank, and the ones
 * that moved slide to their new place (`flip.ts`).
 *
 * ══ WHAT ONE KEYSTROKE OR CLICK COSTS (SC-010) ══
 *
 * Every callback and prop handed to a row or a tile is stable, so a selection re-renders the two rows
 * whose mark changed rather than all of them. The model is built from the DEFERRED view, so a keystroke in
 * the filter shows in the field at once and the matches follow in a render React may interrupt.
 *
 * ══ WORDS, NEVER BARE NUMBERS ══
 *
 * A figure that is not a number reads `Not measured` or `Unavailable`; an ended process reads `ended`;
 * an estimate says `estimated`; a partial total carries its reason (FR-012, FR-024, FR-044, FR-065a).
 */
import {
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { IDLE_SAMPLES, formatGrouped, type ResourceNode } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { Breadcrumb } from './breadcrumb.js';
import { FIGURE_LABEL, FIGURE_ORDER, type Figure, type FigureId } from './figures.js';
import { moveFrom } from './flip.js';
import {
  allRows,
  buildBreakdown,
  figuresOf,
  tilesFor,
  valueText,
  type BreakdownModel,
  type BreakdownRow,
  type BreakdownSection,
  type FigureContext,
} from './monitor-model.js';
import {
  focusOn,
  getHistory,
  getIoPeak,
  isEnded,
  setSelection,
  toggleSelection,
  useSelection,
  useSession,
  useView,
} from './monitor-session.js';
import { useNodeActionsContext } from './node-actions.js';
import { Sparkline } from './sparkline.js';
import { HeatKey, Treemap } from './treemap.js';
import { useBreakdownKeys } from './use-breakdown-keys.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

/** What a row is when it cannot be measured (jsdom has no layout; a real one never reads 0). */
const ROW_HEIGHT_FALLBACK_PX = 24;

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

function RowView({ row, ctx, metric, active, selected, onSelect, onOpen, onMenu }: RowProps): ReactElement {
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
      title={valueText(node, ended, ctx, figures)}
      style={{ ['--breakdown-depth' as string]: row.depth }}
      onClick={() => onSelect(node.id)}
      onDoubleClick={opens ? () => onOpen(row.path) : undefined}
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
          {ended ? <span className="breakdown-row__spark" /> : <span className="breakdown-row__spark"><Sparkline nodeId={node.id} metric={metric} /></span>}
          {/* Four cells in a fixed order: written out, not mapped, so none of them needs a key (a dev build pays for each). */}
          {cell('cpu', 0)}
          {cell('memory', 1)}
          {cell('gpu', 2)}
          {cell('io', 3)}
        </>
      )}
      <span className="breakdown-row__open">{opens ? <OpenButton nodeId={node.id} label={node.label} path={row.path} onOpen={onOpen} /> : null}</span>
    </li>
  );
}

/**
 * The drill-down button (FR-088). Its own memoised piece, because it says the same thing on every capture
 * while the row around it re-renders for a figure: three of the elements a row costs to draw (the button,
 * its icon, its glyph) are not redrawn for a number moving.
 */
const OpenButton = memo(
  function OpenButton({ nodeId, label, path, onOpen }: { nodeId: string; label: string; path: readonly string[]; onOpen: (path: readonly string[]) => void }): ReactElement {
    return (
      <IconButton
        token="chevron"
        title={`Open ${label}`}
        testId={`breakdown-row-open-${nodeId}`}
        className="icon-button breakdown-row__open-button"
        tabIndex={-1}
        onClick={(e) => {
          // The row's own click is a selection; this is not.
          e.stopPropagation();
          onOpen(path);
        }}
      />
    );
  },
  (a, b) => a.nodeId === b.nodeId && a.label === b.label && a.onOpen === b.onOpen && a.path.length === b.path.length && a.path.every((id, i) => id === b.path[i]),
);

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
  if (a.metric !== b.metric || a.active !== b.active || a.selected !== b.selected) return false;
  if (a.onSelect !== b.onSelect || a.onOpen !== b.onOpen || a.onMenu !== b.onMenu) return false;
  if (a.ctx.thresholds !== b.ctx.thresholds || a.ctx.machine.installedRamBytes !== b.ctx.machine.installedRamBytes) return false;
  if (a.row === b.row) return true;
  const x = a.row;
  const y = b.row;
  const n = x.node;
  const m = y.node;
  if (x.depth !== y.depth || x.ended !== y.ended || x.path.join('/') !== y.path.join('/')) return false;
  if (n.id !== m.id || n.kind !== m.kind || n.label !== m.label || n.projectState !== m.projectState) return false;
  if (n.estimated !== m.estimated || n.sharedWith !== m.sharedWith || n.reason !== m.reason) return false;
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
  ioPeak,
  hold,
  activeId,
  selectedId,
  onSelect,
  onOpen,
  onMenu,
}: {
  section: BreakdownSection;
  ctx: FigureContext;
  metric: FigureId;
  ioPeak: number;
  hold: boolean;
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
      <div className="breakdown__map">
        <Treemap
          sectionId={section.id}
          tiles={tiles}
          metric={metric}
          ctx={ctx}
          ioPeak={ioPeak}
          selectedId={selectedId}
          hold={hold}
          onSelect={onSelect}
          onOpen={onOpen}
          onMenu={onMenu}
        />
        <HeatKey metric={metric} thresholds={ctx.thresholds} />
      </div>
      {section.rows.length === 0 ? (
        <p className="breakdown__empty" data-testid="breakdown-empty">
          Nothing to show here
        </p>
      ) : (
        <>
          <Columns sectionId={section.id} chosen={metric} />
          <ul className="breakdown__rows" role="tree" aria-label={section.title}>
          {section.rows.map((row) => (
            <Row
              key={row.path.join('/')}
              row={row}
              ctx={ctx}
              metric={metric}
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
    </section>
  );
}

/**
 * The names of the columns the rows are drawn in (FR-092), the chosen metric's marked. Decoration for
 * assistive technology: each figure already names itself in its title, and a header row inside a tree
 * would be a second thing to walk past.
 */
function Columns({ sectionId, chosen }: { sectionId: string; chosen: FigureId }): ReactElement {
  return (
    <div className="breakdown__columns" data-testid={`breakdown-columns-${sectionId}`} aria-hidden="true">
      <span />
      <span className="breakdown__column" data-testid="breakdown-column-trend" data-column="trend">
        Trend
      </span>
      {FIGURE_ORDER.map((id) => (
        <span
          key={id}
          className="breakdown__column"
          data-testid={`breakdown-column-${id}`}
          data-column={id}
          data-chosen={id === chosen ? 'true' : undefined}
        >
          {FIGURE_LABEL[id]}
        </span>
      ))}
      <span />
    </div>
  );
}

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

/** Where the user is, how to go back, and what sizes the tiles (FR-092). */
function Header({ tree, model, metric }: { tree: ResourceNode; model: BreakdownModel; metric: FigureId }): ReactElement {
  return (
    <header className="breakdown__header" data-testid="breakdown-header">
      <IconButton
        token="navigateBack"
        title="Back"
        testId="breakdown-back"
        className="icon-button breakdown__back"
        disabled={model.focusPath.length < 2}
        // The breakdown is one Tab stop (FR-068); Left and Backspace go up from the keyboard.
        tabIndex={-1}
        onClick={() => focusOn(model.focusPath.slice(0, -1))}
      />
      <Breadcrumb tree={tree} path={model.focusPath} onGo={focusOn} />
      <span className="breakdown__tile-size" data-testid="breakdown-tile-size">
        Tile size: {FIGURE_LABEL[metric]}
      </span>
    </header>
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
  const tree = useDeferredValue(session.tree);
  const frame = useDeferredValue(session.frame);
  const version = useDeferredValue(session.version);
  const liveView = useView();
  const filterText = useDeferredValue(liveView.filterText);
  const view = useMemo(() => (filterText === liveView.filterText ? liveView : { ...liveView, filterText }), [liveView, filterText]);
  const selectedId = useSelection();
  const { thresholds } = useResourceMonitorSettings();
  const machine = frame?.machine;

  // ── holding the order (FR-090) ──
  const [pointerOver, setPointerOver] = useState(false);
  const hold = pointerOver || selectedId !== null;
  const holdNow = useRef(hold);
  holdNow.current = hold;
  const heldKey = `${view.metric}|${view.focusPath.join('/')}`;
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
            isEnded,
            // The idle rule reads the last three samples (FR-061a): hand it those, not the whole history.
            ownHistory: (id) => getHistory(id).slice(-IDLE_SAMPLES).map((p) => p.own),
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

  if (!tree || !model || !ctx) return null;

  const activeRow = rows.find((r) => r.node.id === activeId);
  const onMenu = actions?.openMenu;
  const ioPeak = getIoPeak();

  return (
    <div
      className="breakdown"
      data-testid="breakdown"
      onKeyDown={keys.onKeyDown}
      ref={keys.ref}
      onMouseEnter={() => setPointerOver(true)}
      onMouseLeave={() => setPointerOver(false)}
      // Empty space is not a node: a click on it clears the selection (FR-088).
      onClick={(e) => {
        if (!(e.target as Element).closest(CLICKABLE)) setSelection(null);
      }}
    >
      <Header tree={tree} model={model} metric={view.metric} />
      <FocusSummary node={model.focus} ctx={ctx} />
      <Status model={model} filterText={view.filterText} hideIdle={view.hideIdle} />
      {model.sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          ctx={ctx}
          metric={view.metric}
          ioPeak={ioPeak}
          hold={hold}
          activeId={activeId}
          selectedId={selectedId}
          onSelect={toggleSelection}
          onOpen={focusOn}
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
