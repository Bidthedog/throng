/**
 * 043 T075 — the Find in Files panel's own menu (FR-025a).
 *
 * Constitution VI: every discrete command and state toggle a panel offers has a menu item, in the
 * right section, showing its chord where one is bound and its STATE where it is a toggle. This
 * feature adds a panel with nine such commands at once, so the rule binds it immediately rather
 * than accumulating another entry on the constitution's list of known gaps.
 *
 * The sections come from R20, adjudicated against the closed vocabulary:
 *
 *   - Run / Cancel — `viewState`. They act on the PANEL's run state, not on any content.
 *   - Toggle replace, grouping, collapse/expand all — `viewState`. Presentation over results
 *     already found; the same family as the explorer's Collapse All Children.
 *   - Change scope — `navigate`. It NAMES WHERE something is, the same test that puts Copy Path
 *     there.
 *   - The three commit granularities — `content`. They are the only items here that change text,
 *     and "content" means the RESULT ROW's content: the file's text.
 *
 * ══ THE COMMIT ITEMS ARE PRESENT AND DISABLED WHILE REPLACE IS OFF ══
 *
 * Not absent. Principle VI's test is "would any future state enable it?", and the answer is one
 * click away — the replace toggle sits in the same menu, two rows up. Hiding them would make the
 * menu's shape change under the user for a state they can flip from inside it, and would leave
 * replace discoverable only from the panel's toolbar.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYBINDINGS, MENU_SECTION_ORDER, type MenuSection } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import {
  findInFilesContentMenu,
  type FindInFilesMenuArgs,
} from '../../src/renderer/find-in-files/content-menu.js';

const noop = (): void => {};

function actions(): FindInFilesMenuArgs['actions'] {
  return {
    run: vi.fn(),
    cancel: vi.fn(),
    toggleReplace: vi.fn(),
    setGrouping: vi.fn(),
    focusScope: vi.fn(),
    setAllCollapsed: vi.fn(),
  };
}

function build(over: Partial<FindInFilesMenuArgs> = {}): MenuAction[] {
  return findInFilesContentMenu({
    running: false,
    replaceEnabled: false,
    grouping: 'file',
    keybindings: DEFAULT_KEYBINDINGS,
    actions: actions(),
    ...over,
  });
}

const labels = (items: MenuAction[]): string[] => items.map((i) => i.label ?? '');
const find = (items: MenuAction[], testId: string): MenuAction | undefined =>
  items.find((i) => (i.testId ?? `menu-item-${i.label ?? ''}`) === `menu-item-${testId}`);
const sectionOf = (items: MenuAction[], testId: string): MenuSection | undefined =>
  find(items, testId)?.section;

describe('every command the panel offers has a menu item (FR-025a)', () => {
  it('carries all nine, and every one declares a known section', () => {
    const items = build();
    for (const item of items) expect(MENU_SECTION_ORDER).toContain(item.section);
    expect(items.length).toBeGreaterThanOrEqual(9);
  });

  it('places each one where R20 put it', () => {
    const items = build();
    expect(sectionOf(items, 'Run search')).toBe('viewState');
    expect(sectionOf(items, 'Replace')).toBe('viewState');
    expect(sectionOf(items, 'Group by file')).toBe('viewState');
    expect(sectionOf(items, 'Group by folder and file')).toBe('viewState');
    // FR-073 — the withdrawn grouping is not a row anywhere, in any section.
    expect(find(items, 'Group by folder')).toBeUndefined();
    expect(sectionOf(items, 'Collapse all')).toBe('viewState');
    expect(sectionOf(items, 'Expand all')).toBe('viewState');
    // The one that is NOT view state: it names where the search looks.
    expect(sectionOf(items, 'Change scope')).toBe('navigate');
    expect(sectionOf(items, 'Replace All')).toBe('content');
    expect(sectionOf(items, 'Replace in File')).toBe('content');
    expect(sectionOf(items, 'Replace Match')).toBe('content');
  });

  it('draws the sections in the one fixed order', () => {
    // `content` before `navigate` before `viewState`, whatever order the builder pushed them in.
    const seen = [...new Set(build().map((i) => i.section))];
    expect(seen).toEqual(
      [...seen].sort((a, b) => MENU_SECTION_ORDER.indexOf(a) - MENU_SECTION_ORDER.indexOf(b)),
    );
  });
});

describe('run and cancel are one row, showing what the panel can do NOW', () => {
  it('offers Run while nothing is running', () => {
    const items = build({ running: false });
    expect(labels(items)).toContain('Run search');
    expect(labels(items)).not.toContain('Cancel search');
  });

  it('offers Cancel while a scan is running', () => {
    /*
     * One row rather than two-with-one-disabled, matching the panel's own control: the two are the
     * same button in the toolbar, and a menu offering both would say the panel can be started and
     * stopped at the same moment.
     */
    const items = build({ running: true });
    expect(labels(items)).toContain('Cancel search');
    expect(labels(items)).not.toContain('Run search');
  });

  it('calls the panel’s own run and cancel', () => {
    const acts = actions();
    find(build({ actions: acts }), 'Run search')?.onClick?.();
    expect(acts.run).toHaveBeenCalledTimes(1);
    find(build({ actions: acts, running: true }), 'Cancel search')?.onClick?.();
    expect(acts.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('a toggle shows its state (FR-025a)', () => {
  it('marks the replace toggle with a leading ✓ when it is on', () => {
    // The editor's Word Wrap idiom, and its `testId` trick with it: the identifier is pinned to the
    // bare label so it survives the state changing.
    expect(find(build({ replaceEnabled: false }), 'Replace')?.label).toBe('Replace');
    expect(find(build({ replaceEnabled: true }), 'Replace')?.label).toBe('Replace ✓');
  });

  it('marks the grouping the panel is currently in, and only that one', () => {
    const byFolderAndFile = build({ grouping: 'fileAndFolder' });
    expect(find(byFolderAndFile, 'Group by file')?.label).toBe('Group by file');
    expect(find(byFolderAndFile, 'Group by folder and file')?.label).toBe(
      'Group by folder and file ✓',
    );

    const byFile = build({ grouping: 'file' });
    expect(find(byFile, 'Group by file')?.label).toBe('Group by file ✓');
    expect(find(byFile, 'Group by folder and file')?.label).toBe('Group by folder and file');
  });

  it('switches grouping through the panel’s own action', () => {
    const acts = actions();
    find(build({ actions: acts }), 'Group by folder and file')?.onClick?.();
    expect(acts.setGrouping).toHaveBeenCalledWith('fileAndFolder');
  });

  it('collapses and expands every group through one action, two ways', () => {
    const acts = actions();
    const items = build({ actions: acts });
    find(items, 'Collapse all')?.onClick?.();
    expect(acts.setAllCollapsed).toHaveBeenCalledWith(true);
    find(items, 'Expand all')?.onClick?.();
    expect(acts.setAllCollapsed).toHaveBeenCalledWith(false);
  });
});

describe('the chord is shown where one is bound (FR-025a)', () => {
  it('shows the LIVE chord for run, read from the bindings it is given', () => {
    // Read at build time, so a rebind shows on the next right-click rather than the next restart.
    const rebound = {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'search.findInFiles': ['F9'] },
    };
    expect(find(build({ keybindings: rebound }), 'Run search')?.shortcut).toBe('F9');
  });

  it('shows none where the command is unbound, rather than empty brackets', () => {
    const unbound = {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'search.findInFiles': [] },
    };
    expect(find(build({ keybindings: unbound }), 'Run search')?.shortcut).toBeUndefined();
  });

  it('shows no chord on the items that have no command of their own', () => {
    // Grouping, scope and collapse/expand are menu-and-panel-control actions with no ActionId, so
    // there is nothing to resolve and nothing to advertise.
    const items = build();
    expect(find(items, 'Group by file')?.shortcut).toBeUndefined();
    expect(find(items, 'Change scope')?.shortcut).toBeUndefined();
  });
});

describe('the three commit granularities (FR-049, contracts §)', () => {
  it('are DISABLED while replace is off, and still drawn', () => {
    const items = build({ replaceEnabled: false });
    for (const id of ['Replace All', 'Replace in File', 'Replace Match']) {
      expect(find(items, id), id).toBeDefined();
      expect(find(items, id)?.disabled, id).toBe(true);
    }
  });

  it('are disabled while replace is ON but no commit handler has been supplied', () => {
    /*
     * This wave builds the panel's menu; the commit itself is the next one. A row that would call
     * nothing is disabled rather than silently doing nothing when clicked — which is the honest
     * shape for a command that is not wired yet, and the shape that makes wiring it a one-line
     * change rather than a new menu item.
     */
    const items = build({ replaceEnabled: true });
    expect(find(items, 'Replace All')?.disabled).toBe(true);
  });

  it('are enabled, and call through, once replace is on AND a handler exists', () => {
    const replaceAll = vi.fn();
    const replaceInFile = vi.fn();
    const replaceMatch = vi.fn();
    const items = build({
      replaceEnabled: true,
      commit: { replaceAll, replaceInFile, replaceMatch },
    });

    expect(find(items, 'Replace All')?.disabled).toBe(false);
    find(items, 'Replace All')?.onClick?.();
    find(items, 'Replace in File')?.onClick?.();
    find(items, 'Replace Match')?.onClick?.();

    expect(replaceAll).toHaveBeenCalledTimes(1);
    expect(replaceInFile).toHaveBeenCalledTimes(1);
    expect(replaceMatch).toHaveBeenCalledTimes(1);
  });

  it('stay disabled with a handler present but replace off', () => {
    const items = build({ replaceEnabled: false, commit: { replaceAll: noop } });
    expect(find(items, 'Replace All')?.disabled).toBe(true);
  });
});
