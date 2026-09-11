/**
 * 043 T170/T171 (FR-062a, Constitution VI) — the panel header menu offers Zoom only where zoom works.
 *
 * ══ THIS IS A DEFECT AGAINST A RULE THAT ALREADY EXISTED ══
 *
 * Constitution VI's disabled-versus-absent rule: a command that is not merely *unavailable right now*
 * but *never meaningful here* must be ABSENT, not present and inert. The Zoom submenu is built
 * unconditionally in `panel-header-menu.ts`, before the first `panel.kind` branch — so it appears on
 * every panel, while only `editor-panel.tsx` and `terminal-panel.tsx` read `panelZoomLevel` and do
 * anything with it. On the other kinds all three commands change a persisted integer that nothing
 * renders: the user picks Zoom In, the panel does not zoom, and nothing says why.
 *
 * Two kinds are affected, which is the whole reason FR-062a is worded generally. FR-062 makes zoom
 * real on the Find in Files panel; citing that rule to fix one panel while leaving the identical
 * violation on the UNTYPED placeholder beside it would make the rule mean "this panel" (plan D2,
 * research R26).
 *
 * ══ WHY THE TABLE IS WRITTEN OUT RATHER THAN DERIVED ══
 *
 * The interesting claim is a correspondence between two files — the menu offers Zoom exactly where a
 * panel component consumes it — and a test that derived one side from the other could only ever
 * prove the derivation. So the set of kinds that CONSUME zoom is restated here by hand, with the
 * consumer named for each, and the menu is checked against it. When a kind gains or loses a zoom
 * consumer, this table is what has to move with it.
 *
 * ══ WHY IT IS AT THIS TIER ══
 *
 * `panelHeaderMenu` is pure, so the assertion itself would sit happily at unit. It lives here beside
 * the other panel-header component tests because the follow-on claim in this file — that a Find in
 * Files panel's header offers no route into a rename at all (FR-061) — is about a rendered header,
 * and splitting one requirement's evidence across two tiers is how half of it stops being run.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, FIND_IN_FILES_KIND, type Panel, type PanelKind } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import {
  panelHeaderMenu,
  type PanelHeaderMenuActions,
} from '../../src/renderer/workspace/panel-header-menu.js';

const noop = (): void => {};

/** Every action the builder can call. Required fields, so a new row is a compile error here. */
const panelActions: PanelHeaderMenuActions = {
  beginRename: noop,
  resetName: noop,
  zoomIn: noop,
  zoomOut: noop,
  resetZoom: noop,
  save: noop,
  saveAs: noop,
  revert: noop,
  reloadFromDisk: noop,
  reloadTerminal: noop,
  revealInTree: noop,
  openInOsExplorer: noop,
  tryAgain: noop,
  copyDetails: noop,
  clearPanelType: noop,
  redraw: noop,
  sendToNewTab: noop,
  sendToTab: noop,
  find: noop,
  replace: noop,
  replaceAll: noop,
  destroy: noop,
};

const panel = (over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id: 'p1',
  originProjectId: 'proj',
  title: 'Panel 3',
  ...over,
});

const menuFor = (kind: PanelKind | undefined): MenuAction[] =>
  panelHeaderMenu({
    panel: panel(kind === undefined ? {} : { kind }),
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [],
    editor: kind === 'editor' ? { dirty: false, hasFilePath: true } : null,
    editorFailure: false,
    detach: null,
    actions: panelActions,
  });

const labels = (items: MenuAction[]): string[] => items.map((i) => i.label ?? '(no label)');

/** The Zoom submenu's own rows, or `null` when the submenu is not offered at all. */
const zoomSubmenu = (items: MenuAction[]): string[] | null => {
  const zoom = items.find((i) => i.label === 'Zoom');
  if (!zoom) return null;
  return (zoom.submenu ?? []).map((i) => i.label ?? '(no label)');
};

/**
 * Which panel kinds actually render their zoom level, and where.
 *
 * `Panel.zoom` is persisted for every panel and the three chords resolve to whichever panel is
 * active, so "does the panel zoom" is never a question about the store — it is a question about
 * whether any component reads `panelZoomLevel(panel)` and does something visible with the answer.
 */
const KINDS: { kind: PanelKind | undefined; what: string; zooms: boolean; consumer: string }[] = [
  {
    kind: undefined,
    what: 'the untyped placeholder',
    zooms: false,
    consumer: 'nothing — the panel is a "Select Panel Type" screen with no body text of its own',
  },
  {
    kind: 'editor',
    what: 'an editor panel',
    zooms: true,
    consumer: 'editor-panel.tsx publishes --throng-zoom-editor; editor.css multiplies with it',
  },
  {
    kind: 'terminal',
    what: 'a terminal panel',
    zooms: true,
    consumer: 'terminal-panel.tsx rounds the font size by the factor before xterm measures cells',
  },
  {
    kind: FIND_IN_FILES_KIND,
    what: 'a Find in Files panel',
    /*
     * TRUE from 043 T177, and FALSE before it. This row is the one the phase moves twice, and both
     * moves are the requirement rather than an accommodation of the code:
     *
     *   - at T170 it was `false`, and the assertion below was RED. The submenu was offered on a
     *     panel where all three commands moved a persisted integer nothing rendered, which is the
     *     Constitution VI defect FR-062a names;
     *   - at T177 FR-062 made the panel honour its zoom in both its text and its row metrics, so
     *     FR-062a's rule points the other way and the submenu MUST be offered.
     *
     * Written down rather than quietly flipped, because "the test moved to match the code" and "the
     * requirement changed what the code must do" look identical in a diff and are not the same
     * thing.
     */
    zooms: true,
    consumer:
      'find-in-files-panel.tsx publishes --throng-zoom-fif for the text; results-list.tsx rounds the row height by the same factor',
  },
];

describe('the Zoom submenu is offered only where zoom is implemented (FR-062a, Constitution VI)', () => {
  for (const { kind, what, zooms, consumer } of KINDS) {
    it(`${zooms ? 'offers' : 'omits'} Zoom on ${what}`, () => {
      const items = menuFor(kind);
      if (zooms) {
        expect(zoomSubmenu(items), `${what} implements zoom (${consumer})`).toEqual([
          'Zoom In',
          'Zoom Out',
          'Reset Zoom',
        ]);
      } else {
        expect(
          zoomSubmenu(items),
          `${what} implements no zoom (${consumer}), so all three commands are permanently inert`,
        ).toBeNull();
      }
    });
  }

  it('omits the submenu entirely rather than disabling its rows', () => {
    // The distinction Constitution VI draws, asserted rather than implied. A disabled Zoom would say
    // "not right now"; on a panel with no zoom consumer the honest statement is that the command
    // does not exist here, and a greyed row invites the user to work out what would re-enable it.
    const items = menuFor(undefined);
    expect(labels(items)).not.toContain('Zoom');
    expect(items.filter((i) => i.label === 'Zoom')).toEqual([]);
  });

  it('leaves the panels that DO zoom with all three commands and their chords', () => {
    // The other direction, so the gate cannot be satisfied by removing Zoom everywhere. The chords
    // are checked too: this menu is the panel's canonical index of what it can do, and an item that
    // does not name its key teaches nobody the key.
    for (const { kind, what, zooms } of KINDS.filter((k) => k.zooms)) {
      const zoom = menuFor(kind).find((i) => i.label === 'Zoom');
      expect(zooms).toBe(true);
      expect(zoom, `${what} lost its Zoom submenu`).toBeDefined();
      const shortcuts = (zoom?.submenu ?? []).map((i) => i.shortcut);
      expect(shortcuts.filter((s) => typeof s === 'string' && s.length > 0)).toHaveLength(3);
    }
  });
});

/**
 * 043 T172/T173 (FR-061) — a Find in Files panel is not renamable, and says so by ABSENCE.
 *
 * ══ WHY ABSENT AND NOT DISABLED, WHICH IS THE WHOLE OF THE REQUIREMENT ══
 *
 * Constitution VI again, and the same distinction the Zoom block above turns on: *disabled* means
 * "not right now", and it invites the user to work out what would re-enable it. Renaming this panel
 * is not temporarily unavailable — it is never meaningful, because the panel's identity IS its
 * query. FR-019 lets one Tab hold several of these and the term is the only thing that tells them
 * apart, so a user-chosen name would hide the one piece of information the header is there to give.
 *
 * This is a deliberate exception to the app-wide rule that every panel is renamable, which is
 * exactly why it is asserted rather than left to the reader of the builder: an omission and a
 * decision look identical in code, and the next person to notice Rename missing here should find a
 * test naming the requirement rather than what looks like a gap.
 *
 * Reset Name goes with it. It is Rename's undo, and offering an undo for something that cannot be
 * done is a stranger row than Rename itself would have been.
 */
describe('a Find in Files panel offers no rename in its header menu (FR-061)', () => {
  it('omits Rename', () => {
    expect(labels(menuFor(FIND_IN_FILES_KIND))).not.toContain('Rename');
  });

  it('omits Reset Name', () => {
    expect(labels(menuFor(FIND_IN_FILES_KIND))).not.toContain('Reset Name');
  });

  it('omits them rather than disabling them', () => {
    // The failure this catches is the easy half-fix: a `disabled: panel.kind === 'findInFiles'`,
    // which satisfies "the user cannot rename" and not the requirement.
    const items = menuFor(FIND_IN_FILES_KIND);
    expect(items.filter((i) => i.label === 'Rename' || i.label === 'Reset Name')).toEqual([]);
  });

  it('leaves every other kind renamable — the exception is one panel, not a retreat', () => {
    for (const { kind, what } of KINDS.filter((k) => k.kind !== FIND_IN_FILES_KIND)) {
      const l = labels(menuFor(kind));
      expect(l, `${what} lost Rename`).toContain('Rename');
      expect(l, `${what} lost Reset Name`).toContain('Reset Name');
    }
  });

  it('leaves the panel a menu that still does something, with no dangling divider', () => {
    /*
     * Losing the last item of a section must not leave the divider that separated it. `Rename` is
     * this kind's only `content` row, so removing it empties the menu's FIRST section — the one
     * shape in the app where a stray separator would put a rule at the very top of the menu. That is
     * `menu-sections.test.ts`'s business, and this panel's header is added to its table in the same
     * change; what is asserted here is the cheaper half — the menu is not left empty, and the rows a
     * user still needs are still on it.
     */
    const l = labels(menuFor(FIND_IN_FILES_KIND));
    expect(l).toContain('Send to Tab');
    expect(l).toContain('Destroy Panel');
    // Zoom stays: FR-062 gave this panel real zoom, so FR-062a now requires the commands rather than
    // forbidding them. Removing rename is not a retreat from the rest of the menu.
    expect(l).toContain('Zoom');
  });
});
