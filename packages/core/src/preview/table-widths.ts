/**
 * Fair table-column widths for a rendered preview (047, data-model.md "ColumnProfile / fair widths",
 * research R13, FR-060 – FR-062). The renderer measures each column's min-content and max-content
 * (a two-pass off-screen layout, `table-layout.ts`) and hands the profiles here; this is the pure
 * arithmetic, so the "≥95% of tables fit" claim (SC-006a) is testable without a DOM.
 *
 * Max-min fair-share water-filling: every column starts at its FLOOR — `min(max, max(minLegible,
 * min))`, so a narrow column is never padded past its own content and a wide one never drawn below
 * legible — then the remaining available width is handed out in passes. Each pass computes an equal
 * share for the columns still wanting more; a column whose remaining room to its own max-content is
 * at or below that share is given exactly that room (it is SATISFIED — it will never be asked to grow
 * past what its content needs) and its column drops out of the next pass, freeing its unused share to
 * the columns still in it. The loop repeats until nothing changes, then splits whatever remains evenly
 * over the columns still active. A column is never widened past its own max-content, so if every
 * column's max-content already fits `available`, each simply gets its max and the sum may be less than
 * `available` — this is not a defect: FR-060 asks for "no wider than the panel", not "exactly as wide".
 *
 * `overflow` is set — and every column held at its floor rather than shrunk further — when the floors
 * alone exceed `available` (FR-062): the table cannot fit, so it keeps its minimums and the renderer
 * lets it scroll horizontally instead of crushing a column unreadable.
 *
 * Pure: no DOM, no units beyond "the caller's px".
 */

export interface ColumnProfile {
  /** Measured min-content width. */
  min: number;
  /** Measured max-content width. */
  max: number;
}

export interface FairColumnWidthsResult {
  widths: number[];
  overflow: boolean;
}

/** A column's floor: never below `minLegible`, but never padded past its own max-content either. */
function floorOf(col: ColumnProfile, minLegible: number): number {
  return Math.min(col.max, Math.max(minLegible, col.min));
}

export function fairColumnWidths(
  available: number,
  cols: readonly ColumnProfile[],
  minLegible: number,
): FairColumnWidthsResult {
  const floors = cols.map((c) => floorOf(c, minLegible));
  const sumFloors = floors.reduce((a, b) => a + b, 0);
  if (sumFloors > available) return { widths: floors, overflow: true };

  const widths = [...floors];
  let remaining = available - sumFloors;
  let active = cols.map((_, i) => i);

  while (remaining > 0 && active.length > 0) {
    const share = remaining / active.length;
    const stillActive: number[] = [];
    let satisfiedAny = false;

    for (const i of active) {
      const room = cols[i]!.max - widths[i]!;
      if (room <= share) {
        widths[i] = cols[i]!.max;
        remaining -= room;
        satisfiedAny = true;
      } else {
        stillActive.push(i);
      }
    }

    active = stillActive;
    // No column was satisfied this pass: the current (equal) share is what every remaining column
    // gets, in full, and none of it is redistributable further.
    if (!satisfiedAny) {
      const evenShare = remaining / active.length;
      for (const i of active) widths[i] = widths[i]! + evenShare;
      remaining = 0;
    }
  }

  return { widths, overflow: false };
}
