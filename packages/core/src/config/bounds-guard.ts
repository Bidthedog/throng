/**
 * The generic bounds guard (031, #227). Pure — no OS, no DOM, no filesystem.
 *
 * Every bounded setting already declared its range in ONE place, on its {@link FieldDescriptor}.
 * Until now that declaration was enforced only by the Settings form, so a value typed straight into
 * `settings.json` was read back verbatim: a pane wider than the window, a poll interval that pegs a
 * core, a diagnostics cap that defeats the rotation it exists to drive.
 *
 * This is the one mechanism that enforces those declarations on read. It is driven by the REGISTRY
 * rather than by the settings object, which is what makes a newly added bounded setting guarded
 * because it declared a bound — not because somebody remembered it.
 *
 * Three things it deliberately does NOT do:
 *
 *  - It never throws. A malformed settings file must not stop the application starting, so every
 *    unreadable value falls back to its shipped default.
 *  - It never treats ABSENCE as malformation. A table the user deliberately emptied stays empty
 *    where empty is a legitimate value; only a present-and-broken entry is touched.
 *  - It does not write anything. It REPORTS whether it changed something, and the caller decides —
 *    which is what lets a clean file be left alone instead of rewritten on every start.
 */
import type { FieldDescriptor, MapColumn, MetadataRegistry } from './metadata.js';

/** One thing the guard changed, and what it changed it from. */
export interface Correction {
  /** Dotted path, e.g. `panes.projects.maxWidth`, or `editor.indentByLanguage.python.indentWidth`. */
  path: string;
  kind: 'clamped-min' | 'clamped-max' | 'default-substituted' | 'entry-restored' | 'entry-dropped';
  from: unknown;
  to: unknown;
}

export interface CorrectionOutcome<T> {
  /** The corrected document. Always usable. */
  value: T;
  /** True iff at least one correction was recorded. Drives write-back; its falsity prevents churn. */
  corrected: boolean;
  corrections: Correction[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readPath(root: unknown, path: string): unknown {
  let cur = root;
  for (const key of path.split('.')) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function writePath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop()!;
  let cur: Record<string, unknown> = root;
  for (const key of parts) {
    const next = cur[key];
    if (!isRecord(next)) return; // the shape is not there to write into; leave it alone
    cur = next;
  }
  cur[last] = value;
}

/** The bound the guard enforces, which is the control's range unless a hard bound says otherwise. */
function bounds(d: { min?: number; max?: number; hardMin?: number; hardMax?: number }): {
  lo?: number;
  hi?: number;
} {
  return { lo: d.hardMin ?? d.min, hi: d.hardMax ?? d.max };
}

/** Correct one scalar against a declaration, recording anything it had to change. */
function correctScalar(
  raw: unknown,
  decl: { min?: number; max?: number; hardMin?: number; hardMax?: number; allowedValues?: readonly (string | number)[] },
  fallback: unknown,
  path: string,
  out: Correction[],
): unknown {
  const { lo, hi } = bounds(decl);
  const isBounded = typeof lo === 'number' || typeof hi === 'number';

  /*
   * ABSENCE IS NOT MALFORMATION — the rule this module opens by stating, and which it used to
   * break here.
   *
   * A key that is simply missing is `parseAppSettings`' business: it merges the default in, as it
   * always has. Reporting it as a CORRECTION made `corrected` true for any document that was not
   * already complete — which is every settings.json written before a release that adds a setting.
   * Since the write-back then persists `parseAppSettings(value)`, and that drops every key it does
   * not model, the first launch after an upgrade rewrote EVERY user's file in full and silently
   * deleted anything hand-added. A guard whose whole purpose is to leave a valid file alone was
   * rewriting all of them.
   */
  if (raw === undefined) return fallback;

  if (isBounded) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      out.push({ path, kind: 'default-substituted', from: raw, to: fallback });
      return fallback;
    }
    if (typeof lo === 'number' && raw < lo) {
      out.push({ path, kind: 'clamped-min', from: raw, to: lo });
      return lo;
    }
    if (typeof hi === 'number' && raw > hi) {
      out.push({ path, kind: 'clamped-max', from: raw, to: hi });
      return hi;
    }
    return raw;
  }

  /*
   * An `allowedValues` set is enforced only when one is DECLARED.
   *
   * `editor.languageByExtension`'s only column is `{ label: 'Language', control: 'select' }` — a
   * select with no declared set, because its valid values are the languages known at runtime rather
   * than a static list. Treating "no set" as "empty set" would find every user mapping outside it
   * and replace it with the default, wiping the very table that absence-is-not-malformation exists
   * to protect.
   */
  if (decl.allowedValues && decl.allowedValues.length > 0) {
    if (raw === undefined || !decl.allowedValues.includes(raw as string | number)) {
      out.push({ path, kind: 'default-substituted', from: raw, to: fallback });
      return fallback;
    }
    return raw;
  }

  if (typeof fallback === 'boolean' && typeof raw !== 'boolean') {
    out.push({ path, kind: 'default-substituted', from: raw, to: fallback });
    return fallback;
  }

  return raw;
}

/** Correct a keyed table (`map`) or a record list (`records`) entry by entry. */
function correctTable(
  raw: unknown,
  d: FieldDescriptor,
  fallback: unknown,
  out: Correction[],
): unknown {
  const columns = d.columns ?? [];
  if (columns.length === 0) return raw;
  if (!isRecord(raw)) return raw; // not a shape this guard understands; leave it to the parser

  const shipped = isRecord(fallback) ? fallback : {};
  const result: Record<string, unknown> = {};

  for (const [entryKey, entryValue] of Object.entries(raw)) {
    const path = `${d.key}.${entryKey}`;
    const shippedEntry = shipped[entryKey];

    // A scalar-valued table: one column with no `key` addresses the entry's value itself.
    const scalarColumn = columns.length === 1 && columns[0].key === undefined ? columns[0] : null;
    if (scalarColumn) {
      result[entryKey] = correctScalar(entryValue, scalarColumn, shippedEntry ?? entryValue, path, out);
      continue;
    }

    if (!isRecord(entryValue)) {
      // Present but unreadable. Restore it from the shipped default for THIS key if one exists;
      // otherwise it was the user's own entry and there is nothing to restore it to.
      if (shippedEntry !== undefined) {
        out.push({ path, kind: 'entry-restored', from: entryValue, to: shippedEntry });
        result[entryKey] = structuredClone(shippedEntry);
      } else {
        out.push({ path, kind: 'entry-dropped', from: entryValue, to: undefined });
      }
      continue;
    }

    const corrected: Record<string, unknown> = { ...entryValue };
    for (const col of columns as MapColumn[]) {
      if (!col.key) continue;
      const shippedCell = isRecord(shippedEntry) ? shippedEntry[col.key] : undefined;
      corrected[col.key] = correctScalar(
        entryValue[col.key],
        col,
        shippedCell ?? entryValue[col.key],
        `${path}.${col.key}`,
        out,
      );
    }
    result[entryKey] = corrected;
  }

  return result;
}

/**
 * Correct `raw` against every bound the registry declares.
 *
 * Walks the DESCRIPTORS, never the document, so a cyclic or hostile input cannot send it round in
 * circles and an unknown key is simply not its business.
 */
export function applyDeclaredBounds<T>(
  raw: unknown,
  registry: MetadataRegistry,
  defaults: T,
): CorrectionOutcome<T> {
  const corrections: Correction[] = [];

  /*
   * A document that is not an object at all — `[]`, `"x"`, `null`, a number.
   *
   * Returns the defaults to run on, but reports NO correction, for two reasons. G8 says `corrected`
   * is true iff a Correction was recorded, and this path recorded none. And the store writes back on
   * `corrected`, so claiming one here meant a settings.json containing valid-but-wrong JSON was
   * REPLACED with shipped defaults — while an *unparseable* file was preserved untouched. A stray
   * bracket destroyed your settings and a stray brace did not, which is the reverse of the store's
   * own stated contract.
   *
   * Losing a file this broken is still a decision for the store, not for the guard.
   */
  if (!isRecord(raw)) {
    return { value: structuredClone(defaults), corrected: false, corrections: [] };
  }

  const value = structuredClone(raw) as Record<string, unknown>;

  for (const d of registry) {
    const declaresBound =
      typeof d.min === 'number' ||
      typeof d.max === 'number' ||
      typeof d.hardMin === 'number' ||
      typeof d.hardMax === 'number';
    const declaresSet = Array.isArray(d.allowedValues) && d.allowedValues.length > 0;
    const declaresColumns = (d.columns?.length ?? 0) > 0;
    if (!declaresBound && !declaresSet && !declaresColumns) continue;

    const current = readPath(value, d.key);
    const fallback = readPath(defaults, d.key);
    if (current === undefined && fallback === undefined) continue;

    if (declaresColumns) {
      const next = correctTable(current, d, fallback, corrections);
      if (next !== current) writePath(value, d.key, next);
      continue;
    }

    const next = correctScalar(current, d, fallback, d.key, corrections);
    if (next !== current) writePath(value, d.key, next);
  }

  return { value: value as T, corrected: corrections.length > 0, corrections };
}
