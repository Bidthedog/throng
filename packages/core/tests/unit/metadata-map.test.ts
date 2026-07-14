/**
 * The `map` control kind (016, F5 — the change that stops the build failing).
 *
 * `leavesOf` recurses into plain objects, so a NON-EMPTY keyed map explodes into one leaf per
 * ENTRY — and the configuration-editor completeness test then demands a descriptor for every
 * entry a user happens to have. `editor.indentByLanguage` ships non-empty, so without this the
 * build fails on day one.
 *
 * Map-ness is DECLARED (`control: 'map'`), never inferred from the value: a map that happens to
 * be empty today is still a map, and a settings object is still an object.
 */
import { describe, expect, it } from 'vitest';
import {
  emptyValueFor,
  leavesOfDeclared,
  leavesOf,
  type FieldDescriptor,
} from '../../src/config/metadata.js';

const mapField = (key: string): FieldDescriptor => ({
  key,
  label: 'Map',
  description: 'A keyed map.',
  group: 'Editor',
  control: 'map',
  columns: [{ key: 'value', label: 'Value', control: 'text' }],
});

const settings = {
  editor: {
    fontSize: 14,
    indentByLanguage: {
      go: { style: 'tabs', indentWidth: 4, tabWidth: 4 },
      python: { style: 'spaces', indentWidth: 4, tabWidth: 4 },
    },
  },
};

describe('leavesOfDeclared stops at a declared map (F5)', () => {
  it('treats a NON-EMPTY map as ONE leaf, not one leaf per entry', () => {
    const leaves = leavesOfDeclared(settings, [mapField('editor.indentByLanguage')]);
    expect(leaves).toContain('editor.indentByLanguage');
    expect(leaves).toContain('editor.fontSize');
    // The failure this prevents: `editor.indentByLanguage.go.style` and friends becoming
    // configurable keys that each demand their own descriptor.
    expect(leaves.filter((l) => l.startsWith('editor.indentByLanguage.'))).toEqual([]);
    expect(leaves).toHaveLength(2);
  });

  it('treats an EMPTY map as one leaf too — map-ness is declared, not inferred from the value', () => {
    const leaves = leavesOfDeclared({ editor: { languageByExtension: {} } }, [
      mapField('editor.languageByExtension'),
    ]);
    expect(leaves).toEqual(['editor.languageByExtension']);
  });

  it('still descends into an ordinary nested object that no descriptor calls a map', () => {
    const leaves = leavesOfDeclared(settings, []);
    expect(leaves).toContain('editor.indentByLanguage.go.style');
  });

  it('leaves the raw leavesOf untouched — it is the map-BLIND primitive leavesOfDeclared builds on', () => {
    // Kept deliberately: theme tokens and other callers still want the exploding behaviour.
    expect(leavesOf(settings)).toContain('editor.indentByLanguage.go.style');
  });
});

describe('emptyValueFor a map (F6)', () => {
  it('is an empty RECORD, not an empty string', () => {
    // The bug this prevents: a clear writing `''` into a Record<string, IndentProfile>, which the
    // tolerant parser then discards — leaving the audit unable to see anything went wrong.
    expect(emptyValueFor(mapField('editor.languageByExtension'))).toEqual({});
  });

  it('still empties an array to [] and a text field to the empty string', () => {
    expect(emptyValueFor({ ...mapField('x'), control: 'array' })).toEqual([]);
    expect(emptyValueFor({ ...mapField('x'), control: 'text' })).toBe('');
  });
});
