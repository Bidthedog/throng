/**
 * A grid's place belongs to the file (073 FR-008d): its selection and scroll are kept PER FILE while a panel is moved
 * between files, by an open that reuses it or by Back / Forward.
 *
 * A panel's body stays mounted when the panel navigates, so without this the selection simply carries over to the file
 * arriving, which is a selection nobody made there. On a navigation the place being left is remembered against its
 * file, and the arriving file gets its own back, or A1 and the top on a first visit. A re-point of the same document
 * (a Save As changes the path but not the navigation) is not a move and keeps the place.
 *
 * Session only, deliberately: the places live in this hook's ref for the life of the body. They are not handed to the
 * chrome's view-state capture, because that is stored on the panel's history entries, which persist (FR-008d).
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { DataGridHandle } from './data-grid.js';
import { single, type GridSelection } from './grid-selection.js';

interface Place {
  sel: GridSelection;
  scroll: { top: number; left: number };
}

/** A first visit: A1, from the top. */
const ORIGIN: Place = { sel: single(0, 0), scroll: { top: 0, left: 0 } };

/**
 * @param fileKey      What names the file the grid shows (its path).
 * @param navigationSeq main's count of navigations of this panel; absent reads as no navigation ever.
 * @param ready        Whether the content on screen is now the arriving file's. The place is applied once it is, so the
 *                     selection and scroll land on the file's own rows rather than on the previous file's.
 */
export function useFilePlaces(
  gridRef: RefObject<DataGridHandle | null>,
  fileKey: string,
  navigationSeq: number | undefined,
  ready: boolean,
): void {
  const places = useRef(new Map<string, Place>());
  const last = useRef({ fileKey, seq: navigationSeq });
  const pending = useRef<Place | null>(null);

  // Runs in the render that brings the new file: the grid still holds the place being left.
  useLayoutEffect(() => {
    const prev = last.current;
    if (prev.fileKey !== fileKey && navigationSeq !== prev.seq) {
      const grid = gridRef.current;
      if (grid !== null) places.current.set(prev.fileKey, { sel: grid.getSelection(), scroll: grid.getScroll() });
      pending.current = places.current.get(fileKey) ?? ORIGIN;
    }
    last.current = { fileKey, seq: navigationSeq };
  }, [fileKey, navigationSeq, gridRef]);

  // Every render, cheaply: applies once, the first time the arriving file's content is on screen.
  useEffect(() => {
    const place = pending.current;
    const grid = gridRef.current;
    if (place === null || !ready || grid === null) return;
    pending.current = null;
    grid.setSelection(place.sel);
    grid.setScroll(place.scroll);
  });
}
