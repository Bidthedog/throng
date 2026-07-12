/**
 * Hardening of feature 010's reset functions (015).
 *
 * `contracts/reset-ipc.md` promises that an action or leaf absent from the shipped record is
 * refused and NOTHING is written. The IPC handlers accept an arbitrary string, and plain
 * bracket access resolves keys inherited from `Object.prototype` — so without an own-property
 * guard, `__proto__` and friends look like real configuration with real defaults (and worse:
 * `constructor` resolves to a function, which then throws deep inside the write path).
 */
import { describe, expect, it } from 'vitest';
import {
  buildShippedDefaults,
  resetBindingValue,
  resetSettingValue,
} from '../../src/config/shipped-defaults.js';

describe('reset refuses inherited prototype keys', () => {
  const shipped = buildShippedDefaults();
  const attacks = ['__proto__', 'constructor', 'toString', 'editor.constructor'];

  it('resetSettingValue refuses them and writes nothing', () => {
    for (const path of attacks) {
      expect(resetSettingValue(shipped.settings, path, shipped), path).toBeNull();
    }
  });

  it('resetBindingValue refuses them and writes nothing', () => {
    for (const action of attacks) {
      expect(resetBindingValue(shipped.keybindings, action, shipped), action).toBeNull();
    }
  });
});
