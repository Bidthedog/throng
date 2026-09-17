/**
 * 044, 2026-09-16 iteration (FR-122e; plan decision 2) — a sub-workspace window reports its own failed
 * settings write.
 *
 * Until this iteration a sub-workspace window wrote no configuration at all, so it mounted no
 * write-failure subscriber (032 US3 scenario 2). The scroll-sync toggle changes that: an editor or a
 * preview in a sub-workspace window can flip the setting, and a write that fails there has to be said
 * THERE — the window the user clicked in. The failure listener is per renderer realm, so no other
 * window hears it; without a subscriber in this one, the failure reaches nobody.
 *
 * One condition, one notice: the subscriber reuses `prefs-notice`, so a second failure replaces the
 * first rather than stacking beside it.
 *
 * Rendered under the window's real composition root, over a stubbed bridge.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubWorkspaceCompositionRoot } from '../../src/renderer/composition-root.js';
import { writeConfigPatch } from '../../src/renderer/config/write-config.js';

const SUB_ID = 'sw-1';
const PATCH = [{ path: ['editor', 'previews', 'syncScroll'], value: false }] as const;

let writePatch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writePatch = vi.fn(() => Promise.resolve({ ok: false, error: 'The disk is full.' }));
  Reflect.set(window, 'throng', {
    // Every daemon call answers empty: the window shows its loading state, which is all this needs.
    invoke: (method: string) => {
      const result =
        method === 'projects.list'
          ? { projects: [] }
          : method === 'subworkspace.list' || method === 'workspace.loadSubWorkspaces'
            ? { subWorkspaces: [] }
            : {};
      return Promise.resolve({ ok: true, result });
    },
    config: {
      get: () => Promise.resolve({ settings: {} }),
      onChange: () => () => {},
      writePatch,
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

async function mountWindow(): Promise<() => void> {
  const view = render(createElement(SubWorkspaceCompositionRoot, { id: SUB_ID }));
  await act(() => Promise.resolve());
  return () => view.unmount();
}

describe('a failed settings write in a sub-workspace window (FR-122e)', () => {
  it('shows exactly one prefs-notice in that window', async () => {
    const unmount = await mountWindow();
    try {
      await act(async () => {
        await writeConfigPatch({ kind: 'settings' }, PATCH);
      });
      expect(writePatch).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getAllByTestId('prefs-notice')).toHaveLength(1));
      expect(screen.getByTestId('prefs-notice').textContent).toContain('The disk is full.');
    } finally {
      unmount();
    }
  });

  it('still shows one notice after two failures in a row', async () => {
    const unmount = await mountWindow();
    try {
      await act(async () => {
        await writeConfigPatch({ kind: 'settings' }, PATCH);
      });
      await act(async () => {
        await writeConfigPatch({ kind: 'settings' }, PATCH);
      });
      expect(writePatch).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(screen.getAllByTestId('prefs-notice')).toHaveLength(1));
    } finally {
      unmount();
    }
  });
});
