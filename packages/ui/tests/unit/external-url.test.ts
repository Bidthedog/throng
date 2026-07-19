import { describe, expect, it } from 'vitest';

import { isSafeExternalUrl } from '../../src/main/external-url.js';

/** 020 FR-003a — the About window's openExternal accepts ONLY https, blocking injection via a
 *  crafted third-party licence/project URL. */
describe('isSafeExternalUrl (020 FR-003a)', () => {
  it('accepts https URLs', () => {
    expect(isSafeExternalUrl('https://spdx.org/licenses/MIT.html')).toBe(true);
    expect(isSafeExternalUrl('HTTPS://github.com/owner/repo')).toBe(true);
  });

  it('rejects every non-https scheme and non-string input', () => {
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.com',
      ' https://leading-space.com',
      '',
      undefined,
      null,
      42,
      { href: 'https://x' },
    ]) {
      expect(isSafeExternalUrl(bad as unknown)).toBe(false);
    }
  });
});
