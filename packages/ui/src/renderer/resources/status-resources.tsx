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
 * The hover title always carries all four metrics for all four components, whatever the bar shows.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { isUnavailable, type MachineInfo, type UsageThresholds } from '@throng/core';
import type { ComponentId } from '@throng/core';
import type { ResourceSummary } from '@throng/ipc-contract';
import { Icon } from '../common/icon.js';
import { openResourceMonitor, setStatusItemElement } from './monitor-store.js';
import {
  FIGURE_HINT,
  FIGURE_ICON,
  FIGURE_LABEL,
  FIGURE_ORDER,
  breakdownLine,
  figureOf,
  fitFigures,
  type Figure,
  type FigureId,
} from './figures.js';
import { useResourceSummary } from './use-resource-summary.js';
import { useResourceMonitorSettings } from './use-monitor-settings.js';

/** Pixels the bar keeps for its own padding, and for the project path on its left (which ellipsises). */
const BAR_PADDING_PX = 20;
const PATH_RESERVE_PX = 200;

const COMPONENT_LABEL: Readonly<Record<ComponentId, string>> = {
  ui: 'UI',
  daemon: 'Daemon',
  helpers: 'Helpers',
  projects: 'Projects',
};

function figureTitle(f: Figure, stale: boolean): string {
  let title = `${FIGURE_LABEL[f.id]} ${f.text}`;
  if (f.band) title += ` (${f.band})`;
  title += ` — ${FIGURE_HINT[f.id]}`;
  if (isUnavailable(f.value)) title += `. ${f.value.reason}`;
  if (f.partial !== undefined) title += `. Partial: ${f.partial}`;
  if (stale) title += '. Last reading; the latest collection failed';
  return title;
}

function itemTitle(
  summary: ResourceSummary,
  figures: readonly Figure[],
): string {
  const lines = ['Resource Monitor'];
  if (summary.stale) lines.push('Last reading — the latest collection failed');
  for (const f of figures) {
    lines.push(
      `${FIGURE_LABEL[f.id]} ${f.text}${f.band ? ` (${f.band})` : ''}${f.partial !== undefined ? ` — partial: ${f.partial}` : ''}`,
    );
  }
  lines.push('');
  for (const c of summary.components) lines.push(breakdownLine(COMPONENT_LABEL[c.id], c.rolled));
  return lines.join('\n');
}

function figuresFor(summary: ResourceSummary, thresholds: UsageThresholds, machine: MachineInfo): Figure[] {
  return FIGURE_ORDER.map((id) => figureOf(id, summary.total, thresholds, machine));
}

export function StatusResources(): ReactElement {
  const summary = useResourceSummary();
  const { thresholds } = useResourceMonitorSettings();
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState<readonly FigureId[]>(FIGURE_ORDER);
  /** The widest each figure has been seen. */
  const widths = useRef<Partial<Record<FigureId, number>>>({});
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
      const id = el.getAttribute('data-figure') as FigureId;
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
    setStatusItemElement(el);
    return () => {
      rootRef.current = null;
      setStatusItemElement(null);
    };
  }, []);

  const shown = summary ? figures.filter((f) => visible.includes(f.id)) : [];

  return (
    <button
      ref={attach}
      type="button"
      className="status-resources"
      data-testid="status-resources"
      data-state={summary ? 'ready' : 'loading'}
      data-stale={summary?.stale ? 'true' : undefined}
      aria-label="Resource Monitor"
      aria-busy={summary ? undefined : true}
      title={summary ? itemTitle(summary, figures) : 'Resource Monitor — collecting the first reading'}
      onClick={openResourceMonitor}
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
            title={figureTitle(f, summary?.stale ?? false)}
          >
            <Icon token={FIGURE_ICON[f.id]} />
            <span className="status-resources__value">{f.text}</span>
          </span>
        ))
      )}
    </button>
  );
}
