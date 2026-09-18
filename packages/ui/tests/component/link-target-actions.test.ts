import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolutionRequest, ResolvedLink } from '@throng/core';
import { fileLinkMenuActions } from '../../src/renderer/links/link-menu-items.js';
import type { LinkActionDeps } from '../../src/renderer/links/link-actions.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';

/**
 * 045 FR-033 – FR-036, FR-054 — a NAMED menu item performs its own target, whatever the preference
 * says (T084).
 *
 * ══ WHY THIS IS THE ONE THING THE MENU MUST GET RIGHT ══
 *
 * FR-050's *Default link action* decides what Open Link, Ctrl+click and the chord do. It decides
 * nothing at all about the five items beside them: a user who reaches past Open Link to *Open in OS
 * Explorer* has said precisely what they want, and an item that consulted the preference would
 * ignore them — which is the constitutional rule that a preference picks the DEFAULT while the menu
 * offers every variant.
 *
 * So each named item routes straight to its own performer, and this drives all four and asserts
 * that exactly one runs each time. The performers themselves are the surface's: `openFileInTab`
 * (honouring *Open files in*, never `open-router.ts` — FR-033), `requestPreviewOpen` (FR-034), and
 * the two `throng:links:*` calls, which send the REQUEST so main re-resolves rather than trusting a
 * path from the renderer (FR-037).
 */

const link = (over: Partial<ResolvedLink> = {}): ResolvedLink => ({
  path: 'D:\\project\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'enabled',
  ...over,
});

const request: LinkResolutionRequest = {
  text: 'src/foo.ts:42:7',
  kind: 'detectedPath',
  panelId: 'panel-1',
  originProjectId: 'project-1',
};

function fakeDeps(): LinkActionDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openInEditor: vi.fn(() => {
      calls.push('editor');
    }),
    openInPreview: vi.fn(() => {
      calls.push('preview');
    }),
    revealInOsExplorer: vi.fn(async () => {
      calls.push('osExplorer');
      return { ok: true } as const;
    }),
    openInOsDefaultProgram: vi.fn(async () => {
      calls.push('osDefaultProgram');
      return { ok: true } as const;
    }),
    reportFailure: vi.fn(() => {
      calls.push('failure');
    }),
  };
}

const item = (items: MenuAction[], label: string): MenuAction => {
  const found = items.find((i) => i.label === label);
  expect(found, `no menu row labelled "${label}"`).toBeDefined();
  return found!;
};

let write: ReturnType<typeof vi.fn>;

beforeEach(() => {
  write = vi.fn(async () => {});
  (window as unknown as { throng?: unknown }).throng = { clipboard: { write } };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
});

describe('each named item performs its own target (FR-054)', () => {
  it('Open in Editor reaches the editor opener and carries the link’s position (FR-033)', async () => {
    const deps = fakeDeps();
    const items = fileLinkMenuActions({
      link: link(),
      request,
      position: { line: 42, column: 7 },
      positionText: ':42:7',
      openLink: () => deps.calls.push('default'),
      deps,
    });

    item(items, 'Open in Editor').onClick?.();
    await Promise.resolve();

    expect(deps.calls).toEqual(['editor']);
    expect(deps.openInEditor).toHaveBeenCalledWith(expect.objectContaining({ path: link().path }), {
      line: 42,
      column: 7,
    });
  });

  it('Open in Preview reaches the preview opener and IGNORES the position (FR-034)', async () => {
    const deps = fakeDeps();
    const items = fileLinkMenuActions({
      link: link(),
      request,
      position: { line: 42, column: 7 },
      openLink: () => deps.calls.push('default'),
      deps,
    });

    item(items, 'Open in Preview').onClick?.();
    await Promise.resolve();

    expect(deps.calls).toEqual(['preview']);
    expect(deps.openInPreview).toHaveBeenCalledWith(expect.objectContaining({ path: link().path }));
    expect(deps.openInPreview).toHaveBeenCalledTimes(1);
    // One argument: no position reaches a surface that cannot place one.
    expect(vi.mocked(deps.openInPreview).mock.calls[0]).toHaveLength(1);
  });

  it('Open in OS Explorer sends the REQUEST, never the resolved path (FR-035, FR-037)', async () => {
    const deps = fakeDeps();
    const items = fileLinkMenuActions({ link: link(), request, openLink: () => {}, deps });

    item(items, 'Open in OS Explorer').onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.calls).toEqual(['osExplorer']);
    expect(deps.revealInOsExplorer).toHaveBeenCalledWith(request);
  });

  it('Open in OS Default Program sends the REQUEST too (FR-036, FR-037)', async () => {
    const deps = fakeDeps();
    const items = fileLinkMenuActions({ link: link(), request, openLink: () => {}, deps });

    item(items, 'Open in OS Default Program').onClick?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.calls).toEqual(['osDefaultProgram']);
    expect(deps.openInOsDefaultProgram).toHaveBeenCalledWith(request);
  });

  it('Copy Link Address copies and performs no target at all', async () => {
    const deps = fakeDeps();
    const items = fileLinkMenuActions({
      link: link(),
      request,
      positionText: ':42:7',
      openLink: () => deps.calls.push('default'),
      deps,
    });

    item(items, 'Copy Link Address').onClick?.();
    await Promise.resolve();

    expect(deps.calls).toEqual([]);
    expect(write).toHaveBeenCalledWith({
      text: 'D:\\project\\src\\foo.ts:42:7',
      mode: 'verbatim',
    });
  });

  it('Open Link — and ONLY Open Link — runs the surface’s default-action route', async () => {
    const deps = fakeDeps();
    const items = fileLinkMenuActions({
      link: link(),
      request,
      openLink: () => deps.calls.push('default'),
      deps,
    });

    item(items, 'Open Link').onClick?.();
    await Promise.resolve();

    expect(deps.calls).toEqual(['default']);
  });

  it('a DISABLED preview item performs nothing when it is clicked anyway', async () => {
    const deps = fakeDeps();
    const items = fileLinkMenuActions({
      link: link({ preview: 'disabled' }),
      request,
      openLink: () => deps.calls.push('default'),
      deps,
    });

    const preview = item(items, 'Open in Preview');
    expect(preview.disabled).toBe(true);
    preview.onClick?.();
    await Promise.resolve();

    expect(deps.calls).toEqual([]);
  });

  it('a link that resolved to nothing contributes no items at all (FR-013)', () => {
    expect(fileLinkMenuActions(null)).toEqual([]);
  });
});
