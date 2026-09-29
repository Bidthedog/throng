/**
 * 047 T035 — the setting reaches main for REAL, through the one registered opener every entry point
 * shares (`preview-commands.tsx`'s `registerPreviewOpener`) — proving `open-router.ts` (File Explorer's
 * default-open path, Quick Open's own route) and every other `requestPreviewOpen` caller need no
 * target-specific code of their own: the default is applied exactly once, where the setting is read.
 *
 * `editor-open-router.test.ts` already proves `openFromTree`/`openFromQuickOpen` call through to
 * `requestPreviewOpen` unconditionally (with a FAKE opener, to isolate the router's own decision from
 * placement); `open-preview.test.ts` already proves `openPreview` computes `target` correctly in
 * isolation. This file is the missing middle link: a REAL mounted window, a REAL `PreviewCommands`,
 * asking main for a preview the way `open-router.ts` actually does.
 */
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PREVIEW_KIND, SHIPPED_PREVIEW_PROVIDERS, collectPanels, parsePreviewSettings } from '@throng/core';
import { requestPreviewOpen } from '../../src/renderer/preview/open-preview.js';
import { openFromQuickOpen, openFromTree, type OpenRoute } from '../../src/renderer/editor/open-router.js';
import { COLD, PROJECT, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

const OTHER_FILE = 'D:/proj/other.md';

/** As `editor-open-router.test.ts`'s own `route()` — a Markdown provider set to preview by default. */
function route(): OpenRoute {
  return {
    registry: SHIPPED_PREVIEW_PROVIDERS,
    previews: parsePreviewSettings({ providers: { markdown: { enabled: true, defaultOpenAction: 'preview' } } }, SHIPPED_PREVIEW_PROVIDERS),
    projectId: PROJECT,
    openInEditor: async () => true,
  };
}

/*
 * 047 round 4 — the maintainer saw every Markdown file clicked in File Explorer open in a NEW preview with
 * the setting on Last Active. Main here answers as the real one does: it reuses the preview the request
 * names, and places a new one when it names none.
 */
describe('Last Active reuses the preview a File Explorer click placed (FR-015 with FR-081)', () => {
  it('two files clicked in turn share one preview', async () => {
    const m: MountedPreviewWindow = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      let placed = 0;
      m.preview.open.mockImplementation(async (req: { target?: { reusePanelId: string | null } }) => {
        const reuse = req.target?.reusePanelId ?? null;
        if (reuse !== null) return { kind: 'navigated', panelId: reuse };
        placed += 1;
        return { kind: 'placeLocally', reservation: `r${placed}`, besidePanelId: null };
      });
      const previews = (): number =>
        m.ws().layout!.tabs.flatMap((t) => collectPanels(t.root)).filter((p) => p.kind === PREVIEW_KIND).length;
      const before = previews();

      await act(async () => {
        await openFromTree(m.ws(), 'D:/proj/a.md', 'lastActive', route());
      });
      await act(async () => {
        await openFromTree(m.ws(), 'D:/proj/b.md', 'lastActive', route());
      });

      expect(previews()).toBe(before + 1);
    } finally {
      m.unmount();
    }
  });
});

describe('the setting reaches main through the real PreviewCommands (047 US2)', () => {
  it("editor.previews.openTarget: 'lastActive' (the default) is sent when the caller names no override", async () => {
    const m: MountedPreviewWindow = await mountMarkdownPreview('# T\n\nwords\n');
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockClear();

      await act(async () => {
        await requestPreviewOpen({ absPath: OTHER_FILE, projectId: PROJECT });
      });

      expect(m.preview.open).toHaveBeenCalledWith(
        expect.objectContaining({ absPath: OTHER_FILE, target: expect.objectContaining({ mode: 'lastActive' }) }),
      );
    } finally {
      m.unmount();
    }
  });

  it("editor.previews.openTarget: 'new' is read live and sent — no code in open-router.ts/quick-open.tsx needs to know it", async () => {
    const m: MountedPreviewWindow = await mountMarkdownPreview('# T\n\nwords\n', undefined, {
      settings: { editor: { previews: { openTarget: 'new' } } },
    });
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockClear();

      await act(async () => {
        await requestPreviewOpen({ absPath: OTHER_FILE, projectId: PROJECT });
      });

      expect(m.preview.open).toHaveBeenCalledWith(
        expect.objectContaining({ target: { mode: 'new', reusePanelId: null } }),
      );
    } finally {
      m.unmount();
    }
  });

  it("an explicit target on the intent overrides the setting (T037's Open In rows)", async () => {
    const m: MountedPreviewWindow = await mountMarkdownPreview('# T\n\nwords\n', undefined, {
      settings: { editor: { previews: { openTarget: 'lastActive' } } },
    });
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockClear();

      await act(async () => {
        await requestPreviewOpen({ absPath: OTHER_FILE, projectId: PROJECT, target: { mode: 'new' } });
      });

      expect(m.preview.open).toHaveBeenCalledWith(
        expect.objectContaining({ target: { mode: 'new', reusePanelId: null } }),
      );
    } finally {
      m.unmount();
    }
  });
});

/**
 * 047 T035/T036 — the missing middle link main asked to see closed: `open-router.ts`'s
 * `openFromTree`/`openFromQuickOpen` (File Explorer's default-open path, Quick Open's own route),
 * against the REAL registered opener (not a fake), so `bridge.open`'s eventual `target` is observed
 * end to end — proving neither file needs code of its own for this feature.
 */
describe('open-router.ts sends the target too, through the same real opener (047 T036)', () => {
  it("openFromTree (File Explorer's default-open path) sends the setting's mode", async () => {
    const m: MountedPreviewWindow = await mountMarkdownPreview('# T\n\nwords\n', undefined, {
      settings: { editor: { previews: { openTarget: 'new' } } },
    });
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockClear();

      await act(async () => {
        await openFromTree(m.ws(), OTHER_FILE, 'lastActive', route());
      });

      expect(m.preview.open).toHaveBeenCalledWith(
        expect.objectContaining({ absPath: OTHER_FILE, target: { mode: 'new', reusePanelId: null } }),
      );
    } finally {
      m.unmount();
    }
  });

  it("openFromQuickOpen sends the setting's mode the same way", async () => {
    const m: MountedPreviewWindow = await mountMarkdownPreview('# T\n\nwords\n', undefined, {
      settings: { editor: { previews: { openTarget: 'new' } } },
    });
    try {
      await screen.findByText('words', {}, COLD);
      m.preview.open.mockClear();
      const tabId = m.ws().layout?.tabs[0]?.id;
      if (!tabId) throw new Error('no tab in the mounted layout');

      await act(async () => {
        await openFromQuickOpen(m.ws(), tabId, `${ROOT}/notes.md`, 'lastActive', route());
      });

      expect(m.preview.open).toHaveBeenCalledWith(
        expect.objectContaining({ absPath: `${ROOT}/notes.md`, target: { mode: 'new', reusePanelId: null } }),
      );
    } finally {
      m.unmount();
    }
  });
});
