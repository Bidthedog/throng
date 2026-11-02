import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, type Tab } from '@throng/core';
import { resolveScoped } from '../../src/renderer/keybindings/scope.js';

/**
 * 048 FR-037 — F2 is not a panel command. Moved from `component/panel-no-rename.test.ts` (pure key
 * resolution, nothing rendered), and the four per-kind tests are one loop over the kinds.
 */
describe('F2 is not a panel command (FR-037)', () => {
  const tab = (kind: string): Tab =>
    ({
      id: 't1',
      title: 'T',
      activePanelId: 'p1',
      root: { type: 'panel', id: 'p1', kind, title: 'P' },
    }) as unknown as Tab;

  it('with a terminal, editor, preview or find-in-files panel active nothing consumes F2, so the focused surface receives it', () => {
    for (const kind of ['terminal', 'editor', 'preview', 'findInFiles']) {
      const resolved = resolveScoped(
        DEFAULT_KEYBINDINGS,
        { key: 'F2' },
        { tabs: [tab(kind)], activeTabId: 't1' },
        { transientFocus: false, overlayOpen: false },
      );
      expect(resolved, `F2 was consumed with a ${kind} panel active`).toBeNull();
    }
  });
});
