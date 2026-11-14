import { describe, expect, it } from 'vitest';
import { preferencesQuery } from '../../src/main/preferences-window.js';

/**
 * 068 contracts/ipc.md "Preferences deep link" — main passes `prefs=<tab>&section=<name>` to the
 * Preferences window it opens. Layer: unit — a pure function of the seam query, the tab and the section;
 * the window itself (and the in-place reuse of an open one) is Electron's.
 */
describe('preferencesQuery', () => {
  it('names the tab, and no section when none was asked for', () => {
    expect(preferencesQuery(undefined, 'settings')).toEqual({ prefs: 'settings' });
  });

  it('adds the section when one is named', () => {
    expect(preferencesQuery(undefined, 'settings', 'Notifications')).toEqual({ prefs: 'settings', section: 'Notifications' });
  });

  it('keeps the test seam, and the tab and section win over it', () => {
    expect(preferencesQuery({ foldDefault: 'open', prefs: 'themes', section: 'x' }, 'settings', 'Notifications')).toEqual({
      foldDefault: 'open',
      prefs: 'settings',
      section: 'Notifications',
    });
  });

  it('drops a blank section rather than sending an empty one', () => {
    expect(preferencesQuery(undefined, 'settings', '  ')).toEqual({ prefs: 'settings' });
  });
});
