/** One figure column of the monitor's left list, at the width it needs. */
export interface FitColumn<Id extends string = string> {
  readonly id: Id;
  readonly width: number;
}

/** The width the name column always keeps (FR-106): it never drops. */
export const NAME_COLUMN_MIN_WIDTH = 160;

/**
 * The figure columns that fit `width` beside the name (055 FR-106). Columns drop from the right edge
 * one at a time; the Order-by column drops last. Both lists keep display order — `hidden` feeds the
 * header marker's title.
 */
export function fitColumns<Id extends string>(
  width: number,
  columns: readonly FitColumn<Id>[],
  orderBy: Id,
): { readonly visible: Id[]; readonly hidden: Id[] } {
  const room = width - NAME_COLUMN_MIN_WIDTH;
  const shown = [...columns];
  let used = shown.reduce((sum, c) => sum + c.width, 0);
  while (used > room && shown.length > 0) {
    let drop = shown.length - 1;
    while (drop > 0 && shown[drop]!.id === orderBy) drop -= 1;
    if (shown[drop]!.id === orderBy) drop = shown.length - 1;
    used -= shown[drop]!.width;
    shown.splice(drop, 1);
  }
  const visible = new Set(shown.map((c) => c.id));
  return {
    visible: shown.map((c) => c.id),
    hidden: columns.filter((c) => !visible.has(c.id)).map((c) => c.id),
  };
}
