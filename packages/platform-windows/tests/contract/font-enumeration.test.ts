import { describe } from 'vitest';
import { runFontEnumerationContract } from '@throng/core/testing';
import { WindowsFontEnumeration } from '../../src/windows-font-enumeration.js';

// Verify the Windows font enumerator against the shared IFontEnumeration contract
// (007, FR-038a): returns installed families, never throws, de-duplicated, idempotent.
// A literal describe: `vitest list` reads a file statically and rejects one with no suite of its own,
// which fails the whole listing (and td's tiers with it).
describe('WindowsFontEnumeration', () => {
  runFontEnumerationContract('WindowsFontEnumeration', () => new WindowsFontEnumeration());
});
