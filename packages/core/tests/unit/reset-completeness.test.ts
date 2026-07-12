/**
 * Resettability completeness (015, FR-008 / SC-005; constitution v3.11.0).
 *
 * The configuration-editor completeness rule already guarantees every configurable key has an
 * editor descriptor. This is its reset counterpart: every setting leaf and every key-binding
 * action the editors show MUST also be RESETTABLE — i.e. it must resolve in feature 010's
 * shipped record, because that record is the only thing a reset can return it to.
 *
 * A newly added configurable key that is not in the record fails here, which is the point: it
 * would otherwise render a row the user can change and never put back.
 */
import { describe, expect, it } from 'vitest';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { getAtPath } from '../../src/config/metadata.js';
import { buildShippedDefaults } from '../../src/config/shipped-defaults.js';
import { isBindingOverridden, isSettingOverridden } from '../../src/config/overridden.js';

const shipped = buildShippedDefaults();

describe('every configurable item the editors show is resettable', () => {
  it('every settings descriptor resolves to a shipped value', () => {
    for (const d of SETTINGS_METADATA) {
      expect(getAtPath(shipped.settings, d.key), `no shipped default for setting "${d.key}"`).not.toBe(undefined);
    }
  });

  it('every key-binding descriptor resolves to a shipped chord set', () => {
    for (const d of KEYBINDINGS_METADATA) {
      expect(
        shipped.keybindings.bindings[d.key],
        `no shipped default for action "${d.key}"`,
      ).toBeDefined();
    }
  });

  it('a pristine configuration reports NOTHING as overridden, so no reset is ever offered as a no-op', () => {
    for (const d of SETTINGS_METADATA) {
      expect(isSettingOverridden(shipped.settings, d.key, shipped), d.key).toBe(false);
    }
    for (const d of KEYBINDINGS_METADATA) {
      expect(isBindingOverridden(shipped.keybindings, d.key, shipped), d.key).toBe(false);
    }
  });
});
