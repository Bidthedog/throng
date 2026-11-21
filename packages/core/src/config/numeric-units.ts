/**
 * 077 — one numeric setting, between the unit it is stored in and the unit it is shown in (FR-004, FR-005), its
 * bounds as a user reads them (FR-008), and what a typed value means (FR-009). Pure; no DOM.
 *
 * The slider's `min`/`max`/`step` stay in the STORED unit (research R1): a stop is always a whole byte or millisecond,
 * so a display-unit fraction (11.8 MB) can never be what reaches `settings.json`. Every quantity a user reads goes
 * through `formatGrouped` (constitution 4.5.0).
 */
import type { DisplayUnit, FieldDescriptor } from './metadata.js';
import { formatGrouped, parseGrouped } from './number-format.js';

/** MB means MiB everywhere (FR-003). */
export const BYTES_PER_MB = 1024 * 1024;

const FACTOR: Record<DisplayUnit, number> = {
  MB: BYTES_PER_MB,
  ms: 1,
  s: 1000,
  min: 60_000,
  days: 86_400_000,
  own: 1,
};

const displayOf = (d: FieldDescriptor): DisplayUnit => d.display ?? 'own';

/** Two decimal places at most, so 11.77 MB reads as a size and not as a float. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The word for the stored unit, as the box and its messages name it. */
function storedWord(d: FieldDescriptor): string {
  switch (d.storedUnit) {
    case 'bytes':
      return 'bytes';
    case 'ms':
      return 'ms';
    case 'characters':
      return 'characters';
    case 'px':
      return 'px';
    case 'percent':
      return '%';
    case 'count':
      return d.unitLabel ?? '';
    default:
      return '';
  }
}

/** Join a number and its unit: `%` sits against the number, every other unit after a space. */
function withUnit(n: number, unit: string, singular?: string): string {
  const text = formatGrouped(n);
  if (unit === '') return text;
  if (unit === '%') return `${text}%`;
  return `${text} ${n === 1 && singular !== undefined ? singular : unit}`;
}

/**
 * FR-003 — what the display unit means, where a reader could take it two ways: a size row says once, beside its
 * description, that 1 MB is 1,048,576 bytes. `null` for every other setting.
 */
export function unitNote(d: FieldDescriptor): string | null {
  return displayOf(d) === 'MB' ? `1 MB is ${formatGrouped(BYTES_PER_MB)} bytes.` : null;
}

/** The value in the unit the slider is shown in: `25 MB`, `1.5 s`, `40 characters`, `80%`. */
export function toDisplay(value: number, d: FieldDescriptor): string {
  const unit = displayOf(d);
  if (unit === 'own') return withUnit(value, storedWord(d));
  return withUnit(round2(value / FACTOR[unit]), unit, unit === 'days' ? 'day' : undefined);
}

/** What a notice or description quotes: the display value, plus the stored value where they differ (FR-014). */
export function formatSetting(value: number, d: FieldDescriptor): string {
  const unit = displayOf(d);
  if (unit === 'MB') return `${toDisplay(value, d)} (${withUnit(value, storedWord(d))})`;
  return toDisplay(value, d);
}

/** The bounds the box enforces: the declared hard bounds, else the slider range (FR-010). */
export function hardBounds(d: FieldDescriptor): { lo: number | undefined; hi: number | undefined } {
  return { lo: d.hardMin ?? d.min, hi: d.hardMax ?? d.max };
}

/** Hold a value to the hard bounds (FR-009). */
export function clampToHard(value: number, d: FieldDescriptor): number {
  const { lo, hi } = hardBounds(d);
  if (lo !== undefined && value < lo) return lo;
  if (hi !== undefined && value > hi) return hi;
  return value;
}

/** Whether `value` is one of the slider's stops (FR-007, FR-011). */
export function isStop(value: number, d: FieldDescriptor): boolean {
  if (d.min === undefined || d.max === undefined || d.step === undefined) return true;
  if (value < d.min || value > d.max) return false;
  const k = (value - d.min) / d.step;
  return Math.abs(k - Math.round(k)) < 1e-9;
}

/** The stop the slider's thumb sits on for `value`. */
export function nearestStop(value: number, d: FieldDescriptor): number {
  if (d.min === undefined || d.max === undefined || d.step === undefined) return value;
  if (value <= d.min) return d.min;
  if (value >= d.max) return d.max;
  return d.min + Math.round((value - d.min) / d.step) * d.step;
}

export type TypedCheck = { ok: true; value: number } | { ok: false; message: string; clampTo?: number };

/**
 * What the text in a numeric box means (FR-008, FR-009): a whole number within the hard bounds, or the message to show
 * while it is typed and the bound a confirm stores instead. Text that is no number has nothing to clamp to — confirming
 * it restores the stored value.
 */
export function checkTyped(text: string, d: FieldDescriptor): TypedCheck {
  return checkAgainst(parseGrouped(text), d);
}

/**
 * 077 FR-024 — what the Preferences toast says about the text in a numeric box, or `null` when it is a value the box
 * accepts. The toast stands apart from the box, so the sentence names the setting and its whole range rather than the
 * one bound that was passed: "Font size must be between 6 and 72".
 */
export function typedProblem(text: string, d: FieldDescriptor): string | null {
  const n = parseGrouped(text);
  if (n === null || !Number.isInteger(n)) return `${d.label} must be a whole number`;
  if (checkAgainst(n, d).ok) return null;
  const { lo, hi } = hardBounds(d);
  const word = storedWord(d);
  if (lo !== undefined && hi !== undefined) return `${d.label} must be between ${formatGrouped(lo)} and ${withUnit(hi, word)}`;
  return lo !== undefined ? `${d.label} must be at least ${withUnit(lo, word)}` : `${d.label} must be at most ${withUnit(hi!, word)}`;
}

function checkAgainst(n: number | null, d: FieldDescriptor): TypedCheck {
  if (n === null || !Number.isInteger(n)) return { ok: false, message: 'Not a whole number' };
  const { lo, hi } = hardBounds(d);
  const word = storedWord(d);
  if (hi !== undefined && n > hi) return { ok: false, message: `Up to ${withUnit(hi, word)}`, clampTo: hi };
  if (lo !== undefined && n < lo) return { ok: false, message: `At least ${withUnit(lo, word)}`, clampTo: lo };
  return { ok: true, value: n };
}
