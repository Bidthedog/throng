import { describe, expect, it } from 'vitest';
import {
  chordCollisions,
  COMMAND_SCOPES,
  DEFAULT_KEYBINDINGS,
  KEYBINDINGS_METADATA,
  WINDOW_HANDLED_ACTIONS,
} from '@throng/core';

describe('tabs.rename (067 FR-075, FR-076, FR-078)', () => {
  it('defaults to Ctrl+Shift+Alt+F2', () => {
    expect(DEFAULT_KEYBINDINGS.bindings['tabs.rename']).toEqual(['Ctrl+Shift+Alt+F2']);
  });
  it('is live in every scope and captured by the window, so a terminal program never sees it', () => {
    expect(COMMAND_SCOPES['tabs.rename']).toEqual(COMMAND_SCOPES['panel.destroy']);
    expect(WINDOW_HANDLED_ACTIONS.has('tabs.rename')).toBe(true);
  });
  it('is listed in the Key Bindings editor', () => {
    expect(KEYBINDINGS_METADATA.find((d) => d.key === 'tabs.rename')?.group).toBe('Tabs');
  });
  it('collides with nothing', () => {
    expect(chordCollisions(DEFAULT_KEYBINDINGS.bindings).filter((c) => c.actions?.includes('tabs.rename'))).toEqual([]);
  });
});
