import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

function readStored(key: string | undefined, min: number, max: number): number | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  } catch {
    return null;
  }
}

/**
 * A draggable size value clamped to [min, max], optionally persisted to
 * localStorage (FR-033). `start` is attached to a resize handle's onPointerDown;
 * dragging updates the value along the given axis.
 */
export function useResize(opts: {
  initial: number;
  min: number;
  max: number;
  axis: 'x' | 'y';
  storageKey?: string;
  /** Invert the drag direction (e.g. a handle on a pane's left/leading edge). */
  invert?: boolean;
}): {
  value: number;
  start: (e: ReactPointerEvent) => void;
  dragging: boolean;
  /** Programmatically set the value (clamped to [min, max] and persisted). */
  set: (next: number) => void;
  min: number;
  max: number;
} {
  const { initial, min, max, axis, storageKey, invert } = opts;
  const [value, setValue] = useState<number>(() => readStored(storageKey, min, max) ?? initial);
  const [dragging, setDragging] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {
      /* storage unavailable — keep the in-memory value */
    }
  }, [value, storageKey]);

  const start = (e: ReactPointerEvent): void => {
    e.preventDefault();
    const startPos = axis === 'x' ? e.clientX : e.clientY;
    const startValue = valueRef.current;
    setDragging(true);
    // Capture the pointer + suppress selection so the drag is smooth and the
    // handle doesn't flicker between hover/non-hover as bounds shift under it.
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';

    const onMove = (ev: PointerEvent): void => {
      const pos = axis === 'x' ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) * (invert ? -1 : 1);
      setValue(Math.max(min, Math.min(startValue + delta, max)));
    };
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture?.(ev.pointerId);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const set = useCallback(
    (next: number): void => {
      setValue(Math.max(min, Math.min(next, max)));
    },
    [min, max],
  );

  return { value, start, dragging, set, min, max };
}
