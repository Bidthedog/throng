import { describe, expect, it } from 'vitest';

import { isSafeExternalUrl } from '../../src/main/external-url.js';

/** 020 FR-003a + 024 US7 (FR-019): openExternal accepts http AND https (024 widened it from
 *  https-only so terminal links open the system browser), while still blocking injection via a
 *  crafted URL — javascript:/file:/data:/ftp: and non-strings are rejected. */
describe('isSafeExternalUrl (020 FR-003a / 024 US7)', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeExternalUrl('https://spdx.org/licenses/MIT.html')).toBe(true);
    expect(isSafeExternalUrl('HTTPS://github.com/owner/repo')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true); // 024: now accepted
    expect(isSafeExternalUrl('HTTP://Example.com/path?q=1')).toBe(true);
  });

  it('rejects every non-http(s) scheme and non-string input (the injection guard)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'data:text/html,<script>alert(1)</script>',
      'ftp://example.com',
      'mailto:a@b.com',
      ' https://leading-space.com',
      'httpx://example.com',
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
