import { describe, expect, it } from 'vitest';

import { windowTitle } from '../../src/renderer/common/window-title.js';

/**
 * US9 / FR-033/034 — every window title is composed through {@link windowTitle},
 * which appends the SUFFIX ` — throng` (em dash, U+2014). This replaces the old
 * PREFIX form `throng — <x>`, so the brand always sits LAST and the identity the
 * user cares about reads first.
 */
describe('windowTitle', () => {
  it('appends " — throng" to the middle', () => {
    expect(windowTitle('Preferences')).toBe('Preferences — throng');
  });

  it('always ends with " — throng"', () => {
    for (const middle of ['Preferences', 'No project', 'MyProj · Tab 1 · Panel 1', '']) {
      expect(windowTitle(middle).endsWith(' — throng')).toBe(true);
    }
  });

  it('folds the [ADMIN] marker into the middle, BEFORE the suffix (elevated form)', () => {
    // CI runs elevated and FR-033 makes the spacing load-bearing: a single space each side of
    // [ADMIN], and the ` — throng` suffix last.
    expect(windowTitle('MyProj · editor [ADMIN]')).toBe('MyProj · editor [ADMIN] — throng');
    expect(windowTitle('MyProj · editor [ADMIN]').endsWith(' — throng')).toBe(true);
  });

  it('uses the em dash (U+2014), not a hyphen', () => {
    expect(windowTitle('X')).toContain('—');
    expect(windowTitle('X')).toBe('X — throng');
  });
});
