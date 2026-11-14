import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { logExpected } from '@throng/core';

export interface StackPanel {
  key: string;
  /** Minimum height (px); a divider drag can never push this panel below it. */
  minHeight: number;
  /** Preferred starting height (px) before the first persist; defaults sensibly. */
  defaultHeight?: number;
  /** Extra class for the panel wrapper (e.g. sidebar-panel--subworkspaces). */
  className?: string;
  /** testid for the divider BELOW this panel (omit on the last panel). */
  dividerTestId?: string;
  /** 068 FR-036/FR-038: this panel can be minimised to its header, the panel above taking the space. */
  minimisable?: boolean;
  /** Height (px) of a minimised panel: its header. Defaults to {@link MINIMISED_HEIGHT}. */
  minimisedHeight?: number;
  render: (ctx: StackPanelContext) => ReactElement;
}

/** What a panel is told about its place in the stack, so it can draw its own minimise control. */
export interface StackPanelContext {
  minimised: boolean;
  toggleMinimise: () => void;
}

/** Default height of a minimised panel: one header row (`--pane-header-height`, 34px). */
export const MINIMISED_HEIGHT = 34;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Distribute `total` over panels so every panel ≥ its min and they sum to `total`.
 *  Window growth feeds ONLY the FIRST panel (e.g. Projects) — the lower panels keep
 *  their sizes and stay pinned to the bottom. A shortfall is taken from the TOP
 *  down (Projects first, then the middle panel, …) and never pushes a panel below
 *  its min, so a shrunk middle panel stays at its min when the window grows again. */
function fit(sizes: number[], mins: number[], total: number, rigid: boolean[] = []): number[] {
  const out = sizes.map((v, i) => (rigid[i] ? mins[i] : Math.max(v, mins[i])));
  const diff = total - out.reduce((a, b) => a + b, 0);
  if (diff > 0) {
    const first = rigid.findIndex((r) => !r);
    out[first < 0 ? 0 : first] += diff;
  } else if (diff < 0) {
    let need = -diff;
    for (let i = 0; i < out.length && need > 0; i += 1) {
      const take = Math.min(out[i] - mins[i], need);
      out[i] -= take;
      need -= take;
    }
  }
  return out;
}

function defaultSizes(panels: StackPanel[]): number[] {
  // A reasonable starting split; fit() will normalise to the real container.
  return panels.map((p) => p.defaultHeight ?? Math.max(p.minHeight, 200));
}

function loadMinimisedFlags(storageKey: string | undefined, count: number): boolean[] | null {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length === count && parsed.every((b) => typeof b === 'boolean')) {
      return parsed as boolean[];
    }
  } catch (error) {
    logExpected('vertical-panel-stack: read minimised state', 'localStorage may be unavailable or hold a corrupt entry; no panel starts minimised', error);
  }
  return null;
}

function load(storageKey: string, count: number): number[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length === count && parsed.every((n) => typeof n === 'number')) {
      return parsed as number[];
    }
  } catch (error) {
    logExpected('vertical-panel-stack: read panel sizes', 'localStorage may be unavailable or hold a corrupt entry; the default sizes are used', error);
  }
  return null;
}

/**
 * A vertical stack of resizable panels (US7 sidebar). Each panel has a min height;
 * dividers resize only the two adjacent panels and are clamped so neither can be
 * dragged below its min. On container resize the sizes are re-fitted (last panel
 * absorbs growth; top panels yield first on shrink). Sizes persist to localStorage.
 */
export function VerticalPanelStack({
  panels,
  storageKey,
  minimisedStorageKey,
}: {
  panels: StackPanel[];
  storageKey: string;
  /** 068 FR-037: where the per-panel minimised flags persist (data-model "Side-panel layout state"). */
  minimisedStorageKey?: string;
}): ReactElement {
  const [minimised, setMinimised] = useState<boolean[]>(
    () => loadMinimisedFlags(minimisedStorageKey, panels.length) ?? panels.map(() => false),
  );
  const minimisedRef = useRef(minimised);
  minimisedRef.current = minimised;
  // A minimised panel is rigid at its header's height; the rest share what is left.
  const heightWhenMinimised = panels.map((p) => p.minimisedHeight ?? MINIMISED_HEIGHT);
  const mins = panels.map((p, i) => (minimised[i] ? heightWhenMinimised[i]! : p.minHeight));
  const containerRef = useRef<HTMLDivElement>(null);
  const sizesRef = useRef<number[]>(load(storageKey, panels.length) ?? defaultSizes(panels));
  const [sizes, setSizesState] = useState<number[]>(sizesRef.current);
  const [dragging, setDragging] = useState<number | null>(null);

  const apply = useCallback((next: number[]) => {
    sizesRef.current = next;
    setSizesState(next);
  }, []);

  // Re-fit to the live container height (mount + on resize).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const refit = (): void => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) apply(fitKeepingMinimised(sizesRef.current, mins, h, minimisedRef.current));
    };
    refit();
    // A host without layout observation (a test realm) keeps the one fit above.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => ro.disconnect();
    // mins is derived from props each render but stable in practice for the sidebar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, panels.length, minimised]);

  const persistSizes = useCallback(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sizesRef.current));
    } catch (error) {
      logExpected('vertical-panel-stack: persist panel sizes', 'localStorage may be full or unavailable; the sizes hold for this session only', error);
    }
  }, [storageKey]);

  const toggleMinimise = (i: number): void => {
    if (!panels[i]?.minimisable) return;
    const next = minimisedRef.current.map((m, j) => (j === i ? !m : m));
    minimisedRef.current = next;
    setMinimised(next);
    // The minimised panel keeps its last height in the sizes array, so restore returns to it (FR-037).
    if (minimisedStorageKey) {
      try {
        localStorage.setItem(minimisedStorageKey, JSON.stringify(next));
      } catch (error) {
        logExpected('vertical-panel-stack: persist minimised state', 'localStorage may be full or unavailable; the state holds for this session only', error);
      }
    }
    persistSizes();
  };

  const startDrag = (i: number) => (e: ReactPointerEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    // A divider next to a minimised panel has nothing to resize.
    if (minimisedRef.current[i] || minimisedRef.current[i + 1]) return;
    const start = [...sizesRef.current];
    setDragging(i);
    const onMove = (ev: PointerEvent): void => {
      const delta = ev.clientY - startY;
      // Only the boundary between panel i and i+1 moves, clamped to both mins.
      const d = clamp(delta, -(start[i] - mins[i]), start[i + 1] - mins[i + 1]);
      const next = [...start];
      next[i] += d;
      next[i + 1] -= d;
      apply(next);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      setDragging(null);
      persistSizes();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  };

  return (
    <div className="panel-stack" ref={containerRef}>
      {panels.map((p, i) => (
        <Fragment key={p.key}>
          <div
            className={`sidebar-panel${p.className ? ` ${p.className}` : ''}`}
            style={{ height: `${minimised[i] ? mins[i] : sizes[i]}px`, flex: '0 0 auto', ...(minimised[i] ? { overflow: 'hidden' } : {}) }}
            data-minimised={minimised[i] ? 'true' : undefined}
          >
            {p.render({ minimised: minimised[i] === true, toggleMinimise: () => toggleMinimise(i) })}
          </div>
          {i < panels.length - 1 ? (
            <div
              className={`resize-handle resize-handle--horizontal${dragging === i ? ' resize-handle--active' : ''}`}
              data-testid={p.dividerTestId}
              onPointerDown={startDrag(i)}
              aria-hidden
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * `fit`, with each minimised panel held at its header height and its REMEMBERED height left alone in
 * the result — so restoring one gives back the height it had, and the panel that took the space gives
 * it up again (the shortfall is taken from the top down).
 */
function fitKeepingMinimised(sizes: number[], mins: number[], total: number, minimised: boolean[]): number[] {
  const fitted = fit(sizes, mins, total, minimised);
  return fitted.map((v, i) => (minimised[i] ? sizes[i]! : v));
}
