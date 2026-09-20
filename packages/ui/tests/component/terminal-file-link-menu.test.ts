import { describe, expect, it, vi } from 'vitest';
import { linkMenuActions, type LinkMenuPerformers } from '../../src/renderer/links/link-menu.js';
import type { LinkOpenInTarget } from '../../src/renderer/links/link-open-in.js';
import { openLinkMenu, type LinkMenuOpener } from '../../src/renderer/links/open-link-or-panel-menu.js';
import { terminalContentMenu } from '../../src/renderer/terminal/terminal-content-menu.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';

/**
 * 045 round four — FR-169 – FR-171, FR-170a – FR-170c, SC-025 (T276).
 *
 * ══ THE OPENING RULE (§9.1) AND MENU IDENTITY (SC-025) ══
 *
 * The Link menu is ONE thing — `link-menu.ts`'s `linkMenuActions`, built from core's `buildLinkMenu`
 * — opened by `open-link-or-panel-menu.ts`'s `openLinkMenu` AT ONCE and updated in place once main
 * answers. This file tests those two modules directly: they are what a terminal, an editor and the
 * Markdown preview all share, so a defect here is a defect in all three at once, and a fixture proven
 * here needs no restating per surface.
 *
 * `terminalContentMenu` no longer draws any link row at all (FR-169): a right-click over a link opens
 * the Link menu INSTEAD of the panel's menu, never one leading the other — the second `describe`
 * below is what is left of the old file-link/web-link coverage, now a negative assertion.
 */

const noop = (): void => {};

const applicable = (over: Partial<Parameters<typeof linkMenuActions>[0]['applicable']> = {}) => ({
  inProjectByName: true,
  previewByExtension: 'none' as const,
  executableByExtension: false,
  folderByGrammar: false,
  ...over,
});

function performers(calls: string[] = []): LinkMenuPerformers & { calls: string[] } {
  return {
    calls,
    openInEditor: vi.fn((target: LinkOpenInTarget) => {
      calls.push(target.kind === 'editor' ? `editor:${target.editorId}` : `editor:${target.kind}`);
    }),
    openInPreview: vi.fn(() => calls.push('preview')),
    osExplorer: vi.fn(() => calls.push('osExplorer')),
    osDefaultProgram: vi.fn(() => calls.push('osDefaultProgram')),
    openProgram: vi.fn(() => calls.push('openProgram')),
  };
}

const labels = (items: MenuAction[]): (string | undefined)[] => items.map((i) => i.label);
const item = (items: MenuAction[], label: string): MenuAction => {
  const found = items.find((i) => i.label === label);
  expect(found, `no row labelled "${label}"`).toBeDefined();
  return found!;
};

describe('linkMenuActions — SC-025: identical rows for every fixture (FR-170)', () => {
  it('an in-project file with an enabled provider — labels, order and Open In ▸ grouped', () => {
    const items = linkMenuActions(
      {
        cls: 'onDevice',
        applicable: applicable({ previewByExtension: 'enabled' }),
        openEditors: [{ id: 'e1', name: 'notes.md' }],
        openLink: noop,
        copyLink: noop,
        performers: performers(),
      },
      { kind: 'file', inProject: true, executable: false, preview: 'enabled' },
    );

    expect(labels(items)).toEqual([
      'Open Link',
      'Open In',
      'Open Preview',
      'Open in OS Explorer',
      'Open in OS Default Program',
      'Copy Link to Clipboard',
    ]);
    const openIn = item(items, 'Open In');
    expect(openIn.submenu?.map((r) => r.label)).toEqual(['New Editor', 'Active Editor', 'notes.md']);
  });

  it('an executable offers Open Program, not Open in OS Default Program (S8)', () => {
    const items = linkMenuActions(
      {
        cls: 'onDevice',
        applicable: applicable({ executableByExtension: true }),
        openLink: noop,
        copyLink: noop,
        performers: performers(),
      },
      { kind: 'file', inProject: true, executable: true, preview: 'none' },
    );
    expect(labels(items)).toEqual([
      'Open Link',
      'Open In',
      'Open in OS Explorer',
      'Open Program',
      'Copy Link to Clipboard',
    ]);
  });

  it('a folder offers Open Link, Open in OS Explorer and Copy Link to Clipboard only', () => {
    const items = linkMenuActions(
      { cls: 'onDevice', applicable: applicable(), openLink: noop, copyLink: noop },
      { kind: 'folder', inProject: true, executable: false, preview: 'none' },
    );
    expect(labels(items)).toEqual(['Open Link', 'Open in OS Explorer', 'Copy Link to Clipboard']);
  });

  it('an UNRESOLVED link draws its applicable rows DISABLED, never absent (FR-170a)', () => {
    const items = linkMenuActions(
      {
        cls: 'onDevice',
        applicable: applicable({ previewByExtension: 'enabled', executableByExtension: true }),
        openLink: noop,
        copyLink: noop,
        performers: performers(),
      },
      null,
    );
    expect(labels(items)).toEqual([
      'Open Link',
      'Open In',
      'Open Preview',
      'Open in OS Explorer',
      'Open Program',
      'Copy Link to Clipboard',
    ]);
    expect(item(items, 'Open In').disabled).toBe(true);
    expect(item(items, 'Open Preview').disabled).toBe(true);
    expect(item(items, 'Open in OS Explorer').disabled).toBeFalsy();
    expect(item(items, 'Open Program').disabled).toBe(true);
  });

  it("'pending' draws only the renderer-known rows — rows 5/6 not drawn at all (FR-170c)", () => {
    const items = linkMenuActions(
      {
        cls: 'onDevice',
        applicable: applicable({ previewByExtension: 'enabled', executableByExtension: true }),
        openLink: noop,
        copyLink: noop,
        performers: performers(),
      },
      'pending',
    );
    expect(labels(items)).toEqual([
      'Open Link',
      'Open In',
      'Open Preview',
      'Open in OS Explorer',
      'Copy Link to Clipboard',
    ]);
  });

  it('web/loopback/protocol/anchor: Open Link and Copy Link to Clipboard only, whatever applicable says', () => {
    for (const cls of ['web', 'loopback', 'protocol', 'anchor'] as const) {
      const items = linkMenuActions(
        { cls, applicable: applicable({ previewByExtension: 'enabled' }), openLink: noop, copyLink: noop },
        null,
      );
      expect(labels(items)).toEqual(['Open Link', 'Copy Link to Clipboard']);
    }
  });
});

describe('linkMenuActions — each row performs its OWN target (FR-054)', () => {
  it('Open Link runs the surface Ctrl+click route, and only that', () => {
    const openLink = vi.fn();
    const items = linkMenuActions(
      { cls: 'onDevice', applicable: applicable(), openLink, copyLink: noop },
      { kind: 'file', inProject: true, executable: false, preview: 'none' },
    );
    item(items, 'Open Link').onClick?.();
    expect(openLink).toHaveBeenCalledTimes(1);
  });

  it('Copy Link to Clipboard runs the caller’s copy action', () => {
    const copyLink = vi.fn();
    const items = linkMenuActions(
      { cls: 'onDevice', applicable: applicable(), openLink: noop, copyLink },
      null,
    );
    item(items, 'Copy Link to Clipboard').onClick?.();
    expect(copyLink).toHaveBeenCalledTimes(1);
  });

  it('New Editor, Active Editor and a named editor row each reach openInEditor with their OWN target', () => {
    const perf = performers();
    const items = linkMenuActions(
      {
        cls: 'onDevice',
        applicable: applicable(),
        openEditors: [{ id: 'e1', name: 'notes.md' }],
        openLink: noop,
        copyLink: noop,
        performers: perf,
      },
      { kind: 'file', inProject: true, executable: false, preview: 'none' },
    );
    const openIn = item(items, 'Open In').submenu!;
    openIn.find((r) => r.label === 'New Editor')!.onClick?.();
    openIn.find((r) => r.label === 'Active Editor')!.onClick?.();
    openIn.find((r) => r.label === 'notes.md')!.onClick?.();
    // New and Active are two different routes (FR-170 row 2): a performer that could not tell them
    // apart would open both into the same place.
    expect(perf.calls).toEqual(['editor:new', 'editor:active', 'editor:e1']);
  });

  it('Open Preview, Open in OS Explorer and Open Program each reach their own performer', () => {
    const perf = performers();
    const items = linkMenuActions(
      {
        cls: 'onDevice',
        applicable: applicable({ previewByExtension: 'enabled', executableByExtension: true }),
        openLink: noop,
        copyLink: noop,
        performers: perf,
      },
      { kind: 'file', inProject: true, executable: true, preview: 'enabled' },
    );
    item(items, 'Open Preview').onClick?.();
    item(items, 'Open in OS Explorer').onClick?.();
    item(items, 'Open Program').onClick?.();
    expect(perf.calls).toEqual(['preview', 'osExplorer', 'openProgram']);
  });

  it('a DISABLED row carries no handler at all', () => {
    const perf = performers();
    const items = linkMenuActions(
      { cls: 'onDevice', applicable: applicable(), openLink: noop, copyLink: noop, performers: perf },
      null,
    );
    expect(item(items, 'Open in OS Default Program').onClick).toBeUndefined();
  });
});

describe('openLinkMenu — opens AT ONCE, updates when main answers (FR-170b/c)', () => {
  function fakeOpener(): LinkMenuOpener & { opened: MenuAction[][]; updated: [number, MenuAction[]][] } {
    const opened: MenuAction[][] = [];
    const updated: [number, MenuAction[]][] = [];
    let nextId = 0;
    return {
      opened,
      updated,
      openMenu: (_x, _y, items) => {
        opened.push(items);
        return ++nextId;
      },
      updateMenu: (opId, items) => {
        updated.push([opId, items]);
      },
    };
  }

  it('with a resolver, opens synchronously with the PENDING build before the resolver settles', async () => {
    const opener = fakeOpener();
    let resolveNow: (() => void) | undefined;
    const resolve = vi.fn(
      () =>
        new Promise<null>((res) => {
          resolveNow = () => res(null);
        }),
    );
    const buildItems = vi.fn((resolution) => [{ label: String(resolution), section: 'contextual' as const }]);

    openLinkMenu({ x: 1, y: 2, opener, buildItems, resolve });

    // The menu is open BEFORE the resolver has answered — the await-then-open pattern is gone.
    expect(opener.opened).toHaveLength(1);
    expect(opener.opened[0]?.[0]?.label).toBe('pending');
    expect(opener.updated).toHaveLength(0);
    expect(resolve).toHaveBeenCalledTimes(1);

    resolveNow?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(opener.updated).toEqual([[1, [{ label: 'null', section: 'contextual' }]]]);
  });

  it('without a resolver, opens once with the non-pending build and asks main nothing', () => {
    const opener = fakeOpener();
    const buildItems = vi.fn(() => [{ label: 'x', section: 'contextual' as const }]);

    openLinkMenu({ x: 0, y: 0, opener, buildItems });

    expect(buildItems).toHaveBeenCalledWith(null);
    expect(buildItems).toHaveBeenCalledTimes(1);
    expect(opener.opened).toHaveLength(1);
    expect(opener.updated).toHaveLength(0);
  });

  it('a late answer after the menu closed changes nothing (opId no longer current)', async () => {
    // The real provider is the one that actually drops a stale opId; this fakes exactly that
    // contract, which is what `openLinkMenu` relies on.
    const updates: [number, MenuAction[]][] = [];
    let openMenuOpId = 0;
    let currentOpId: number | null = null;
    const opener: LinkMenuOpener = {
      openMenu: () => {
        currentOpId = ++openMenuOpId;
        return currentOpId;
      },
      updateMenu: (opId, items) => {
        if (opId === currentOpId) updates.push([opId, items]);
      },
    };
    let answer: (() => void) | undefined;
    const resolve = () =>
      new Promise<null>((res) => {
        answer = () => res(null);
      });

    openLinkMenu({ x: 0, y: 0, opener, buildItems: () => [], resolve });
    // The user closes the menu (or opens a different one) before main answers.
    currentOpId = null;

    answer?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(updates).toHaveLength(0);
  });

  it('ONE resolution per opening (SC-021) — resolve is called exactly once', () => {
    const opener = fakeOpener();
    const resolve = vi.fn(() => Promise.resolve(null));
    openLinkMenu({ x: 0, y: 0, opener, buildItems: () => [], resolve });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('terminalContentMenu — carries no link row at all any more (FR-169)', () => {
  const menu = (selection = ''): MenuAction[] =>
    terminalContentMenu({
      selection,
      redrawChord: 'Ctrl+Shift+R',
      startFailure: false,
      actions: {
        copySelection: noop,
        paste: noop,
        redraw: noop,
        tryAgain: noop,
        copyDetails: noop,
        clearPanelType: noop,
      },
    });

  it('is exactly Copy, Paste, Refresh / redraw terminal — the ordinary menu, unchanged', () => {
    expect(labels(menu())).toEqual(['Copy', 'Paste', 'Refresh / redraw terminal']);
  });

  it('never draws Open Link or Copy Link to Clipboard, with or without a selection', () => {
    for (const selection of ['', 'some output']) {
      expect(labels(menu(selection))).not.toContain('Open Link');
      expect(labels(menu(selection))).not.toContain('Copy Link to Clipboard');
    }
  });
});
