/**
 * Contract suite for any {@link IFontEnumeration} implementation (Principle V,
 * feature 007). Every impl MUST return a de-duplicated string array of usable
 * family names, never throw, and be side-effect-free/idempotent.
 */
import { describe, it, expect } from 'vitest';
import type { IFontEnumeration } from '../abstractions/font-enumeration.js';

export function runFontEnumerationContract(name: string, make: () => IFontEnumeration): void {
  describe(`${name} — IFontEnumeration contract`, () => {
    it('returns a string array and never throws', async () => {
      const families = await make().listInstalledFamilies();
      expect(Array.isArray(families)).toBe(true);
      for (const f of families) expect(typeof f).toBe('string');
    });

    it('contains no empty strings and is de-duplicated', async () => {
      const families = await make().listInstalledFamilies();
      expect(families.every((f) => f.length > 0)).toBe(true);
      expect(new Set(families).size).toBe(families.length);
    });

    it('is idempotent — repeated calls return equivalent results', async () => {
      const impl = make();
      const a = await impl.listInstalledFamilies();
      const b = await impl.listInstalledFamilies();
      expect(b).toEqual(a);
    });
  });
}
