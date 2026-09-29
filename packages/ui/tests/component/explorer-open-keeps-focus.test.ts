/**
 * 047 FR-081 (Session 2026-09-29, round 3) — a file activated in Files & Folders that opens in a preview
 * leaves Files & Folders the active pane, "so users can do things like rename with F2". The maintainer
 * found the tree losing the keyboard on every click once a Last Active preview was reused (047 US2): the
 * reuse, like 044's placement, made the workspace the active pane and moved the keyboard into the preview.
 *
 * A REAL mounted window and its REAL `PreviewCommands` opener, as `preview-open-target.test.ts` uses —
 * only main's answer is scripted. The control case is any other route to the same command, which keeps
 * moving the keyboard into the preview (FR-081's last sentence).
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHIPPED_PREVIEW_PROVIDERS, parsePreviewSettings } from '@throng/core';
import { requestPreviewOpen } from '../../src/renderer/preview/open-preview.js';
import { openFromTree, type OpenRoute } from '../../src/renderer/editor/open-router.js';
import { getActivePane, setActivePane } from '../../src/renderer/workspace/active-pane.js';
import type { WorkspaceContextValue } from '../../src/renderer/state/workspace-store.js';
import { COLD, PROJECT, mountMarkdownPreview } from './helpers/mount-preview-panel.js';

const OTHER_FILE = 'D:/proj/other.md';

function route(): OpenRoute {
  return {
    registry: SHIPPED_PREVIEW_PROVIDERS,
    previews: parsePreviewSettings(
      { providers: { markdown: { enabled: true, defaultOpenAction: 'preview' } } },
      SHIPPED_PREVIEW_PROVIDERS,
    ),
    projectId: PROJECT,
    openInEditor: async () => true,
  };
}

/** The tree's editor route is never taken here (Preview is the default), so no workspace is consulted. */
const NO_WS = { layout: null } as unknown as WorkspaceContextValue;

describe('activating a file in Files & Folders keeps Files & Folders active (FR-081)', () => {
  it('when main reuses the Last Active preview for it', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockResolvedValue({ kind: 'navigated', panelId: 'p1' });
      setActivePane('explorer');

      await act(async () => {
        await openFromTree(NO_WS, OTHER_FILE, 'lastActive', route());
      });

      expect(getActivePane()).toBe('explorer');
    } finally {
      m.unmount();
    }
  });

  it('when the file already has a preview, which is shown', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockResolvedValue({ kind: 'focused', panelId: 'p1' });
      setActivePane('explorer');

      await act(async () => {
        await openFromTree(NO_WS, OTHER_FILE, 'lastActive', route());
      });

      expect(getActivePane()).toBe('explorer');
    } finally {
      m.unmount();
    }
  });

  /*
   * The maintainer's round-4 report: with several previews open, clicking between files STILL moved the
   * keyboard now and then. A file that already has a preview is focused by main's `focus` MESSAGE as well as
   * by its answer — and the message carried nothing to say the tree asked.
   */
  it('asks main to keep focus, and main\'s focus message for it leaves the tree the keyboard', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      const onFocus = m.preview.onFocus.mock.calls.at(-1)?.[0] as ((msg: unknown) => void) | undefined;
      expect(onFocus).toBeTypeOf('function');
      m.preview.open.mockImplementation(async () => {
        onFocus!({ panelId: 'p1', keepFocus: true });
        return { kind: 'focused', panelId: 'p1' };
      });
      setActivePane('explorer');

      await act(async () => {
        await openFromTree(NO_WS, OTHER_FILE, 'lastActive', route());
      });

      expect(m.preview.open).toHaveBeenCalledWith(expect.objectContaining({ keepFocus: true }));
      expect(getActivePane()).toBe('explorer');
    } finally {
      m.unmount();
    }
  });

  it('control: main\'s focus message without keepFocus still makes the workspace the active pane', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      const onFocus = m.preview.onFocus.mock.calls.at(-1)?.[0] as ((msg: unknown) => void) | undefined;
      setActivePane('explorer');

      act(() => onFocus!({ panelId: 'p1' }));

      expect(getActivePane()).toBe('workspace');
    } finally {
      m.unmount();
    }
  });

  it('flashes the preview it landed in, so the user can see where it went (FR-083)', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockResolvedValue({ kind: 'navigated', panelId: 'p1' });
      expect(screen.queryByTestId('panel-flash-p1')).toBeNull();

      await act(async () => {
        await openFromTree(NO_WS, OTHER_FILE, 'lastActive', route());
      });

      expect(screen.getByTestId('panel-flash-p1')).toBeTruthy();
    } finally {
      m.unmount();
    }
  });

  it('control: an open from anywhere else does not flash', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockResolvedValue({ kind: 'navigated', panelId: 'p1' });

      await act(async () => {
        await requestPreviewOpen({ absPath: OTHER_FILE, projectId: PROJECT });
      });

      expect(screen.queryByTestId('panel-flash-p1')).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it('control: the same answer to any other route still makes the workspace the active pane', async () => {
    const m = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockResolvedValue({ kind: 'navigated', panelId: 'p1' });
      setActivePane('explorer');

      await act(async () => {
        await requestPreviewOpen({ absPath: OTHER_FILE, projectId: PROJECT });
      });

      expect(getActivePane()).toBe('workspace');
    } finally {
      m.unmount();
    }
  });
});
