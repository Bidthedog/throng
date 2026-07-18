/**
 * Editor metadata registry (feature 007, FR-025a).
 *
 * The single declarative source of truth the visual preference editors render
 * from: one {@link FieldDescriptor} per configurable setting leaf, keybinding
 * action, and theme token. Pure — zero OS/DOM. A completeness test
 * ({@link assertEveryKeyDescribed}) asserts every configurable key has exactly
 * one descriptor, which is the enforcement mechanism behind FR-047/FR-048.
 */

/** The control a descriptor renders as, matched to the value's type. */
export type ControlKind =
  | 'number'
  | 'text'
  | 'toggle'
  | 'select' // single choice from allowedValues
  | 'multiselect' // subset of allowedValues
  | 'array' // add/remove/reorder free entries
  | 'colour'
  | 'font-family'
  | 'font-size'
  | 'enum'
  | 'chord' // keybinding chord (edited via the capture modal)
  | 'icon' // theme icon token (pack-aware)
  | 'folder' // editable path + browse-to-pick folder (011, shared folder-picker)
  | 'map' // keyed table: key column + typed value columns (016, F5)
  /*
   * 019 / FR-018 — an ARRAY of records, each identified by a declared id field (`terminals.flavours`).
   *
   * It is a MODE of the keyed table, not a second table (FR-020): the rows are data with a declared
   * shape, exactly as `map`'s are, and the only real difference is what identifies a row and that
   * the order is the user's rather than alphabetical.
   *
   * Declared, NEVER inferred from the value. `control: 'array'` let the control type flip with the
   * data — `[].every(…)` is vacuously true, so an EMPTY `terminals.flavours` rendered as a
   * string-array control whose Add appended `''` (an empty STRING into an array of OBJECTS, which
   * the tolerant parser then dropped), and one entry later it was a JSON textarea. A control the
   * user cannot predict is a control they cannot learn.
   */
  | 'records'
  /*
   * 018 / FR-032 — a bounded numeric, edited by DRAGGING as well as typing. Sizes, delays and
   * widths are far easier to set by dragging than by typing.
   *
   * It is an EXPLICIT OPT-IN, not a property inferred from having bounds. An earlier draft rendered
   * a slider for any numeric declaring both a min and a max — which would have made this member of
   * a CLOSED vocabulary something no descriptor ever set and no code ever read (dead code, Principle
   * VIII), and would have forced an invented 2 GiB ceiling onto the maximum-file-size setting purely
   * so it could take a slider it should never have had: a slider from kilobytes to gigabytes moves in
   * megabyte jumps per pixel, which is a worse control than the text box it replaces.
   *
   * A descriptor declaring `slider` MUST also declare `min`, `max` and `step`.
   */
  | 'slider';

/**
 * One column of a `map` control (016). The key column is implicit; these are its VALUE columns,
 * each reusing an existing control rather than inventing a bespoke one.
 */
export interface MapColumn {
  /** Property of the entry this column edits. Omitted for a scalar-valued map (the value itself). */
  key?: string;
  label: string;
  control: ControlKind;
  allowedValues?: readonly (string | number)[];
  min?: number;
  max?: number;
}

/** One editor field: a configurable key plus how to render and constrain it. */
export interface FieldDescriptor {
  /** dotted path (settings) | ActionId (keybindings) | token (theme). Unique within a registry. */
  key: string;
  /** human-readable label (FR-027). */
  label: string;
  /** what it changes and why (FR-027). */
  description: string;
  /** labelled section the field is grouped into (FR-026/030/038). */
  group: string;
  /** the control matched to the value type (FR-028/029/038). */
  control: ControlKind;
  /** allowed set for select/multiselect/enum (FR-029). */
  allowedValues?: readonly (string | number)[];
  /** numeric/font-size constraints. */
  min?: number;
  max?: number;
  step?: number;
  /** element control for an 'array' field. */
  itemControl?: ControlKind;
  /** value columns for a 'map' field — the keyed table's shape (016, F5). */
  columns?: readonly MapColumn[];
  /**
   * What the map's KEY column is called, and what a key IS (016).
   *
   * Without this the header said "Key" and the cell showed the raw internal id — so the per-language
   * indentation table read `csharp`, `cpp`, `powershell`, which are not what those languages are
   * called. Worse, adding a row meant TYPING one of those ids from memory, with a free-text box that
   * accepted anything and silently kept whatever you typed.
   */
  keyLabel?: string;
  /** `language` renders keys by their display name and offers a picker; `text` is free entry. */
  keyKind?: 'language' | 'text';
  /**
   * `records` only — the property that IDENTIFIES a row (019, FR-018).
   *
   * Immutable once created (C13): a flavour id keys `terminals.defaultParams`, so renaming it in
   * place would silently orphan the parameters keyed to it. To rename, delete and re-add.
   */
  idKey?: string;
  /**
   * `records` only — what one row IS ('flavour'). It labels the affordances and names the test ids.
   */
  itemNoun?: string;
  /**
   * The contexts a keybinding command is live in (016, FR-017b0). Rendered in the Key Bindings
   * editor so a user seeing `Ctrl+X` on two rows can see WHY it is not a clash — and so the
   * conflict flow can tell a real collision from a scoped coexistence.
   *
   * Keybinding descriptors only; a setting or theme token has no dispatch scope.
   */
  scope?: readonly string[];
  /**
   * Empty is a valid value for this field, so the row may offer a **clear** affordance
   * (015, FR-016a).
   *
   * Declared, never inferred: whether a value may be emptied is a property of the FIELD, not of
   * whatever it happens to hold today. A required setting must not become emptiable into an
   * invalid state merely because it is currently a string.
   *
   * The bar is that empty is *valid* — the tolerant parser accepts it and a runtime fallback
   * supplies behaviour in its absence — not that the field's shipped default is itself empty.
   * The theme's font stack ships populated and is still legitimately clearable (FR-018).
   * {@link auditClearable} holds the declaration to that bar.
   */
  clearable?: boolean;
}

export type MetadataRegistry = readonly FieldDescriptor[];

/** The empty value for a field, by control kind — what a **clear** writes (015, FR-016a). */
export function emptyValueFor(field: FieldDescriptor): unknown {
  // A map empties to an empty RECORD. Without this arm a clear writes `''` into a
  // Record<string, …>, the tolerant parser discards it as a non-record, and the clearability
  // audit — which asks whether the empty value SURVIVES a round-trip — never sees the damage
  // (016, F6).
  if (field.control === 'map') return {};
  // …and a `records` field empties to an empty ARRAY, for the same reason one control-kind over
  // (019, T036a): without this arm a clear writes `''` into an array-valued setting, the tolerant
  // parser coerces it straight back to the fallback `[]`, and `auditClearable` — which asks only
  // whether what comes back is empty — reports success while the document on disk is wrong. That
  // is the "declaration that is a lie" the audit exists to catch, sailing past the audit.
  return field.control === 'array' || field.control === 'multiselect' || field.control === 'records'
    ? []
    : '';
}

/** True when a field currently holds something a **clear** would remove (015, FR-016a). */
export function isEmptyValue(field: FieldDescriptor, value: unknown): boolean {
  if (field.control === 'map') {
    return !isPlainObject(value) || Object.keys(value).length === 0;
  }
  if (Array.isArray(value)) return value.length === 0;
  return value === '' || value === undefined || value === null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The keys of every field that **declares** itself clearable but whose empty value does not
 * survive a round-trip through the tolerant parser — i.e. every declaration that is a lie
 * (015, FR-016a).
 *
 * `roundTrip` empties the field, parses the document, and reads the field back. A field passes
 * when what comes back is still empty: that is what proves the app can actually live with the
 * value the clear affordance would write. A field whose parser quietly substitutes a default is
 * NOT clearable, however much its descriptor would like to be.
 */
export function auditClearable<T extends FieldDescriptor>(
  registry: readonly T[],
  roundTrip: (field: T) => unknown,
): string[] {
  return registry
    .filter((d) => d.clearable === true)
    .filter((d) => !isEmptyValue(d, roundTrip(d)))
    .map((d) => d.key);
}

/** True for values that terminate a dotted path: primitives, arrays, and null. */
function isLeaf(value: unknown): boolean {
  return (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  );
}

/**
 * Dotted leaf paths of a plain object. Arrays and primitives are leaves (not
 * descended into) — e.g. `explorer.excludeGlobs` and `terminals.flavours` are
 * single leaves, matching how the editors treat array-valued settings.
 */
export function leavesOf(obj: unknown, prefix = ''): string[] {
  if (isLeaf(obj)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) out.push(path);
    else out.push(...leavesOf(v, path));
  }
  return out;
}

/**
 * Dotted leaf paths, where a key a descriptor DECLARES to be a `map` is ONE leaf (016, F5).
 *
 * `leavesOf` recurses into plain objects, so a non-empty keyed map explodes into one leaf per
 * ENTRY — and the completeness rule then demands an editor descriptor for every entry the user
 * happens to have. `editor.indentByLanguage` ships non-empty, so without this the build fails.
 *
 * Map-ness is DECLARED, never inferred from the value: a map that is empty today is still a map,
 * and an ordinary settings group that is currently one key deep is still a group.
 */
export function leavesOfDeclared(
  obj: unknown,
  registry: MetadataRegistry,
  prefix = '',
): string[] {
  const maps = new Set(registry.filter((d) => d.control === 'map').map((d) => d.key));
  const walk = (value: unknown, path: string): string[] => {
    if (path && maps.has(path)) return [path];
    if (isLeaf(value)) return path ? [path] : [];
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      walk(v, path ? `${path}.${k}` : k),
    );
  };
  return walk(obj, prefix);
}

/**
 * The stylable token paths of a theme — every leaf except the `name`
 * identifier (which names the theme rather than styling it).
 */
export function tokensOf(theme: unknown): string[] {
  return leavesOf(theme).filter((k) => k !== 'name');
}

/** Read the value at a dotted `key` path within a config object (undefined if absent). */
export function getAtPath(obj: unknown, key: string): unknown {
  let cur: unknown = obj;
  for (const seg of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Immutably set the value at a dotted `key` path, returning a shallow-cloned copy
 * of `obj` along the path (siblings shared). Missing intermediate objects are
 * created. Used by the settings form to build the next document from one edit.
 */
export function setAtPath<T>(obj: T, key: string, value: unknown): T {
  const segs = key.split('.');
  const root: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  let cur = root;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = segs[i];
    const child = cur[seg];
    cur[seg] = child !== null && typeof child === 'object' && !Array.isArray(child)
      ? { ...(child as Record<string, unknown>) }
      : {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
  return root as T;
}

/** Diagnostics for a registry against the set of keys it must cover. */
export interface RegistryAudit {
  /** keys with no descriptor. */
  missing: string[];
  /** descriptor keys that are not in the configurable-key set. */
  unknown: string[];
  /** descriptor keys that appear more than once. */
  duplicated: string[];
}

/**
 * Compare a registry against the authoritative set of configurable keys. Pure;
 * returns the three defect classes so a completeness test can assert on them
 * (FR-047).
 */
export function auditRegistry(
  keys: readonly string[],
  registry: MetadataRegistry,
): RegistryAudit {
  const keySet = new Set(keys);
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const unknown: string[] = [];
  for (const d of registry) {
    if (seen.has(d.key)) duplicated.add(d.key);
    seen.add(d.key);
    if (!keySet.has(d.key)) unknown.push(d.key);
  }
  const missing = keys.filter((k) => !seen.has(k));
  return { missing, unknown, duplicated: [...duplicated] };
}

/**
 * Assert that every configurable key has exactly one descriptor and the
 * registry has no descriptor for an unknown key. Throws a diagnostic Error
 * otherwise (the FR-047/048 enforcement point).
 */
export function assertEveryKeyDescribed(
  keys: readonly string[],
  registry: MetadataRegistry,
): void {
  const { missing, unknown, duplicated } = auditRegistry(keys, registry);
  const problems: string[] = [];
  if (missing.length) problems.push(`missing descriptors for: ${missing.join(', ')}`);
  if (unknown.length) problems.push(`descriptors for unknown keys: ${unknown.join(', ')}`);
  if (duplicated.length) problems.push(`duplicate descriptors for: ${duplicated.join(', ')}`);
  if (problems.length) {
    throw new Error(`metadata registry incomplete — ${problems.join('; ')}`);
  }
}
