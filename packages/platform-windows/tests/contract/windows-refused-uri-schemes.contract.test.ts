import { describe, expect, it } from 'vitest';
import { runRefusedUriSchemesContract } from '@throng/core/testing';
import { WindowsRefusedUriSchemes } from '@throng/platform-windows';

/**
 * 045 FR-159 — `contracts/platform-ports.md` §7.1 (tenth analysis pass), research R27.
 *
 * The shared suite proves the shape. These cases pin the Windows CONTENT: every entry of R27's list,
 * one assertion each, so dropping any of them from the implementation fails a test by name. Each of
 * these is a scheme whose registered handler can be made to run something from a link — which is why
 * no allowlist may make it one.
 */
describe('WindowsRefusedUriSchemes', () => {
  it('satisfies the shared IRefusedUriSchemes contract', () => {
    expect(() => runRefusedUriSchemesContract(() => new WindowsRefusedUriSchemes())).not.toThrow();
  });

  const refused = new WindowsRefusedUriSchemes().refusedSchemes();
  for (const scheme of ['ms-msdt', 'search-ms', 'search', 'ms-officecmd', 'ms-appinstaller', 'ms-cxh', 'ms-cxh-full']) {
    it(`refuses ${scheme}`, () => {
      expect(refused.has(scheme)).toBe(true);
    });
  }

  it('leaves the OS-neutral half to core, and never refuses what FR-159 ships on the allowlist', () => {
    for (const scheme of ['mailto', 'tel', 'slack', 'http', 'https', 'file']) {
      expect(refused.has(scheme), scheme).toBe(false);
    }
  });
});
