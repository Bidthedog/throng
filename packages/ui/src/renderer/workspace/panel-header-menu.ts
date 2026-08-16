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
 * | Content      | Rename, Save, Save As…, Revert, Reload from disk                                    |
 * | Destroy      | the panel's destroy verb                                                            |
 * | Navigate     | Reveal File in Files & Folders, Open in OS Explorer, Send to Tab, Sync to           |
 * | View & state | Reset Name, Zoom, Try again, Copy details, Clear panel type, Refresh / redraw       |
 *
 * *Destroy Panel* moves from last to the middle — the same shape the Files & Folders menu has always
 * had. *Reset Name* leaves Rename's side for View & state, where the constitution names it
 * explicitly. The editor and terminal conditionals are unchanged: an absent item is simply absent
 * from its group, and an empty group draws no divider.
 *
 * The action bodies stay at the call site, because several of them need a confirmation dialog, the
 * clipboard and the workspace store. What moved here is what the menu IS — its labels, icons,
 * shortcuts, conditions and sections — which is precisely what the unit table asserts.
 */
import { firstBinding, type Keybindings, type Panel } from '@throng/core';
import type { MenuAction } from './context-menu.js';

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
  revealInTree: () => void;
  openInOsExplorer: () => void;
  /** The failure banner's OWN retry, so FR-045 holds on the menu as well as on the button. */
  tryAgain: () => void;
  copyDetails: () => void;
  clearPanelType: () => void;
  redraw: () => void;
  sendToNewTab: () => void;
  sendToTab: (tabId: string) => void;
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

  const items: MenuAction[] = [
    {
      label: 'Rename',
      icon: 'rename',
      section: 'content',
      // The chord is SHOWN, not merely bound. A menu that offers an action without naming
      // its key teaches nobody the key, and this menu is the panel's canonical index of
      // what it can do (constitution v4.3.0).
      shortcut: firstBinding(keybindings, 'panel.rename'),
      onClick: () => actions.beginRename(),
    },
    // Undo a rename back to the panel's default name (a terminal then shows its live title
    // again). Disabled when there is nothing to reset.
    {
      label: 'Reset Name',
      icon: 'resetName',
      section: 'viewState',
      disabled: !(panel.titleIsCustom ?? false),
      onClick: () => actions.resetName(),
    },
    // Per-panel zoom (012) — zoom THIS panel's text independently of others.
    {
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
    },
  ];

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
    items.push({
      label: 'Refresh / redraw terminal',
      icon: 'retry',
      section: 'viewState',
      shortcut: firstBinding(keybindings, 'terminal.redraw'),
      onClick: () => actions.redraw(),
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
