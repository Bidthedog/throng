/**
 * A Panel's HEADER menu (033 US5, T062 — extracted from `panel-placeholder.tsx`).
 *
 * The panel's canonical index of what it can do (constitution v4.3.0): every discrete command and
 * state toggle a Panel offers appears here, whatever else also offers it. It was built inline in a
 * JSX `onContextMenu` handler, which is why SC-010 could not be asserted below E2E; the extraction
 * moves code without altering a label, an icon, an action or a condition (N6).
 *
 * The groups, in the order the shared section order draws them (v1 review T1 regrouped 033's contracts/menu-sections.md
 * §3.4 shape and put Destroy last in every menu):
 *
 * | Group                | Section, group      | Items                                                              |
 * |----------------------|---------------------|--------------------------------------------------------------------|
 * | The document         | Content             | Save, Save As…, Revert, Reload from disk                           |
 * | The document's file  | Navigate            | Find in File Explorer, Open in OS Explorer, Open in OS Default     |
 * |                      |                     | Program, Copy Path ▸, Open Preview / Open in Editor, Back, Forward, |
 * |                      |                     | Print…                                                             |
 * | This panel type only | View & state, `panelType` | Set Language…, Reset Language, Encoding ▸, Line Endings ▸;   |
 * |                      |                     | Edit Long Cells in Dialog; a terminal's Remember / Notifications   |
 * | The panel itself     | View & state        | Split ▸, Send to Tab, Sync to, Refresh, Reload, Focus Mode, Zoom,  |
 * |                      |                     | Refresh / redraw terminal, Synchronise Scrolling, Flag, the        |
 * |                      |                     | failure banner's three                                             |
 * | Closing it           | Destroy             | the panel's removal verb, last                                     |
 *
 * v1 review (#732), the maintainer's rule for every panel menu: this menu holds the panel, its file and its link to
 * other panels; the body menu holds what acts on the content under the pointer and how the body shows it. So Find,
 * Replace, Replace All, Go to Heading / Page / Row… and a grid's Wrap and locks moved to the body menus, and the
 * format rows, Copy Path, a CSV file's Save and Save As…, and a terminal's toggles and start-failure rows moved here.
 *
 * The conditionals are unchanged: an absent item is simply absent from its group, and an empty group draws no
 * divider.
 *
 * 048 REMOVED *Rename* and *Reset Name* (FR-030): a panel is named by what it holds, so no menu, chord
 * or gesture renames one. It ADDED *Split*, on every kind.
 *
 * *Zoom* is conditional on the PANEL'S KIND (043): it is offered only where
 * a component renders the zoom level (FR-062a, `KINDS_THAT_ZOOM`). That is Constitution VI's
 * disabled-versus-absent rule, and it can empty a whole section — the Find
 * in Files panel has no `content` at all, which is the only shape in the app whose FIRST section is
 * empty. `menu-sections.test.ts` pins it, so "an empty group draws no divider" is asserted on the
 * shape that actually exercises it rather than only stated here.
 *
 * 044 ADDS A KIND AND THREE ROWS (contracts/menus-and-controls.md §1–§2). An editor gains *Open
 * Preview*, *Back* and *Forward* in Navigate; a preview panel draws its own shape — no Content at all,
 * *Close Panel*, the reveal rows, *Open in Editor*, *Back*, *Forward*, the send rows,
 * then *Refresh* and *Zoom* — and carries the failure banner's three commands while ITS banner is up.
 * The builder names no provider: a preview's rows read its provider KIND, and Open Preview reads
 * core's `previewAffordance`, both handed in (preview-provider-seam.md §3).
 *
 * 044's 2026-09-16 iteration adds one View & state row to both (§1, §2, §10): *Synchronise Scrolling*,
 * after *Zoom* and before the banner items, on an editor wherever Open Preview is drawn and on every
 * text-provider preview (FR-122a, FR-122b).
 *
 * The action bodies stay at the call site, because several of them need a confirmation dialog, the
 * clipboard and the workspace store. What moved here is what the menu IS — its labels, icons,
 * shortcuts, conditions and sections — which is precisely what the unit table asserts.
 */
import {
  firstBinding,
  PREVIEW_KIND,
  type IconKey,
  type Keybindings,
  type Panel,
  type PanelKind,
  type PreviewAffordance,
  type PreviewProviderKind,
  type SplitDirection,
  supportsScrollSync,
  previewIconOf,
} from '@throng/core';
import type { MenuAction } from './context-menu.js';
import { PRINT_UNAVAILABLE } from '../preview/print/print-command.js';
import { splitSubmenu } from './split-menu.js';
import { isPanelSectionMaximised, isPanelTabMaximised } from './maximise-store.js';
import { copyPathSubmenu, type PathForms } from '../common/copy-path-menu.js';
import { editorFormatItems, type EditorFormatMenuArgs } from '../editor/content-menu.js';
import type { TerminalMenuToggle } from '../terminal/terminal-content-menu.js';

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
const KINDS_THAT_ZOOM: readonly PanelKind[] = ['editor', 'terminal', 'findInFiles', PREVIEW_KIND];

/**
 * The verb a panel's removal is offered under (011 FR-030).
 *
 * A preview is always CLOSED, never destroyed, whoever owns it (044 FR-033): closing it loses nothing
 * — it owns no document and no session (FR-042) — and "Destroy" would claim otherwise. Every other
 * kind takes the ownership verb the caller computed. Exported so the header's ✕ and this menu say the
 * same word.
 */
export function removalVerbFor(panel: Panel, ownershipVerb: string): string {
  return panel.kind === PREVIEW_KIND ? 'Close' : ownershipVerb;
}

/** The editor state the menu's conditions read. `null` for a panel that is not an editor. */
export interface PanelHeaderEditorState {
  /** Unsaved changes — Revert is disabled without them, and Reload asks before discarding them. */
  dirty: boolean;
  /** Backed by a path on disk — the own-file rows are disabled without one (081 FR-041), and Reload needs one. */
  hasFilePath: boolean;
  /** 050 FR-036 — the file moved to another project: Save is disabled, Save As stays. */
  movedOut?: boolean;
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
  /** 048 FR-015 — split THIS panel toward `direction` (the Split submenu's four rows). */
  split: (direction: SplitDirection) => void;
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
  /** 067 FR-016 — open the panel's file with the OS default program. */
  openInDefaultProgram: () => void;
  /** The failure banner's OWN retry, so FR-045 holds on the menu as well as on the button. */
  tryAgain: () => void;
  copyDetails: () => void;
  clearPanelType: () => void;
  redraw: () => void;
  sendToNewTab: () => void;
  sendToTab: (tabId: string) => void;
  destroy: () => void;
  /** 044 FR-002 — an editor's Open Preview (`preview.open`). */
  openPreview: () => void;
  /** 044 FR-111 — this panel's Back, on an editor or a preview. */
  navigateBack: () => void;
  /** 044 FR-111 — this panel's Forward, on an editor or a preview. */
  navigateForward: () => void;
  /** 044 FR-028 — a preview's Refresh. */
  refreshPreview: () => void;
  /**
   * 075 FR-061 — a preview's Print… (`preview.print`), or an editor's (`editor.print`). Optional: absent, the row is
   * not drawn. A terminal never draws it.
   */
  print?: () => void;
  /** 044 FR-015c — a standalone text preview's route to an editor. */
  openInEditor: () => void;
  /** 044 FR-015d — a parented text preview's route to its editor. */
  goToEditor: () => void;
  /** 044 FR-122 — flip `editor.previews.syncScroll` (`toggleSyncScroll`, the one command body). */
  toggleSyncScroll: () => void;
  /** 073 FR-036b — flip this panel's own choice to offer the cell dialog (persisted with the panel). */
  toggleCellDialog: () => void;
  /** 057 FR-125 — raise a user-flagged Attention mark on this panel (`attention.flag`). */
  flag: () => void;
  /** The v1 review's Unflag — clear the mark this panel holds. */
  unflag: () => void;
}

/** What a PREVIEW panel's menu reads. `null` for a panel that is not a preview. */
export interface PanelHeaderPreviewState {
  /** A binary provider has no editor to open or go to (044 FR-015e, FR-073). */
  providerKind: PreviewProviderKind;
  /** Parented → *Open in Editor* goes to the parent; standalone → it opens or focuses one (FR-015c, FR-015d). */
  parented: boolean;
  /** 054 — `false` for a provider that draws one picture (Mermaid): no Synchronise Scrolling. Absent reads `true`. */
  flowingDocument?: boolean;
  /** 073 FR-033c — the provider's preview scrolls in step with its editor (Synchronise Scrolling). Absent reads `flowingDocument`. */
  scrollSync?: boolean;
  /** 073 FR-036b — the provider has a cell dialog; `on` is whether it is on for this panel (its own choice, else the setting). */
  cellDialog?: { on: boolean };
  /**
   * 073 FR-030 — the preview EDITS its document (the CSV Preview Editor): Save and Save As… are drawn, running the
   * document's own save (v1 review, #732, moved from its grid menus). Absent reads `false`.
   */
  editable?: boolean;
  /** 075 FR-062 — whether its provider prints. Absent reads `false`: Print… is drawn disabled with the reason. */
  printable?: boolean;
  /** 081 FR-041 — the preview knows its file. Absent reads `true`; `false` draws the own-file rows disabled. */
  hasFilePath?: boolean;
}

/**
 * Whether this panel's navigation history has somewhere to go (044 FR-111). `null` when none is known,
 * which draws both items DISABLED — they are never hidden on an editor or a preview (FR-104).
 */
export interface PanelHeaderHistoryState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PanelHeaderMenuArgs {
  panel: Panel;
  /** The panel holds an Attention mark now (any kind): its Flag row reads Unflag and clears it. */
  flagged?: boolean;
  /** "Destroy", or "Close" for a project Panel viewed inside a sub-workspace window. */
  panelVerb: string;
  /** The live chords, so a rebind moves what the menu SHOWS as well as what the key does. */
  keybindings: Keybindings;
  /** The other Tabs in this window, for Send to Tab. */
  otherTabs: readonly { id: string; title: string; disabled?: boolean }[];
  editor: PanelHeaderEditorState | null;
  /**
   * True while the panel's `PanelFailureBanner` is up — an editor's OR a preview's (044, renamed from
   * `editorFailure`, which would now lie about its scope). The only state the banner's three commands
   * mean anything in.
   */
  panelFailure: boolean;
  /** `null` inside a sub-workspace window, where syncing onward is not offered. */
  detach: PanelHeaderDetach | null;
  /** 044 — a preview's provider kind and parented state. Omitted or `null` for any other kind. */
  preview?: PanelHeaderPreviewState | null;
  /** 044 FR-111 — an editor's or preview's history ends. Omitted or `null`: both items disabled. */
  history?: PanelHeaderHistoryState | null;
  /**
   * 044 FR-002 — an editor's Open Preview, drawn from core's `previewAffordance` (never from a named
   * provider, contracts/preview-provider-seam.md §3). Omitted means `absent`.
   */
  openPreview?: PreviewAffordance;
  /**
   * 044 FR-122b — whether scroll sync is ON (`editor.previews.syncScroll`), which checks the item. WHERE the
   * item appears is not this flag's business: an editor shows it exactly where Open Preview is drawn, a
   * preview exactly when its provider is `text` (FR-122a). Omitted reads as off.
   */
  syncScroll?: boolean;
  /** 067 FR-021 — `explorer.showOpenInOsDefaultProgram`. Omitted reads as shown. */
  showOpenInDefaultProgram?: boolean;
  /**
   * 054 FR-071 — whether THIS panel is the maximised one, and the toggle. Every real panel passes it; a
   * builder called without it (the menu tables drive the builder directly) draws no row.
   */
  maximise?: { maximised: boolean; toggle: () => void } | null;
  /**
   * 074 FR-028, FR-068a (amended by the v1 review, #732) — the panel's file in the File Explorer's four forms, for an
   * editor or a preview whose file is inside the project: Copy Path ▸ is drawn. Omitted or `null`: none.
   */
  copyPath?: PathForms | null;
  /** v1 review (#732) — an editor's format rows, moved from its body menu. Omitted or `null`: none. */
  editorFormat?: EditorFormatMenuArgs | null;
  /**
   * 076 FR-005 (amended by the v1 review, #732) — a terminal's per-panel toggles, in status-bar order, moved from its
   * body menu. Omitted or `null`: none.
   */
  terminalToggles?: readonly TerminalMenuToggle[] | null;
  actions: PanelHeaderMenuActions;
}

export const FIND_IN_FILE_EXPLORER_LABEL = 'Find in File Explorer';
export const OPEN_IN_OS_EXPLORER_LABEL = 'Open in OS Explorer';
export const OPEN_IN_DEFAULT_PROGRAM_LABEL = 'Open in OS Default Program';

/** Whether the panel's own-file rows and title-bar buttons can act, and the hover text each carries. */
export interface PanelFileActionState {
  disabled: boolean;
  /** The row's or button's hover title: the label, or why it is unavailable. */
  titleFor: (label: string) => string;
}

/**
 * 081 FR-041 — one answer for the menu rows and the title-bar buttons (`panel-header-file-icons.tsx`), so the two
 * are disabled together and give the same reason. A panel with no file draws them disabled rather than absent
 * (Principle VI).
 */
export function panelFileActionState(hasFilePath: boolean, isPreview: boolean): PanelFileActionState {
  if (hasFilePath) return { disabled: false, titleFor: (label) => label };
  const why = isPreview ? 'this preview has no file yet.' : 'this document has no file yet. Save it first.';
  return { disabled: true, titleFor: (label) => `${label} is unavailable: ${why}` };
}

/**
 * The panel's own-file rows in Navigate: Find in File Explorer (081 FR-044, renamed from 046's Reveal File in File
 * Explorer), Open in OS Explorer, and Open in OS Default Program unless `explorer.showOpenInOsDefaultProgram` is off
 * (067 FR-021). Each row is drawn disabled with its reason while there is no file (081 FR-041).
 */
function fileItems(args: PanelHeaderMenuArgs, state: PanelFileActionState): MenuAction[] {
  const { actions } = args;
  const row = (label: string, onClick: () => void, icon?: IconKey): MenuAction => ({
    label,
    ...(icon ? { icon } : {}),
    section: 'navigate',
    ...(state.disabled ? { disabled: true, title: state.titleFor(label) } : {}),
    onClick,
  });
  const items = [
    row(FIND_IN_FILE_EXPLORER_LABEL, () => actions.revealInTree(), 'findInFileExplorer'),
    row(OPEN_IN_OS_EXPLORER_LABEL, () => actions.openInOsExplorer()),
  ];
  if (args.showOpenInDefaultProgram ?? true) {
    items.push(row(OPEN_IN_DEFAULT_PROGRAM_LABEL, () => actions.openInDefaultProgram(), 'openInDefaultProgram'));
  }
  return items;
}

/**
 * Back and Forward (044 FR-111) — Navigate, with the chords the header buttons show and the enabled
 * state the history gives. Drawn on every editor and preview, disabled at the ends (FR-104).
 */
function historyItems(
  history: PanelHeaderHistoryState | null | undefined,
  keybindings: Keybindings,
  actions: PanelHeaderMenuActions,
): MenuAction[] {
  return [
    {
      label: 'Back',
      icon: 'navigateBack' as const,
      section: 'navigate',
      shortcut: firstBinding(keybindings, 'navigate.back'),
      disabled: !(history?.canGoBack ?? false),
      onClick: () => actions.navigateBack(),
    },
    {
      label: 'Forward',
      icon: 'navigateForward' as const,
      section: 'navigate',
      shortcut: firstBinding(keybindings, 'navigate.forward'),
      disabled: !(history?.canGoForward ?? false),
      onClick: () => actions.navigateForward(),
    },
  ];
}

/*
 * 030 FR-042c — the failure banner's OWN three commands, in the panel's own menu.
 *
 * The Constitution binds a feature that adds a panel action to add its menu item in the same
 * increment: an action reachable only as an icon on a banner is unreachable from where users look for
 * panel commands, and undiscoverable by anyone who does not recognise the glyph.
 *
 * Shown only while the banner is, because that is the only state in which any of them is meaningful —
 * and the LABELS are the banner's, unchanged (FR-042d), which is what makes them the same command
 * rather than a second one that looks like it. *Try again* therefore sits beside *Reload from disk*
 * while a file is unreadable: they run the same re-read, and the duplication is the price of each
 * surface naming its own command consistently.
 *
 * 044 — a preview carries the same three while ITS banner is up (FR-033); what each does on a preview
 * is the call site's business, through the preview's own paths (contracts/menus-and-controls.md §1).
 */
function failureItems(actions: PanelHeaderMenuActions): MenuAction[] {
  return [
    {
      label: 'Try again',
      icon: 'retry' as const,
      section: 'viewState',
      onClick: () => actions.tryAgain(),
    },
    {
      // Copy is not an exception for being "just a copy button". It is a discrete command acting on a
      // Panel, and a copy control reachable only as a glyph on a banner is unreachable to anyone who
      // does not recognise the glyph. The text is the BANNER'S, assembled once.
      label: 'Copy details',
      icon: 'copy' as const,
      section: 'viewState',
      onClick: () => actions.copyDetails(),
    },
    {
      label: 'Clear panel type',
      icon: 'dismiss' as const,
      section: 'viewState',
      onClick: () => actions.clearPanelType(),
    },
  ];
}

/**
 * Synchronise Scrolling (044 FR-122b; contracts/menus-and-controls.md §10) — View & state, after Zoom and
 * before the failure-banner items. A checked toggle in the Word Wrap idiom: the state is the item's `checked` flag and the test
 * id is pinned to the bare label. Never disabled (FR-122a).
 */
function syncScrollItem(on: boolean, keybindings: Keybindings, actions: PanelHeaderMenuActions): MenuAction {
  return {
    label: 'Synchronise Scrolling',
    checked: on,
    testId: 'menu-item-Synchronise Scrolling',
    icon: 'syncScroll' as const,
    section: 'viewState',
    shortcut: firstBinding(keybindings, 'preview.toggleSyncScroll'),
    onClick: () => actions.toggleSyncScroll(),
  };
}

export function panelHeaderMenu(args: PanelHeaderMenuArgs): MenuAction[] {
  const { panel, keybindings, otherTabs, editor, panelFailure, detach, actions } = args;
  const panelVerb = removalVerbFor(panel, args.panelVerb);
  const isPreview = panel.kind === PREVIEW_KIND;
  // 054 FR-074 — while the tab is maximised the panel cannot leave it or be destroyed: Send to Tab, Sync to
  // and Destroy are drawn disabled (Principle VI), as Split is by its own builder.
  const modal = isPanelTabMaximised(panel.id);
  const lockedOut = modal ? { disabled: true } : {};
  // An inline diagram of this preview is maximised over its document: Print… and Synchronise Scrolling have nothing
  // visible to act on.
  const documentCovered = isPanelSectionMaximised(panel.id) ? { disabled: true } : {};

  /*
   * v1 review T1 — the menu is drawn as four groups: what acts on the document or file shown (`items`: Content, then
   * Navigate), what only this panel type has (`typeRows`), what acts on the panel itself (`layoutRows`, then
   * `panelRows`), and the close row. The type and panel-level groups share View & state and are told apart by
   * `group`, so `withDividers` draws one divider between them and none inside either.
   */
  const items: MenuAction[] = [];
  const typeRows: MenuAction[] = [];
  const typeRow = (row: Omit<MenuAction, 'section'>): MenuAction => ({ ...row, section: 'viewState', group: 'panelType' });
  const layoutRows: MenuAction[] = [];
  const panelRows: MenuAction[] = [];

  /*
   * 044 FR-033 — a PREVIEW's own rows (contracts/menus-and-controls.md §1).
   *
   * Emitted before the Zoom block for one reason: among the panel-level rows the contract draws *Refresh*
   * ahead of *Zoom*, and a group keeps the order its rows were emitted in.
   *
   * Content is EMPTY by construction: a preview is read-only (FR-020) and not renamable (FR-030), so
   * nothing that edits text or a name belongs to it — Rename, Save, Revert and Reload are all absent
   * rather than disabled. A preview shows a file, so its own-file rows are live once it knows the path.
   *
   * v1 review (#732) — Find… and Go to Heading / Page / Row… act on the content, so they are the body menu's alone
   * (047 FR-007 and 074 FR-062b, amended). The CSV Preview Editor's Save and Save As… are the exception to an empty
   * Content: that preview edits its document (073 FR-030).
   */
  if (isPreview) {
    // 067 FR-016, FR-017 — in the shared preview title menu, so a provider needs no code of its own.
    items.push(...fileItems(args, panelFileActionState(args.preview?.hasFilePath ?? true, true)));
    // 074 FR-028, FR-068a — Copy Path, for a file inside the project (v1 review, #732: from the body menu).
    if (args.copyPath) items.push(copyPathSubmenu(args.copyPath, 'navigate'));
    // 073 FR-030 — the CSV Preview Editor's own document: Save and Save As… (v1 review, #732: from its grid menus).
    if (args.preview?.editable === true) {
      items.push(
        { label: 'Save', icon: 'save' as const, section: 'content', shortcut: firstBinding(keybindings, 'editor.save'), onClick: () => actions.save() },
        { label: 'Save As…', icon: 'saveAs' as const, section: 'content', shortcut: firstBinding(keybindings, 'editor.saveAs'), onClick: () => actions.saveAs() },
      );
    }
    // FR-015b/c/d — the mirror image of an editor's Open Preview. A binary provider has no editor at
    // all (FR-015e), so neither form is offered for one.
    if (args.preview?.providerKind === 'text') {
      // 050 R26 — unavailable while the file is moved out (the layout's flag, which main's moved-out
      // report is mirrored into): the row stays, disabled, like every other state-dependent command.
      const disabled = (args.panel.config as { movedOut?: unknown } | undefined)?.movedOut === true;
      // v1 review (#732): one label whether or not the preview is parented; a parented one's row goes to its editor.
      const parented = args.preview.parented;
      items.push({
        label: 'Open in Editor',
        icon: 'editorPanel' as const,
        section: 'navigate',
        disabled,
        onClick: () => (parented ? actions.goToEditor() : actions.openInEditor()),
      });
    }
    items.push(...historyItems(args.history, keybindings, actions));
    // 075 FR-061 – FR-063 — Print…, on every preview; disabled, with the reason, when its provider cannot print.
    if (actions.print !== undefined) {
      const print = actions.print;
      const printable = args.preview?.printable === true;
      items.push({
        label: 'Print…',
        icon: 'print' as const,
        section: 'navigate',
        group: 'print',
        shortcut: firstBinding(keybindings, 'preview.print'),
        ...(printable ? documentCovered : { disabled: true, title: PRINT_UNAVAILABLE }),
        onClick: () => print(),
      });
    }
    panelRows.push({
      label: 'Refresh',
      icon: 'refresh' as const,
      section: 'viewState',
      onClick: () => actions.refreshPreview(),
    });
  }

  /*
   * 048 FR-015 — Split, on every panel kind: a submenu of the four split commands, each showing its current chord.
   * The same builder feeds the content menus and the **+** button, where it stays in Create; here v1 review T1 puts
   * it first among the panel-level rows. (Rename and Reset Name are gone — a panel is named by what it holds, FR-030.)
   */
  layoutRows.push({
    ...splitSubmenu(panel.id, keybindings, (_id, direction) => actions.split(direction)),
    section: 'viewState',
  });

  /*
   * 054 FR-071, FR-077 — Maximise Panel / Restore Panel, View & state, on every kind: the header control's
   * and `panel.toggleMaximise`'s menu item. Emitted ahead of Zoom (and after a preview's Refresh).
   */
  if (args.maximise) {
    const { maximised, toggle } = args.maximise;
    panelRows.push({
      // Named for the feature (FR-078, manual test change request 2026-10-12).
      label: maximised ? 'Exit Focus Mode' : 'Enter Focus Mode',
      icon: maximised ? 'panelRestore' : 'panelMaximise',
      section: 'viewState',
      shortcut: firstBinding(keybindings, 'panel.toggleMaximise'),
      onClick: () => toggle(),
    });
  }

  // Per-panel zoom (012) — zoom THIS panel's text independently of others. Offered only on the kinds
  // that render it (FR-062a): see KINDS_THAT_ZOOM above for why this is a gate and not a comment.
  if (panel.kind !== undefined && KINDS_THAT_ZOOM.includes(panel.kind)) {
    panelRows.push({
      label: 'Zoom',
      icon: 'zoomIn' as const,
      section: 'viewState',
      submenu: [
        {
          label: 'Zoom In',
          icon: 'zoomIn' as const,
          section: 'viewState',
          shortcut: firstBinding(keybindings, 'panel.zoomIn'),
          onClick: () => actions.zoomIn(),
        },
        {
          label: 'Zoom Out',
          icon: 'zoomOut' as const,
          section: 'viewState',
          shortcut: firstBinding(keybindings, 'panel.zoomOut'),
          onClick: () => actions.zoomOut(),
        },
        {
          label: 'Reset Zoom',
          icon: 'zoomReset' as const,
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
      icon: 'send' as const,
      section: 'content',
      shortcut: firstBinding(keybindings, 'editor.save'),
      disabled: editor?.movedOut === true,
      onClick: () => actions.save(),
    });
    items.push({
      label: 'Save As…',
      icon: 'send' as const,
      section: 'content',
      shortcut: firstBinding(keybindings, 'editor.saveAs'),
      onClick: () => actions.saveAs(),
    });
    items.push({
      label: 'Revert',
      icon: 'rename' as const,
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
      icon: 'retry' as const,
      section: 'content',
      disabled: !editor?.hasFilePath,
      onClick: () => actions.reloadFromDisk(),
    });

    // US6 (#137) — the panel's file in throng's own File Explorer tree, its folder in the OS file manager (via the
    // seam), and the file in its OS default program (067 FR-016, FR-021). 081 FR-041: drawn disabled, with the
    // reason, for a document with no file, where they used to be absent.
    items.push(...fileItems(args, panelFileActionState(editor?.hasFilePath === true, false)));
    // 074 FR-028 — Copy Path, for a file inside the project, as a preview's title menu offers it (v1 review, #732).
    if (args.copyPath) items.push(copyPathSubmenu(args.copyPath, 'navigate'));
    // v1 review (#732) — Set Language…, Reset Language, Encoding ▸ and Line Endings ▸, moved from the body menu: they
    // describe the file, not the text under the pointer. Only an editor has them, so they open its type group.
    if (args.editorFormat) typeRows.push(...editorFormatItems(args.editorFormat, 'panelType'));

    /*
     * 044 FR-002 — Open Preview, after the reveal rows and before Send to Tab
     * (contracts/menus-and-controls.md §2). The affordance is core's decision: `absent` draws nothing
     * (no provider, no file, outside the project — FR-001, FR-004); the provider being off draws it greyed
     * (FR-062). v1 review (#732): the file already having its one preview (FR-012) leaves it ENABLED, and
     * `preview.open` focuses that preview. It shows `preview.open`'s chord when one is bound; none ships (FR-005).
     */
    const openPreview = args.openPreview;
    if (openPreview !== undefined && openPreview.state !== 'absent') {
      items.push({
        label: 'Open Preview',
        // 074 FR-103 — the provider's own preview icon.
        icon: previewIconOf(openPreview.provider),
        section: 'navigate',
        shortcut: firstBinding(keybindings, 'preview.open'),
        disabled: openPreview.state === 'disabled' && openPreview.reason === 'provider-disabled',
        onClick: () => actions.openPreview(),
      });
    }
    // 044 FR-111 — Back and Forward, on every editor.
    items.push(...historyItems(args.history, keybindings, actions));
    // Print… (`editor.print`) — on every editor, untitled included: it prints the document as it stands now.
    if (actions.print !== undefined) {
      const print = actions.print;
      items.push({
        label: 'Print…',
        icon: 'print' as const,
        section: 'navigate',
        group: 'print',
        shortcut: firstBinding(keybindings, 'editor.print'),
        onClick: () => print(),
      });
    }

    // 044 FR-122a/b — Synchronise Scrolling, exactly where Open Preview is drawn, disabled or not.
    // 054 — none for a source whose preview is one picture (a Mermaid file).
    if (openPreview !== undefined && openPreview.state !== 'absent' && supportsScrollSync(openPreview.provider)) {
      panelRows.push(syncScrollItem(args.syncScroll ?? false, keybindings, actions));
    }

    if (panelFailure) panelRows.push(...failureItems(actions));
  }

  // 044 FR-122a/b — a text preview's Synchronise Scrolling, after its Zoom; a binary provider has no editor to
  // keep in step with, so none.
  if (isPreview && args.preview?.providerKind === 'text' && (args.preview.scrollSync ?? args.preview.flowingDocument !== false)) {
    panelRows.push({ ...syncScrollItem(args.syncScroll ?? false, keybindings, actions), ...documentCovered });
  }

  // 073 FR-036b — a grid provider's cell dialog, on or off for THIS panel: a checked toggle in View & state, the menu route
  // the status bar's toggle is an accelerator over.
  if (isPreview && args.preview?.cellDialog !== undefined) {
    typeRows.push(typeRow({
      label: 'Edit Long Cells in Dialog',
      checked: args.preview.cellDialog.on,
      testId: 'menu-item-Edit Long Cells in Dialog',
      icon: 'cellDialog' as const,
      onClick: () => actions.toggleCellDialog(),
    }));
  }

  // 044 FR-033 — a preview's banner commands, after its Zoom (View & state: Refresh · Zoom · Synchronise
  // Scrolling · banner).
  if (isPreview && panelFailure) panelRows.push(...failureItems(actions));

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
      panelRows.push({
        label: 'Reload',
        icon: 'retry' as const,
        section: 'viewState',
        onClick: () => actions.reloadTerminal(),
      });
    }
    panelRows.push({
      label: 'Refresh / redraw terminal',
      icon: 'retry' as const,
      section: 'viewState',
      shortcut: firstBinding(keybindings, 'terminal.redraw'),
      onClick: () => actions.redraw(),
    });
    /*
     * 076 FR-005 (amended by the v1 review, #732) — Remember Command, Remember Directory and Notifications, moved from
     * the body menu: each is a setting of this panel. Checked toggles in the editor's Word Wrap idiom, each showing the
     * chord bound to it now, and present whether or not `terminals.showStatusBar` hides the bar.
     */
    for (const t of args.terminalToggles ?? []) {
      typeRows.push(typeRow({
        label: t.label,
        icon: t.icon,
        checked: t.on,
        settingToggle: true,
        testId: `menu-item-${t.label}`,
        shortcut: t.chord,
        onClick: () => t.toggle(),
      }));
    }
    // 029 FR-004d, 030 FR-042c — the start failure's three commands, while it is live (v1 review, #732: from the body).
    if (panelFailure) panelRows.push(...failureItems(actions));
  }

  /*
   * 057 FR-125 — Flag: raise an Attention mark on this panel from the user, whatever kind it is. A plain
   * item with no command id and no chord (the failure banner's items above are the precedent), in View &
   * state because it sets the panel's state. On a panel already marked main changes nothing, so it is
   * never disabled: the user is not told "no", the mark is simply already there. Round 13 (FR-139) retired
   * the mark's own icons; the row wears the `flag` icon (057 FR-139, amended by the v1 review).
   *
   * Amended 2026-11-07: a blank panel (no type chosen yet) has nothing to draw attention to, so it offers
   * no Flag — absent, not greyed (constitution VI), like the untyped placeholder's Zoom commands.
   */
  if (panel.kind !== undefined) {
    panelRows.push({
      // v1 review (2026-11-28): a marked panel offers Unflag, with the crossed-out flag, which clears the mark.
      ...(args.flagged === true
        ? { label: 'Unflag', icon: 'unflag' as const, onClick: () => actions.unflag() }
        : { label: 'Flag', icon: 'flag' as const, onClick: () => actions.flag() }),
      // v1 review — both rows run `panel.toggleFlag`, so both show its chord.
      shortcut: firstBinding(keybindings, 'panel.toggleFlag'),
      section: 'viewState',
    });
  }

  layoutRows.push({
    label: 'Send to Tab',
    icon: 'send' as const,
    section: 'viewState',
    ...lockedOut,
    submenu: [
      // New Tab == dragging the Panel onto the tab-strip `+` (005 FR-027).
      { label: 'New Tab', icon: 'add' as const, section: 'navigate', onClick: () => actions.sendToNewTab() },
      ...otherTabs.map((t) => ({
        label: t.title,
        icon: 'tab' as const,
        section: 'navigate' as const,
        // 054 FR-074 — a maximised tab takes no panel; drawn disabled, not absent (Constitution VI).
        disabled: t.disabled ?? false,
        onClick: () => actions.sendToTab(t.id),
      })),
    ],
  });

  // Sync (clone) this Panel into a sub-workspace (US7). Hidden in sub-workspace
  // windows (no detach context). "New Window" creates a new sub-workspace; an
  // existing one → choose a Tab within it ("New" makes a fresh Tab). Cloning
  // leaves the Panel in the main project.
  if (detach) {
    layoutRows.push({
      label: 'Sync to',
      icon: 'send' as const,
      section: 'viewState',
      ...lockedOut,
      submenu: [
        {
          label: 'New Sub-workspace',
          icon: 'detach' as const,
          section: 'navigate',
          onClick: () => detach.detachToNew(),
        },
        // A Panel can live in a given sub-workspace only ONCE: if it's already
        // there, the entry is greyed out (no submenu).
        ...detach.subWorkspaces.map((s): MenuAction => {
          if (s.alreadyHasPanel) {
            return { label: s.name, icon: 'tab' as const, section: 'navigate', disabled: true };
          }
          return {
            label: s.name,
            icon: 'tab' as const,
            section: 'navigate',
            submenu: [
              {
                label: 'New Tab',
                icon: 'add' as const,
                section: 'navigate',
                onClick: () => detach.syncToExisting(s.id),
              },
              ...s.tabs.map((t) => ({
                label: t.title,
                icon: 'tab' as const,
                section: 'navigate' as const,
                onClick: () => detach.syncToExisting(s.id, t.id),
              })),
            ],
          };
        }),
      ],
    });
  }

  const closeRow: MenuAction = {
    label: `${panelVerb} Panel`,
    icon: 'destroy' as const,
    section: 'destroy',
    // 048 FR-131 — the chord that runs this same item from the keyboard, as bound now.
    shortcut: firstBinding(keybindings, 'panel.destroy'),
    ...lockedOut,
    onClick: () => actions.destroy(),
  };

  return [...items, ...typeRows, ...layoutRows, ...panelRows, closeRow];
}
