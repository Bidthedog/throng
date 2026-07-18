/**
 * One user-defined flavour row, validated where the user can still fix it (019, US4/#67 — FR-019).
 *
 * Pure — zero OS, zero DOM. The settings editor is the first place that knows a flavour is broken
 * and the only place that can say so while the user is still looking at it; everything downstream
 * can only fail quietly. Two of the three rules are about the ID, because the id is not a label:
 * it keys the Flavour dropdown AND `terminals.defaultParams`.
 */
import type { TerminalFlavourConfig } from '../config/app-settings.js';

/** Which field a problem belongs to, and what to tell the user about it. */
export interface FlavourProblem {
  /** The field at fault. The editor blocks an `id` problem; a `file` problem it can only report. */
  field: 'id' | 'file';
  message: string;
}

/**
 * The one rule set, in the shape the editor needs to ACT on.
 *
 * {@link validateFlavourRecord} is this function reported as a message — one rule, two shapes, so
 * the control that has to decide whether a row can exist at all and the control that only has to
 * say what is wrong are never reading two different rule sets.
 */
export function checkFlavourRecord(
  record: Partial<TerminalFlavourConfig>,
  existingIds: readonly string[],
): FlavourProblem | null {
  const id = (record.id ?? '').trim();
  if (id.length === 0) {
    return { field: 'id', message: 'An id is required — it names the flavour in the dropdown.' };
  }
  if (existingIds.includes(id)) {
    return { field: 'id', message: `“${id}” is already used by another flavour.` };
  }
  // C12 — an executable means NON-EMPTY, not present-on-this-machine. A settings file travels
  // between machines, and a flavour may name a path that is not installed here yet; launch already
  // reports "not available on this machine", which is the only place that can check it honestly.
  if ((record.file ?? '').trim().length === 0) {
    return { field: 'file', message: 'An executable is required — the flavour cannot start without one.' };
  }
  return null;
}

/**
 * What is wrong with this flavour row, as a MESSAGE — or `null` when nothing is.
 *
 * A message rather than a boolean, because "invalid" with no reason is a dead end for a user who
 * cannot see what the rule is (the idiom `validateKey` established for the keyed map, 016).
 */
export function validateFlavourRecord(
  record: Partial<TerminalFlavourConfig>,
  existingIds: readonly string[],
): string | null {
  return checkFlavourRecord(record, existingIds)?.message ?? null;
}
