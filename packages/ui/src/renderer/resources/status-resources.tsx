/**
 * The status-bar resource item (055 US1, FR-040 – FR-046): throng's total CPU, memory, GPU and I/O,
 * each an icon plus a digit-grouped value, as ONE button that opens the Resource Monitor (FR-043).
 *
 * ══ WHAT IT DOES NOT DO ══
 *
 * It does no OS query and no arithmetic over processes: the collector sends the totals and their split
 * by component (`ResourceSummary`), this only draws them. It keeps no history (FR-033).
 *
 * ══ OVERFLOW (FR-045, Constitution XII) ══
 *
 * When the bar is too narrow the figures drop GPU → I/O → memory → CPU and come back in reverse. The
 * budget is measured, not guessed: ONE `ResizeObserver` on the bar, and every measurement is a read
 * pass (bar width, sibling widths, the visible figures' widths) followed by a single state write — no
 * read after a write, so no forced layout. A figure's width is the widest it has been seen, so a value
 * growing from `9.9%` to `10.0%` cannot make the item flap at the boundary.
 *
 * ══ THE POPOVER (FR-115) ══
 *
 * Resting the pointer on the item, or focusing it, opens `status-popover.tsx` — all four metrics for all
 * four components, whatever the bar shows — in place of a native title (which the browser closes and
 * reopens at every capture). It stays while the pointer is over the item or the popover, closes on leaving
 * both (after a short grace, to cross the gap between them) or on Esc, and after Esc stays closed until the
 * pointer re-enters or focus returns. A ring of the main window's totals since it opened feeds its graphs.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type ReactElement } from 'react';
import { isUnavailable, type MachineInfo, type UsageThresholds } from '@throng/core';
import type { ResourceSummary } from '@throng/ipc-contract';
import { Icon } from '../common/icon.js';
import { openResourceMonitor, setStatusItemElement } from './monitor-store.js';
import {
  FIGURE_ICON,
  STATUS_FIGURE_ORDER,
  figureOf,
  fitFigures,
  type Figure,
  type StatusFigureId,
} from './figures.js';
import { StatusPopover } from './status-popover.js';
import { StatusHistory } from './status-history.js';
import { useResourceSummary } from './use-resource-summary.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

/** Pixels the bar keeps for its own padding, and for the project path on its left (which ellipsises). */
const BAR_PADDING_PX = 20;
const PATH_RESERVE_PX = 200;

/** The status bar's four figures — never Network, which is the monitor's alone (FR-113). */
type StatusFigure = Figure & { readonly id: StatusFigureId };

function figuresFor(summary: ResourceSummary, thresholds: UsageThresholds, machine: MachineInfo): StatusFigure[] {
  return STATUS_FIGURE_ORDER.map((id) => ({ ...figureOf(id, summary.total, thresholds, machine), id }));
}

/** How long the pointer may be off both the item and the popover before it closes: the gap between them. */
const CLOSE_GRACE_MS = 120;

/** Whether `el` has keyboard (`:focus-visible`) focus. An engine without the selector says yes, rather than leave the keyboard with no route. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * Whether the popover is open (FR-115): the pointer is over the item or the popover, or the item has
 * focus; Esc dismisses it until the pointer re-enters the item or focus returns.
 */
function usePopoverOpen(): {
  open: boolean;
  itemHandlers: { onPointerEnter: () => void; onPointerLeave: () => void; onFocus: (e: FocusEvent<HTMLElement>) => void; onBlur: () => void };
  popoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
} {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const open = (hover || focused) && !dismissed;

  const cancelClose = useCallback((): void => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const scheduleClose = useCallback((): void => {
    cancelClose();
    timer.current = window.setTimeout(() => setHover(false), CLOSE_GRACE_MS);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return {
    open,
    itemHandlers: {
      onPointerEnter: () => {
        cancelClose();
        setDismissed(false);
        setHover(true);
      },
      onPointerLeave: scheduleClose,
      onFocus: (e) => {
        // Only focus the keyboard gave: clicking the item focuses it, and opening the monitor then blurs it, so
        // when the window comes back (Esc, Alt+Tab) focus is restored with no pointer near and no reason to open.
        if (!focusVisible(e.currentTarget)) return;
        setDismissed(false);
        setFocused(true);
      },
      onBlur: () => setFocused(false),
    },
    popoverHandlers: { onPointerEnter: cancelClose, onPointerLeave: scheduleClose },
  };
}

export function StatusResources(): ReactElement {
  const summary = useResourceSummary();
  const { thresholds } = useResourceMonitorSettings();
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const popover = usePopoverOpen();
  const popoverId = useId();
  /** The main window's totals since it opened (FR-115): fed whether or not the popover is open. */
  const ring = useRef<StatusHistory | null>(null);
  ring.current ??= new StatusHistory();
  const points = useMemo(() => {
    if (summary === null) return [];
    ring.current?.push(summary);
    return ring.current?.points() ?? [];
  }, [summary]);
  const [visible, setVisible] = useState<readonly StatusFigureId[]>(STATUS_FIGURE_ORDER);
  /** The widest each figure has been seen. */
  const widths = useRef<Partial<Record<StatusFigureId, number>>>({});
  const hasSummary = useRef(false);
  hasSummary.current = summary !== null;

  const figures = useMemo(
    () => (summary ? figuresFor(summary, thresholds, summary.machine) : []),
    [summary, thresholds],
  );

  /** Read pass, then one write. Called after every render that can change a width, and on resize. */
  const measure = useCallback((): void => {
    const root = rootRef.current;
    const bar = root?.closest<HTMLElement>('.throng-status-bar');
    // Before the first summary there are no figures to measure, and fitting nothing would drop them all
    // before they have ever been drawn — leaving no width to bring them back by.
    if (!root || !bar || !hasSummary.current) return;
    // ── reads ──
    const barWidth = bar.clientWidth;
    let others = 0;
    for (const sibling of Array.from(root.parentElement?.children ?? [])) {
      if (sibling !== root) others += sibling.getBoundingClientRect().width;
    }
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-figure]'))) {
      const id = el.getAttribute('data-figure') as StatusFigureId;
      const width = el.getBoundingClientRect().width;
      if (width > (widths.current[id] ?? 0)) widths.current[id] = width;
    }
    // ── compute, then the only write ──
    const next = fitFigures(barWidth - BAR_PADDING_PX - PATH_RESERVE_PX - others, widths.current);
    setVisible((prev) => (prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next));
  }, []);

  const measureRef = useRef(measure);
  measureRef.current = measure;

  // After every render that changed the figures or which of them are drawn.
  useLayoutEffect(() => {
    measure();
  }, [measure, summary, visible]);

  // One observer for the item's life: the bar's width is the only thing that changes the budget.
  useEffect(() => {
    const bar = rootRef.current?.closest<HTMLElement>('.throng-status-bar');
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const attach = useCallback((el: HTMLButtonElement | null) => {
    rootRef.current = el;
    setAnchor(el);
    setStatusItemElement(el);
    return () => {
      rootRef.current = null;
      setAnchor(null);
      setStatusItemElement(null);
    };
  }, []);

  const shown = summary ? figures.filter((f) => visible.includes(f.id)) : [];

  return (
    <>
      <button
        ref={attach}
        type="button"
        className="status-resources"
        data-testid="status-resources"
        data-state={summary ? 'ready' : 'loading'}
        data-stale={summary?.stale ? 'true' : undefined}
        aria-label="Open Resource Monitor"
        aria-busy={summary ? undefined : true}
        aria-describedby={summary && popover.open ? popoverId : undefined}
        onClick={openResourceMonitor}
        {...popover.itemHandlers}
      >
        {shown.length === 0 ? (
          <span className="status-resources__icon" data-testid="status-resources-icon">
            <Icon token="resourceMonitor" />
          </span>
        ) : (
          shown.map((f) => (
            <span
              key={f.id}
              className="status-resources__figure"
              data-testid={`status-resources-${f.id}`}
              data-figure={f.id}
              data-band={f.band}
              data-unavailable={isUnavailable(f.value) ? 'true' : undefined}
              data-partial={f.partial !== undefined ? 'true' : undefined}
            >
              <Icon token={FIGURE_ICON[f.id]} />
              <span className="status-resources__value">{f.text}</span>
            </span>
          ))
        )}
      </button>
      {/* A sibling, not a child: a click inside the popover is its own and must not open the monitor. */}
      {summary && popover.open ? (
        <StatusPopover
          anchor={anchor}
          summary={summary}
          figures={figures}
          points={points}
          id={popoverId}
          {...popover.popoverHandlers}
        />
      ) : null}
    </>
  );
}
