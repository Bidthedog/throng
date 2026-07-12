/**
 * Declared clearability (015, FR-016a) and its completeness guard.
 *
 * The clear affordance empties a value. Offering it on a value that cannot legitimately BE empty
 * would let the user write a document the app then has to cope with — so clearability is declared
 * on the field, never guessed from whatever the field happens to hold today.
 *
 * A declaration that nobody checks is a comment. The guard below is what stops it becoming one:
 * every field declaring `clearable` must round-trip an EMPTY value through the tolerant parser
 * and come back with the empty value intact. Note what that does and does not test — it asks
 * whether empty is *valid for this field*, not whether the field's shipped default happens to be
 * empty. The theme's font stack ships populated and is still legitimately clearable (FR-018).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_METADATA,
  auditClearable,
  emptyValueFor,
  parseAppSettings,
  setAtPath,
  getAtPath,
  type FieldDescriptor,
} from '../../src/index.js';

/** Round-trip a settings document with `key` emptied, and read the key back. */
function parseWithCleared(key: string): unknown {
  const emptied = setAtPath(DEFAULT_APP_SETTINGS, key, emptyValueFor(SETTINGS_METADATA.find((d) => d.key === key)!));
  return getAtPath(parseAppSettings(emptied), key);
}

describe('emptyValueFor', () => {
  it('empties an array field to []', () => {
    const d: FieldDescriptor = { key: 'k', label: '', description: '', group: '', control: 'array' };
    expect(emptyValueFor(d)).toEqual([]);
  });

  it('empties a multiselect to []', () => {
    const d: FieldDescriptor = { key: 'k', label: '', description: '', group: '', control: 'multiselect' };
    expect(emptyValueFor(d)).toEqual([]);
  });

  it('empties a text-shaped field to the empty string', () => {
    for (const control of ['text', 'colour', 'font-family', 'folder'] as const) {
      const d: FieldDescriptor = { key: 'k', label: '', description: '', group: '', control };
      expect(emptyValueFor(d)).toBe('');
    }
  });
});

describe('auditClearable — a clearable declaration cannot lie', () => {
  it('passes a field whose empty value survives the parser', () => {
    const registry: FieldDescriptor[] = [
      { key: 'explorer.excludeGlobs', label: '', description: '', group: '', control: 'array', clearable: true },
    ];
    expect(auditClearable(registry, (d) => parseWithCleared(d.key))).toEqual([]);
  });

  it('reports a field that declares clearable but does NOT survive being emptied', () => {
    // `appearance.theme` names the active theme. Empty it and the tolerant parser puts the
    // default theme back — the empty value does not survive, so the declaration would be a lie.
    const registry: FieldDescriptor[] = [
      { key: 'appearance.theme', label: '', description: '', group: '', control: 'text', clearable: true },
    ];
    expect(auditClearable(registry, (d) => parseWithCleared(d.key))).toEqual(['appearance.theme']);
  });

  it('ignores fields that do not declare clearable, however they behave when emptied', () => {
    const registry: FieldDescriptor[] = [
      { key: 'appearance.theme', label: '', description: '', group: '', control: 'text' },
    ];
    expect(auditClearable(registry, (d) => parseWithCleared(d.key))).toEqual([]);
  });
});

describe('the shipped settings registry', () => {
  it('declares clearable on at least one field, or the affordance ships dead', () => {
    expect(SETTINGS_METADATA.filter((d) => d.clearable).length).toBeGreaterThan(0);
  });

  it('every field it declares clearable really can be emptied', () => {
    expect(auditClearable(SETTINGS_METADATA, (d) => parseWithCleared(d.key))).toEqual([]);
  });
});
