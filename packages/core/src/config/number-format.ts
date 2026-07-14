/**
 * Digit grouping for the preference editors (018 / US7, FR-037/FR-038).
 *
 * The maximum-openable-file-size setting displayed as `10485760`: eight digits with no grouping,
 * which nobody reads as ten megabytes. Grouped, it is `10,485,760`.
 *
 * GROUPING IS STRICTLY A VIEW CONCERN. A grouping character must NEVER reach a stored value, a
 * settings file or a theme file — so `parseGrouped` is the exact inverse of `formatGrouped` for the
 * same locale, and the separator is derived from the locale rather than assumed to be a comma. A
 * locale that groups with `.` would otherwise turn `1.024` into either a corrupted number or a
 * rejected one, depending on which way the bug fell.
 */

/**
 * Values below this many digits are NOT grouped.
 *
 * "Large-magnitude" was left undefined by the specification, which is not a detail: grouping
 * everything renders a 5000-millisecond delay as `5,000` and a 1024-byte minimum as `1,024`, and
 * both read as a typo rather than a kindness. Five digits is where a number stops being scannable.
 */
const GROUP_FROM_DIGITS = 5;

/** The characters this locale uses to group, so the parser can undo exactly what the formatter did. */
function separatorsFor(locale?: string): string[] {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567);
  const group = parts.find((p) => p.type === 'group')?.value;
  // Some locales group with a narrow no-break space; strip both it and the plain one.
  return group ? [group, ' ', ' '] : [' ', ' '];
}

/** Render a number for DISPLAY. Values under the threshold are returned bare. */
export function formatGrouped(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return '';
  const digits = Math.abs(Math.trunc(value)).toString().length;
  if (digits < GROUP_FROM_DIGITS) return String(value);
  return new Intl.NumberFormat(locale, { useGrouping: true, maximumFractionDigits: 20 }).format(
    value,
  );
}

/**
 * Parse a displayed number back to a plain one — the exact inverse of `formatGrouped`.
 *
 * Returns `null` for anything that is not a number, which is what lets the control reject it and
 * leave the last valid value standing.
 */
export function parseGrouped(text: string, locale?: string): number | null {
  let cleaned = text.trim();
  if (cleaned === '') return null;

  for (const sep of separatorsFor(locale)) {
    cleaned = cleaned.split(sep).join('');
  }

  // A locale whose DECIMAL mark is a comma would have survived the strip above; normalise it so the
  // number parser sees what it expects. (Every value the editors hold is an integer today, but a
  // parser that silently mangles a decimal is a trap laid for the next setting that is not.)
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal');
  if (decimal && decimal.value !== '.') cleaned = cleaned.replace(decimal.value, '.');

  if (!/^[+-]?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
