import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';

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
  render: () => ReactElement;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Distribute `total` over panels so every panel ≥ its min and they sum to `total`.
 *  Window growth feeds ONLY the FIRST panel (e.g. Projects) — the lower panels keep
 *  their sizes and stay pinned to the bottom. A shortfall is taken from the TOP
 *  down (Projects first, then the middle panel, …) and never pushes a panel below
 *  its min, so a shrunk middle panel stays at its min when the window grows again. */
function fit(sizes: number[], mins: number[], total: number): number[] {
  const out = sizes.map((v, i) => Math.max(v, mins[i]));
  const diff = total - out.reduce((a, b) => a + b, 0);
  if (diff > 0) {
    out[0] += diff;
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

function load(storageKey: string, count: number): number[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length === count && parsed.every((n) => typeof n === 'number')) {
      return parsed as number[];
    }
  } catch {
    /* ignore */
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
}: {
  panels: StackPanel[];
  storageKey: string;
}): ReactElement {
  const mins = panels.map((p) => p.minHeight);
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
      if (h > 0) apply(fit(sizesRef.current, mins, h));
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => ro.disconnect();
    // mins is derived from props each render but stable in practice for the sidebar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, panels.length]);

  const startDrag = (i: number) => (e: ReactPointerEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
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
      try {
        localStorage.setItem(storageKey, JSON.stringify(sizesRef.current));
      } catch {
        /* ignore */
      }
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
            style={{ height: `${sizes[i]}px`, flex: '0 0 auto' }}
          >
            {p.render()}
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
