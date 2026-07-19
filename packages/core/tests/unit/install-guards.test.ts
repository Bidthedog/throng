import { describe, expect, it } from 'vitest';

import { compareVersions } from '../../src/index.js';

/**
 * 020 FR-016a — an installer refuses a DOWNGRADE (an older version over a newer one). The decision
 * is `compareVersions(incoming, installed) < 0`; the NSIS installer (packages/ui/build/installer.nsh)
 * enforces it at install time.
 */
describe('downgrade detection (020 FR-016a)', () => {
  const isDowngrade = (incoming: string, installed: string) => compareVersions(incoming, installed) < 0;

  it('refuses installing an older version over a newer one', () => {
    expect(isDowngrade('1.0.0', '1.1.0')).toBe(true);
    expect(isDowngrade('1.0.0', '2.0.0')).toBe(true);
    expect(isDowngrade('1.2.3', '1.2.4')).toBe(true);
  });

  it('allows an upgrade or a reinstall of the same version', () => {
    expect(isDowngrade('1.2.0', '1.1.0')).toBe(false);
    expect(isDowngrade('2.0.0', '1.9.9')).toBe(false);
    expect(isDowngrade('1.1.0', '1.1.0')).toBe(false);
  });
});
