import { describe, expect, it } from 'vitest';
import { runRefusedUriSchemesContract } from '@throng/core/testing';
import { WindowsRefusedUriSchemes } from '@throng/platform-windows';

/**
 * 045 FR-159 — `contracts/platform-ports.md` §7.1: the shared IRefusedUriSchemes contract. The Windows content of the
 * list (R27) is pinned at unit, in tests/unit/windows-refused-uri-schemes.test.ts.
 */
describe('WindowsRefusedUriSchemes', () => {
  it('satisfies the shared IRefusedUriSchemes contract', () => {
    expect(() => runRefusedUriSchemesContract(() => new WindowsRefusedUriSchemes())).not.toThrow();
  });
});
