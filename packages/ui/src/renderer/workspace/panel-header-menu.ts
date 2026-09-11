/**
 * A Panel's HEADER menu (033 US5, T062 — extracted from `panel-placeholder.tsx`).
 *
 * The panel's canonical index of what it can do (constitution v4.3.0): every discrete command and
 * state toggle a Panel offers appears here, whatever else also offers it. It was built inline in a
 * JSX `onContextMenu` handler, which is why SC-010 could not be asserted below E2E; the extraction
 * moves code without altering a label, an icon, an action or a condition (N6).
 *
 * The biggest restructure in the feature, and all of it is FR-047's fixed order rather than a fresh
 * opinion (contracts/menu-sections.md §3.4):
 *
 * | Section      | Items                                                                              |
 * |--------------|------------------------------------------------------------------------------------|
 * | Content      | Rename, Save, Save As…, Revert, Reload from disk, Find, Replace, Replace All        |
 * | Destroy      | the panel's destroy verb                                                            |
 * | Navigate     | Reveal File in Files & Folders, Open in OS Explorer, Send to Tab, Sync to           |
 * | View & state | Reset Name, Zoom, Try again, Copy details, Clear panel type, Refresh / redraw       |
 *
 * *Destroy Panel* moves from last to the middle — the same shape the Files & Folders menu has always
 * had. *Reset Name* leaves Rename's side for View & state, where the constitution names it
 * explicitly. The editor and terminal conditionals are unchanged: an absent item is simply absent
 * from its group, and an empty group draws no divider.
 *
 * TWO ROWS OF THAT TABLE ARE NOW CONDITIONAL ON THE PANEL'S KIND (043). *Zoom* is offered only where
 * a component renders the zoom level (FR-062a, `KINDS_THAT_ZOOM`), and *Rename* / *Reset Name* only
 * where the panel can be renamed at all (FR-061, `isRenamable`). Both are Constitution VI's
 * disabled-versus-absent rule, and between them they empty a whole section for two kinds — the Find
 * in Files panel loses `content` entirely, which is the only shape in the app whose FIRST section is
 * empty. `menu-sections.test.ts` pins it, so "an empty group draws no divider" is asserted on the
 * shape that actually exercises it rather than only stated here.
 *
 * The action bodies stay at the call site, because several of them need a confirmation dialog, the
 * clipboard and the workspace store. What moved here is what the menu IS — its labels, icons,
 * shortcuts, conditions and sections — which is precisely what the unit table asserts.
 */
import { firstBinding, type Keybindings, type Panel, type PanelKind } from '@throng/core';
import type { MenuAction } from './context-menu.js';

/**
 * The panel kinds that actually RENDER their zoom level (043 FR-062a, plan D2).
 *
 * `Panel.zoom` is persisted for every panel and the three chords resolve to whichever panel is
 * active, so the question was never whether the store can hold a level — it is whether anything
 * draws it. Only these read `panelZoomLevel(panel)` and do something visible with the answer:
 * `editor-panel.tsx` publishes `--throng-zoom-editor` for `editor.css` to multiply with,
 * `terminal-panel.tsx` rounds the font size by the factor before xterm measures its cells, and —
 * since FR-062 — `find-in-files-panel.tsx` publishes `--throng-zoom-fif` for its text and rounds its
 * results list's row height by the same factor.
 *
 * Gating the submenu on this set is Constitution VI's disabled-versus-absent rule, and it is stated
 * as a SET rather than as a `!== undefined` check because the untyped placeholder was only one of the
 * two offenders. FR-062a is worded generally on purpose: citing it to fix the Find in Files panel
 * while leaving the identical violation on the placeholder beside it would make the rule mean "this
 * panel", which is neither what it says nor why it was written.
 *
 * A kind that gains a zoom consumer is added here in the same change that adds the consumer;
 * `panel-header-zoom-menu.test.ts` restates the correspondence by hand and names the consumer for
 * each, so the two files have to move together.
 */
const KINDS_THAT_ZOOM: readonly PanelKind[] = ['editor', 'terminal', 'findInFiles'];

/**
 * Whether this panel can be renamed at all (043 FR-061).
 *
 * Every panel is renamable except one, and the exception is deliberate rather than an oversight: a
 * Find in Files panel's identity IS its query. FR-019 lets one Tab hold several of them and the
 * search term is the only thing that tells them apart, so a user-chosen name would hide the one
 * piece of information the header exists to give.
 *
 * ABSENT, not disabled (Constitution VI). Renaming here is not temporarily unavailable — it is never
 * meaningful — and a greyed row invites the user to work out what would re-enable it. Reset Name
 * goes with Rename: an undo offered for something that cannot be done is stranger than the thing
 * itself would have been.
 *
 * Exported because `panel-placeholder.tsx` asks the same question about the same panel for the OTHER
 * two routes into a rename — whether to register a starter for the chord, and whether a double-click
 * on the header opens the box. Three routes, one answer; a second copy of this predicate is how one
 * of them stays open.
 */
export function isRenamable(panel: Panel): boolean {
  return panel.kind !== 'findInFiles';
}

/** The editor state the menu's conditions read. `null` for a panel that is not an editor. */
export interface PanelHeaderEditorState {
  /** Unsaved changes — Revert is disabled without them, and Reload asks before discarding them. */
  dirty: boolean;
  /** Backed by a path on disk — the two reveal items exist only then, and Reload needs one. */
  hasFilePath: boolean;
}

export interface PanelHeaderDetachTarget {
  id: string;
  name: string;
  /** A Panel can live in a given sub-workspace only ONCE; if it is already there the row greys out. */
  alreadyHasPanel: boolean;
  tabs: readonly { id: string; title: string }[];
}

export interface PanelHeaderDetach {
  subWorkspaces: readonly PanelHeaderDetachTarget[];
  detachToNew: () => void;
  syncToExisting: (subWorkspaceId: string, tabId?: string) => void;
}

export interface PanelHeaderMenuActions {
  beginRename: () => void;
  resetName: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  save: () => void;
  saveAs: () => void;
  revert: () => void;
  reloadFromDisk: () => void;
  /** 039 FR-024 (#293): start a terminal Panel the user left dormant under Manual reload. */
  reloadTerminal: () => void;
  revealInTree: () => void;
  openInOsExplorer: () => void;
  /** The failure banner's OWN retry, so FR-045 holds on the menu as well as on the button. */
  tryAgain: () => void;
  copyDetails: () => void;
  clearPanelType: () => void;
  redraw: () => void;
  sendToNewTab: () => void;
  sendToTab: (tabId: string) => void;
  /** 043 FR-015 — open this panel's find bar. Editors and terminals both search. */
  find: () => void;
  /** 043 FR-015 — open it with the replace row revealed. Editor only (FR-013). */
  replace: () => void;
  /** 043 FR-015 — replace every match in this panel's document. Editor only (FR-013). */
  replaceAll: () => void;
  destroy: () => void;
}

export interface PanelHeaderMenuArgs {
  panel: Panel;
  /** "Destroy", or "Close" for a project Panel viewed inside a sub-workspace window. */
  panelVerb: string;
  /** The live chords, so a rebind moves what the menu SHOWS as well as what the key does. */
  keybindings: Keybindings;
  /** The other Tabs in this window, for Send to Tab. */
  otherTabs: readonly { id: string; title: string }[];
  editor: PanelHeaderEditorState | null;
  /** True while the editor's failure banner is up — the only state its three commands mean anything. */
  editorFailure: boolean;
  /** `null` inside a sub-workspace window, where syncing onward is not offered. */
  detach: PanelHeaderDetach | null;
  actions: PanelHeaderMenuActions;
}

export function panelHeaderMenu(args: PanelHeaderMenuArgs): MenuAction[] {
  const { panel, panelVerb, keybindings, otherTabs, editor, editorFailure, detach, actions } = args;

  const items: MenuAction[] = [];

  if (isRenamable(panel)) {
    items.push({
      label: 'Rename',
      icon: 'rename',
      section: 'content',
      // The chord is SHOWN, not merely bound. A menu that offers an action without naming
      // its key teaches nobody the key, and this menu is the panel's canonical index of
      // what it can do (constitution v4.3.0).
      shortcut: firstBinding(keybindings, 'panel.rename'),
      onClick: () => actions.beginRename(),
    });
    // Undo a rename back to the panel's default name (a terminal then shows its live title
    // again). Disabled when there is nothing to reset.
    items.push({
      label: 'Reset Name',
      icon: 'resetName',
      section: 'viewState',
      disabled: !(panel.titleIsCustom ?? false),
      onClick: () => actions.resetName(),
    });
  }

  // Per-panel zoom (012) — zoom THIS panel's text independently of others. Offered only on the kinds
  // that render it (FR-062a): see KINDS_THAT_ZOOM above for why this is a gate and not a comment.
  if (panel.kind !== undefined && KINDS_THAT_ZOOM.includes(panel.kind)) {
    items.push({
      label: 'Zoom',
      icon: 'zoomIn',
      section: 'viewState',
      submenu: [
        {
          label: 'Zoom In',
          icon: 'zoomIn',
          section: 'viewState',
          shortcut: firstBinding(keybindings, 'panel.zoomIn'),
          onClick: () => actions.zoomIn(),
        },
        {
          label: 'Zoom Out',
          icon: 'zoomOut',
          section: 'viewState',
          shortcut: firstBinding(keybindings, 'panel.zoomOut'),
          onClick: () => actions.zoomOut(),
        },
        {
          label: 'Reset Zoom',
          icon: 'zoomReset',
          section: 'viewState',
          shortcut: firstBinding(keybindings, 'panel.zoomReset'),
          onClick: () => actions.resetZoom(),
        },
      ],
    });
  }

  if (panel.kind === 'editor') {
    // Editor Panels: Save (== Ctrl+S, FR-076) and Revert-all-changes with a
    // confirmation (FR-075). Revert is disabled when there is nothing to undo.
    items.push({
      label: 'Save',
      icon: 'send',
      section: 'content',
      shortcut: firstBinding(keybindings, 'editor.save'),
      onClick: () => actions.save(),
    });
    items.push({
      label: 'Save As…',
      icon: 'send',
      section: 'content',
      shortcut: firstBinding(keybindings, 'editor.saveAs'),
      onClick: () => actions.saveAs(),
    });
    items.push({
      label: 'Revert',
      icon: 'rename',
      section: 'content',
      disabled: !editor?.dirty,
      onClick: () => actions.revert(),
    });
    /**
     * Reload from disk (027 / #161, FR-013) — a NEW action ALONGSIDE Revert, not a rename of it.
     * They read different sources of truth: Revert restores throng's cached copy of what the file
     * last held and refuses when the file is gone; this re-READS the path, which is the only thing
     * that rescues a stranded editor. Enabled even with no unsaved changes: "the file changed
     * underneath me, show me what it says now" is a legitimate ask.
     *
     * Menu-only, with no ActionId. Minting one would oblige a default chord, a COMMAND_SCOPES entry
     * and a KEYBINDINGS_METADATA descriptor (the completeness gate asserts every ActionId is
     * described) for a recovery action always reached from a panel already under the pointer.
     */
    items.push({
      label: 'Reload from disk',
      icon: 'retry',
      section: 'content',
      disabled: !editor?.hasFilePath,
      onClick: () => actions.reloadFromDisk(),
    });

    // US6 (#137) — for a panel backed by an on-disk file: reveal it in throng's own
    // Files & Folders tree, and open its folder in the OS file manager (via the seam).
    if (editor?.hasFilePath) {
      items.push({
        label: 'Reveal File in Files & Folders',
        section: 'navigate',
        onClick: () => actions.revealInTree(),
      });
      items.push({
        label: 'Open in OS Explorer',
        section: 'navigate',
        onClick: () => actions.openInOsExplorer(),
      });
    }

    /*
     * 030 FR-042c — the failure banner's OWN three commands, in the panel's own menu.
     *
     * The Constitution binds a feature that adds a panel action to add its menu item in the same
     * increment: an action reachable only as an icon on a banner is unreachable from where users
     * look for panel commands, and undiscoverable by anyone who does not recognise the glyph.
     *
     * Shown only while the banner is, because that is the only state in which any of them is
     * meaningful — and the LABELS are the banner's, unchanged (FR-042d), which is what makes them
     * the same command rather than a second one that looks like it. *Try again* therefore sits
     * beside *Reload from disk* while a file is unreadable: they run the same re-read, and the
     * duplication is the price of each surface naming its own command consistently.
     */
    if (editorFailure) {
      items.push({
        label: 'Try again',
        icon: 'retry',
        section: 'viewState',
        onClick: () => actions.tryAgain(),
      });
      items.push({
        // Copy is not an exception for being "just a copy button". It is a discrete command acting
        // on a Panel, and a copy control reachable only as a glyph on a banner is unreachable to
        // anyone who does not recognise the glyph. The text is the BANNER'S, assembled once.
        label: 'Copy details',
        icon: 'copy',
        section: 'viewState',
        onClick: () => actions.copyDetails(),
      });
      items.push({
        label: 'Clear panel type',
        icon: 'dismiss',
        section: 'viewState',
        onClick: () => actions.clearPanelType(),
      });
    }
  }

  /*
   * 028 (issue 163) — Terminal Panels: the deliberate version of the divider nudge users
   * discovered by accident. Present on BOTH this menu and the terminal's own right-click menu,
   * under the same name, because a user hunting for it will open whichever menu is nearest.
   *
   * It asks the running program to redraw. Nothing about the terminal's content, scrollback,
   * selection, cursor, focus or the layout changes, and nothing is typed at the shell.
   */
  if (panel.kind === 'terminal') {
    /*
     * 039 FR-024 (#293) — Reload, for a terminal Panel left dormant by Manual reload mode.
     *
     * The constitution binds a feature that adds a panel action to add its menu item in the same
     * increment, and the placeholder's button is exactly such an action. The LABEL is the
     * placeholder's, unchanged, so the two surfaces name one command rather than two that resemble
     * each other — the same rule *Try again* follows above.
     *
     * Deliberately NOT with the failure items in the editor block above: a dormant Panel has not
     * failed (FR-029), and sitting Reload beside *Try again* and *Copy details* would imply it had.
     * It was first written there by mistake and the tests caught it — inside `panel.kind ===
     * 'editor'` it could never fire for a terminal at all.
     */
    if (panel.dormant === true) {
      items.push({
        label: 'Reload',
        icon: 'retry',
        section: 'viewState',
        onClick: () => actions.reloadTerminal(),
      });
    }
    items.push({
      label: 'Refresh / redraw terminal',
      icon: 'retry',
      section: 'viewState',
      shortcut: firstBinding(keybindings, 'terminal.redraw'),
      onClick: () => actions.redraw(),
    });
  }

  /*
   * 043 FR-015 — the panel's SEARCH commands, in the panel's own menu.
   *
   * The constitution names `search.find`, `search.replace` and `search.replaceAll` as pre-existing
   * gaps in "every panel action has a menu item", to be closed by tracked work; this is that work.
   * Until now each was reachable only by a chord, so a user who had not read the key bindings could
   * not discover that a panel searched at all — and this menu, which is the panel's canonical index
   * of what it can do, did not list them.
   *
   * `content`, not `viewState`: all three act on the panel's TEXT. Find moves the caret through it
   * and Replace rewrites it, which is the same test that puts Save and Revert in the same group.
   *
   * Only a panel with a kind gets them — there is nothing to search in an untyped placeholder — and
   * a terminal gets Find alone, because its find is read-only (FR-013) and `search.replace`'s chord
   * is already inert there. Offering Replace on a terminal would index a command it does not have.
   *
   * Stepping through matches and closing the bar are deliberately absent: FR-015 keeps them exempt
   * as navigational input, the same exemption scroll and column-select hold.
   */
  if (panel.kind === 'editor' || panel.kind === 'terminal') {
    items.push({
      label: 'Find',
      icon: 'search',
      section: 'content',
      shortcut: firstBinding(keybindings, 'search.find'),
      onClick: () => actions.find(),
    });
  }
  if (panel.kind === 'editor') {
    items.push({
      label: 'Replace',
      icon: 'replace',
      section: 'content',
      shortcut: firstBinding(keybindings, 'search.replace'),
      onClick: () => actions.replace(),
    });
    items.push({
      label: 'Replace All',
      icon: 'replaceAll',
      section: 'content',
      shortcut: firstBinding(keybindings, 'search.replaceAll'),
      onClick: () => actions.replaceAll(),
    });
  }

  items.push({
    label: 'Send to Tab',
    icon: 'send',
    section: 'navigate',
    submenu: [
      // New Tab == dragging the Panel onto the tab-strip `+` (005 FR-027).
      { label: 'New Tab', icon: 'add', section: 'navigate', onClick: () => actions.sendToNewTab() },
      ...otherTabs.map((t) => ({
        label: t.title,
        icon: 'tab',
        section: 'navigate' as const,
        onClick: () => actions.sendToTab(t.id),
      })),
    ],
  });

  // Sync (clone) this Panel into a sub-workspace (US7). Hidden in sub-workspace
  // windows (no detach context). "New Window" creates a new sub-workspace; an
  // existing one → choose a Tab within it ("New" makes a fresh Tab). Cloning
  // leaves the Panel in the main project.
  if (detach) {
    items.push({
      label: 'Sync to',
      icon: 'send',
      section: 'navigate',
      submenu: [
        {
          label: 'New Sub-workspace',
          icon: 'detach',
          section: 'navigate',
          onClick: () => detach.detachToNew(),
        },
        // A Panel can live in a given sub-workspace only ONCE: if it's already
        // there, the entry is greyed out (no submenu).
        ...detach.subWorkspaces.map((s): MenuAction => {
          if (s.alreadyHasPanel) {
            return { label: s.name, icon: 'tab', section: 'navigate', disabled: true };
          }
          return {
            label: s.name,
            icon: 'tab',
            section: 'navigate',
            submenu: [
              {
                label: 'New Tab',
                icon: 'add',
                section: 'navigate',
                onClick: () => detach.syncToExisting(s.id),
              },
              ...s.tabs.map((t) => ({
                label: t.title,
                icon: 'tab',
                section: 'navigate' as const,
                onClick: () => detach.syncToExisting(s.id, t.id),
              })),
            ],
          };
        }),
      ],
    });
  }

  items.push({
    label: `${panelVerb} Panel`,
    icon: 'destroy',
    section: 'destroy',
    onClick: () => actions.destroy(),
  });

  return items;
}
