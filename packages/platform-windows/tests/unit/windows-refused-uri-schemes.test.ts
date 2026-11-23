import { describe, expect, it } from 'vitest';
import { WindowsRefusedUriSchemes } from '@throng/platform-windows';

/**
 * 045 FR-159 — `contracts/platform-ports.md` §7.1 (tenth analysis pass), research R27.
 *
 * The shared suite (tests/contract/windows-refused-uri-schemes.contract.test.ts) proves the shape. These cases pin the
 * Windows CONTENT: every entry of R27's list, so dropping any of them from the implementation fails this test and
 * names the scheme. Each of these is a scheme whose registered handler can be made to run something from a link — which
 * is why no allowlist may make it one.
 */
describe('WindowsRefusedUriSchemes', () => {
  const refused = new WindowsRefusedUriSchemes().refusedSchemes();

  it('refuses every scheme on R27\'s list', () => {
    const list = ['ms-msdt', 'search-ms', 'search', 'ms-officecmd', 'ms-appinstaller', 'ms-cxh', 'ms-cxh-full'];
    expect(list.filter((scheme) => !refused.has(scheme))).toEqual([]);
  });

  it('leaves the OS-neutral half to core, and never refuses what FR-159 ships on the allowlist', () => {
    for (const scheme of ['mailto', 'tel', 'slack', 'http', 'https', 'file']) {
      expect(refused.has(scheme), scheme).toBe(false);
    }
  });
});
