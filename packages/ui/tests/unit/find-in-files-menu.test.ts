/**
 * 043 T075 — the Find in Files panel's own menu (FR-025a), as 060 left it.
 *
 * Constitution v6.0.0, Principle VI: every panel action is REACHABLE — by a mouse click or a keyboard
 * command — and a menu item is one route, no longer a mandatory one. 060 FR-022 uses that: **Run
 * search**, **Cancel search** and **Change scope** are gone from the menu, because each is already
 * one click or one key away. 060 FR-042 takes it further: the Replace toggle, the exclusions toggle,
 * the three grouping rows and the Split submenu are gone too — the toolbar, the replace chord and the
 * panel header's Split reach each of them. 060 FR-042 supersedes 043 FR-025a's menu rows, 048 FR-015's
 * Split on this panel's content menu, and 060 FR-027's menu row.
 *
 * The sections come from R20, adjudicated against the closed vocabulary:
 *
 *   - Exclude a heading, collapse/expand all — `viewState`.
 *   - The three commit granularities — `content`. They are the only items here that change text,
 *     and "content" means the RESULT ROW's content: the file's text.
 *
 * ══ THE COMMIT ITEMS ARE PRESENT AND DISABLED WHILE REPLACE IS OFF ══
 *
 * Not absent. Principle VI's test is "would any future state enable it?", and the answer is one
 * click away — the replace toggle on the panel's toolbar.
 */
import { describe, expect, it, vi } from 'vitest';
import { MENU_SECTION_ORDER, leftTruncatePath, type MenuSection } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import {
  findInFilesContentMenu,
  type FindInFilesMenuArgs,
} from '../../src/renderer/find-in-files/content-menu.js';

const noop = (): void => {};

function actions(): FindInFilesMenuArgs['actions'] {
  return {
    setAllCollapsed: vi.fn(),
  };
}

function build(over: Partial<FindInFilesMenuArgs> = {}): MenuAction[] {
  return findInFilesContentMenu({
    replaceEnabled: false,
    actions: actions(),
    ...over,
  });
}

const labels = (items: MenuAction[]): string[] => items.map((i) => i.label ?? '');
const find = (items: MenuAction[], testId: string): MenuAction | undefined =>
  items.find((i) => (i.testId ?? `menu-item-${i.label ?? ''}`) === `menu-item-${testId}`);
const sectionOf = (items: MenuAction[], testId: string): MenuSection | undefined =>
  find(items, testId)?.section;

describe('the commands that need a menu item have one (FR-025a, FR-022, FR-042)', () => {
  it('declares a known section on every row', () => {
    const items = build();
    for (const item of items) expect(MENU_SECTION_ORDER).toContain(item.section);
    expect(items.length).toBe(7);
  });

  it('carries no Run search, Cancel search or Change scope (FR-022)', () => {
    // Each stays reachable without the menu: the run/cancel control, Enter in the search input and
    // the find-in-files chord, the scope input. The menu is no longer the mandatory route (v6.0.0).
    const items = build();
    for (const gone of ['Run search', 'Cancel search', 'Change scope']) {
      expect(find(items, gone), gone).toBeUndefined();
      expect(labels(items)).not.toContain(gone);
    }
  });

  it('carries no Replace toggle, exclusions toggle, grouping row or Split submenu (060 FR-042)', () => {
    // Each keeps its own route: the toolbar controls, the replace chord, the panel header's Split.
    const items = build();
    const gone = [
      'Replace',
      'Use search exclusions',
      'Group by file',
      'Group by folder and file',
      'Group by folder structure',
      'Group by folder',
      'Split',
    ];
    for (const id of gone) expect(find(items, id), id).toBeUndefined();
    for (const label of labels(items)) {
      expect(label).not.toMatch(/^(Replace( ✓)?$|Use search exclusions|Group by|Split)/);
    }
    expect(items.some((i) => i.submenu !== undefined && i.label !== 'Open In')).toBe(false);
  });

  it('places each one where R20 put it', () => {
    const items = build();
    expect(sectionOf(items, 'Collapse all')).toBe('viewState');
    expect(sectionOf(items, 'Expand all')).toBe('viewState');
    expect(sectionOf(items, 'Exclude from Find in Files in this project')).toBe('viewState');
    expect(sectionOf(items, 'Open In')).toBe('navigate');
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

describe('collapse and expand (FR-025a)', () => {
  it('collapses and expands every group through one action, two ways', () => {
    const acts = actions();
    const items = build({ actions: acts });
    find(items, 'Collapse all')?.onClick?.();
    expect(acts.setAllCollapsed).toHaveBeenCalledWith(true);
    find(items, 'Expand all')?.onClick?.();
    expect(acts.setAllCollapsed).toHaveBeenCalledWith(false);
  });

  it('shows no chord on the items that have no command of their own', () => {
    const items = build();
    expect(find(items, 'Collapse all')?.shortcut).toBeUndefined();
    expect(find(items, 'Expand all')?.shortcut).toBeUndefined();
  });
});

describe('the narrow replace rows name their file, left-truncated (FR-023, SC-005)', () => {
  const LONG = 'packages/ui/src/renderer/find-in-files/components/deeply/nested/results-list.tsx';

  function withTarget(relPath: string): MenuAction[] {
    return build({
      replaceEnabled: true,
      commit: { replaceInFile: noop, replaceMatch: noop, target: { relPath } },
    });
  }

  it('shows a short path whole', () => {
    const items = withTarget('src/app.ts');
    expect(find(items, 'Replace in File')?.label).toBe('Replace in src/app.ts');
    expect(find(items, 'Replace Match')?.label).toBe('Replace Match in src/app.ts');
  });

  it('left-truncates a long path with leftTruncatePath, keeping the end that identifies the file', () => {
    const items = withTarget(LONG);
    const shown = leftTruncatePath(LONG);
    expect(shown).not.toBe(LONG);
    expect(find(items, 'Replace in File')?.label).toBe(`Replace in ${shown}`);
    expect(find(items, 'Replace Match')?.label).toBe(`Replace Match in ${shown}`);
    expect(find(items, 'Replace in File')?.label).toMatch(/results-list\.tsx$/);
  });

  it('keeps the test id on the action so the label can change with the pointer', () => {
    expect(find(withTarget(LONG), 'Replace in File')?.testId).toBe('menu-item-Replace in File');
  });
});

describe('Exclude from Find in Files (060 #532 FR-034)', () => {
  it('is drawn disabled without a heading, live with one', () => {
    const id = 'Exclude from Find in Files in this project';
    expect(find(build(), id)?.disabled).toBe(true);
    const exclude = vi.fn();
    const live = find(build({ actions: { ...actions(), excludeFromSearch: exclude } }), id);
    expect(live?.disabled).toBeFalsy();
    live?.onClick?.();
    expect(exclude).toHaveBeenCalledTimes(1);
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
    // A row that would call nothing is disabled rather than silently doing nothing when clicked.
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
