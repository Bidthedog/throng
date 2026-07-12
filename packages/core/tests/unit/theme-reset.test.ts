import { describe, it, expect } from 'vitest';
import { revertAll, type OnEntrySnapshot } from '../../src/config/theme-reset.js';

describe('revertAll (FR-024)', () => {
  const snapshot: OnEntrySnapshot = {
    settings: '{"appearance":{"theme":"throng"}}',
    keybindings: '{"version":1,"bindings":{}}',
    themes: { throng: '{"name":"throng"}', Matrix: '{"name":"Matrix"}' },
    activeTheme: 'throng',
  };

  it('produces a write plan restoring settings, keybindings, and every touched theme', () => {
    const plan = revertAll(snapshot);
    expect(plan).toContainEqual({ id: { kind: 'settings' }, json: snapshot.settings });
    expect(plan).toContainEqual({ id: { kind: 'keybindings' }, json: snapshot.keybindings });
    expect(plan).toContainEqual({ id: { kind: 'theme', name: 'throng' }, json: '{"name":"throng"}' });
    expect(plan).toContainEqual({ id: { kind: 'theme', name: 'Matrix' }, json: '{"name":"Matrix"}' });
    expect(plan).toHaveLength(4);
  });

  it('re-activates the on-entry theme by restoring settings (which carries appearance.theme)', () => {
    const plan = revertAll(snapshot);
    const settingsEntry = plan.find((e) => e.id.kind === 'settings');
    expect(JSON.parse(settingsEntry!.json).appearance.theme).toBe('throng');
  });
});
