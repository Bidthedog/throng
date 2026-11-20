/**
 * Go to Row for a grid body (073 FR-043a): the shared Go to dialog (FR-043b) opened over a `DataGrid`.
 *
 * Both grid bodies (the CSV Preview Editor and the workbook sheet) use this one hook. It hands the panel its opener
 * through `registerGoTo`, so `preview.goToHeading` (Ctrl+G) opens the dialog for rows while the chrome names no
 * provider (044 FR-070); the "Go to Row…" menu items call `open`. The dialog names the active cell's row and the
 * row count as the row header numbers them; Enter moves the active cell to that row in the active column, scrolls
 * the row to the top, and focus goes back to the grid.
 */
import { useCallback, useEffect, useState, type ReactElement, type RefObject } from 'react';
import { GoToDialog } from '../navigate/go-to-dialog.js';
import type { DataGridHandle } from './data-grid.js';

export interface GridGoTo {
  /** Opens the dialog over the grid's current active row. A no-op when there are no rows. */
  open(): void;
  /** The dialog while it is open, else `null`; render it anywhere inside the body. */
  dialog: ReactElement | null;
}

export function useGridGoTo(
  panelId: string,
  gridRef: RefObject<DataGridHandle | null>,
  rowCount: number,
  registerGoTo: ((open: (() => void) | null) => void) | undefined,
): GridGoTo {
  // The row the active cell is on when the dialog opened, 1-based as the row header numbers it.
  const [current, setCurrent] = useState<number | null>(null);

  const open = useCallback((): void => {
    if (rowCount < 1) return;
    const active = gridRef.current?.getSelection().active.row ?? 0;
    setCurrent(Math.min(rowCount, Math.max(0, active)) + 1);
  }, [gridRef, rowCount]);

  useEffect(() => {
    if (registerGoTo === undefined) return;
    registerGoTo(open);
    return () => registerGoTo(null);
  }, [open, registerGoTo]);

  const dialog =
    current === null ? null : (
      <GoToDialog
        unit="Row"
        current={current}
        count={rowCount}
        onGo={(row) => gridRef.current?.goToRow(row - 1)}
        onDismiss={() => setCurrent(null)}
        returnFocus={() => gridRef.current?.focus()}
        testIdPrefix={`grid-goto-${panelId}`}
      />
    );
  return { open, dialog };
}
