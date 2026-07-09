import { runFontEnumerationContract } from '@throng/core/testing';
import { WindowsFontEnumeration } from '../../src/windows-font-enumeration.js';

// Verify the Windows font enumerator against the shared IFontEnumeration contract
// (007, FR-038a): returns installed families, never throws, de-duplicated, idempotent.
runFontEnumerationContract('WindowsFontEnumeration', () => new WindowsFontEnumeration());
