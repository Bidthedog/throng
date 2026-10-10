import { useCallback, useEffect, useRef } from 'react';
import { Annotation, Compartment, EditorSelection, EditorState, Prec, type Transaction } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  rectangularSelection,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import {
  caretPosition,
  columnSelectHeld,
  DEFAULT_BINDING_PLATFORM,
  effectiveActivePanelId,
  effectiveIndent,
  firstBinding,
  inferIndent,
  initialFold,
  isCollapsed,
  isDefaultPanelName,
  BLANK_PANEL_NAME,
  languageName,
  PLAIN_TEXT_ID,
  resolveIconAsset,
  selectedCharacters,
  shippedBindingsFor,
  toggleSection,
  type ActionId,
  type CanonicalChangeMsg,
  type IndentProfile,
  type InferredIndent,
  type LineEndingId,
  type MergeClass,
  type Panel,
  type EditorPanelConfig,
  type ResetDocumentMsg,
} from '@throng/core';
import { useWorkspace } from '../state/workspace-store.js';
import { useProjects } from '../state/projects-store.js';
import { useActiveTheme, useAppSettings, useIconPacks } from '../config/config-store.js';
import {
  allEditorStates,
  getEditorState,
  setEditorState,
  removeEditorState,
  flashReplacedNotice,
} from './editor-state.js';
import { getEditorActions, registerEditorActions, unregisterEditorActions, type EditorLoadNavigation } from './editor-actions.js';
import { setPanelHistory } from '../navigation/history-store.js';
import { registerPanelFocus, unregisterPanelFocus } from '../workspace/panel-focus.js';
import { getActivePane } from '../workspace/active-pane.js';
import { unregisterPanelSearch } from '../search/search-controller.js';
import { attachPanelSearch, destroyPanelSearch, updateCount } from '../search/search-store.js';
import {
  createEditorSearchController,
  searchHighlightExtension,
} from '../search/editor-search.js';
import { showEditorNotice } from './editor-notice-store.js';
import {
  isMissingReason,
  missingFileDetail,
  missingFileMessage,
  type LoadErrorEntry,
} from './editor-missing-notice.js';
import { useReportPanelFailure, useReportSubjectFailure } from '../workspace/panel-failure-notice.js';
import { buildFileChangedNotice } from './file-changed-notice.js';
import { throngHighlighting } from './highlight-style.js';
import {
  claimLanguage,
  functionHighlightCompartment,
  languageCompartment,
  removePanelLanguage,
  usePanelLanguage,
} from './editor-language.js';
import { markdownHeadingRecords } from './markdown-headings.js';
import {
  foldCompartment,
  markdownFoldCommand,
  liveSections,
  markdownFoldExtension,
  markdownSections,
  sectionAtLine,
  syncFoldRanges,
  type FoldCommandDeps,
} from './markdown-fold.js';
import {
  applyFoldStateFromSync,
  documentFoldState,
  relayedKeyMatches,
  setDocumentFoldState,
  useDocumentFoldState,
} from './fold-state-store.js';
import { hidingSections, revealOffset, revealSections } from './editor-fold-reveal.js';
import { registerPanelStateCapture } from '../workspace/panel-state-capture.js';
import { occurrenceCompartment, occurrenceExtensionFor } from './occurrence-highlight.js';
import { loadDocumentOverride, toRelPath } from './language-override.js';
import { registerEditorView, unregisterEditorView } from './editor-views.js';
import {
  clampSelection,
  clearEditorViewState,
  saveEditorViewState,
  takeEditorViewState,
} from './editor-view-state.js';
import { forgetPanelCaret, setPanelCaret } from './caret-store.js';
import { clearEditorHoveredLink, setEditorHoveredLink } from './editor-hovered-link-store.js';
import { hideLinkHintFor } from '../links/link-hint-store.js';
import { attachEditorScrollRelay, type EditorScrollRelay } from './editor-scroll-relay.js';
import {
  forgetDocumentMetrics,
  invalidateDocumentMetrics,
  scheduleDocumentMetrics,
} from './document-metrics-store.js';
import { DocumentReplica } from './document-replica.js';
import {
  columnBlockField,
  columnSelectDown,
  columnSelectLeft,
  columnSelectRight,
  columnSelectUp,
  clipboardEventHandlers,
  commandKeymapCompartment,
  cutLineCommand,
  editorCommandKeymap,
  gutterCompartment,
  indentCompartment,
  indentExtensions,
  indentLinesCommand,
  wrapCompartment,
  outdentLinesCommand,
  pasteCommand,
} from './commands.js';
import { getPanelLanguage } from './editor-language.js';
import { editorContentMenu, linkMenuPosition, placeCaretForContextMenu } from './content-menu.js';
import { currentEditorPreviewAffordance } from './editor-preview.js';
import { requestPreviewOpen } from '../preview/open-preview.js';
import { openFileInTab } from './editor-open.js';
import { positionRevealTarget } from './reveal-range.js';
import { linkScanKey, linkScanOptions } from '../links/link-scan-options.js';
import {
  followLink,
  linkFailureReport,
  linkRouting,
  openWebLink,
  osLinkActions,
  type LinkFollowDeps,
} from '../links/link-actions.js';
import { openFileLinkMenu, openWebLinkMenu } from '../links/file-link-menu.js';
import {
  createLinkPointerHandlers,
  editorLinkExtension,
  editorLinkSiteFor,
  linkAtPosition,
  linkCompartment,
  registerPanelLinkDeps,
  unregisterPanelLinkDeps,
  type EditorLinkAt,
  type EditorLinkDeps,
  type EditorLinkHit,
} from './link-decorations.js';
import { toggleSyncScroll } from '../preview/sync-scroll-toggle.js';
import { usePreviewProviders } from '../preview/provider-registry-context.js';
// 033 US2 (FR-027) — the content menu's Go To Line item opens the ONE navigation-modal slot. A leaf
// store with no imports of its own, so this creates no cycle back into `navigate/`.
import { setNavigationModal } from '../navigate/navigation-store.js';
import {
  wordWrapDocKey,
  documentWordWrap,
  useDocumentWordWrap,
  toggleDocumentWordWrap,
  applyWordWrapFromSync,
} from './word-wrap-store.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useKeybindings } from '../config/config-store.js';
import { useServices } from '../composition-root.js';

/**
 * Marks a transaction as coming FROM the document's authority (016, FR-028f).
 *
 * The update listener sends every document change up to the authority — that is the whole point —
 * so a change the authority just handed us must be recognisable, or it would be sent straight back
 * and applied twice.
 */
const fromAuthority = Annotation.define<boolean>();

/**
 * Read-only while a move has taken this document out of its project (050 FR-035). In a compartment so a
 * later `movedOut: false` (an undo that brought the file back) makes the live view writable again. The
 * authority's own changes still apply: read-only stops the USER typing, not a canonical change arriving.
 */
const readOnlyCompartment = new Compartment();
const movedOutExtensions = (movedOut: boolean): [] | [ReturnType<typeof EditorState.readOnly.of>, ReturnType<typeof EditorView.editable.of>] =>
  movedOut ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];

/**
 * The modifier the column-select DRAG answers to (FR-017e/FR-025), from the shipped-defaults record.
 *
 * Windows ships `Alt`; the record's shape already carries the others, so macOS and Linux need no
 * breaking change here — only a value.
 */
const COLUMN_SELECT_MODIFIER = shippedBindingsFor(DEFAULT_BINDING_PLATFORM).columnSelectModifier;

/** The same modifier, in the spelling CodeMirror's crosshair cursor wants. */
const CROSSHAIR_KEY: 'Alt' | 'Control' | 'Meta' =
  COLUMN_SELECT_MODIFIER === 'Ctrl' ? 'Control' : COLUMN_SELECT_MODIFIER === 'Meta' ? 'Meta' : 'Alt';

export interface UseEditorParams {
  panel: Panel;
  tabId: string;
  /** Owning project root (null for a sub-workspace-owned editor). */
  projectRoot: string | null;
  /** Sub-workspace-owned editor: saves outside every project (FR-035). */
  rootless: boolean;
  /** Origin project id (undefined for sub-workspace-owned). */
  ownerProjectId?: string;
  container: HTMLDivElement | null;
  /** Called once the document's content has been adopted into the view, so the panel
   *  can drop its loading skeleton (issue 132 follow-up). */
  onReady?: () => void;
}

const win = (): typeof window.throng | undefined => window.throng;

/**
 * Publish this panel's caret and selection size to the status bar's store (040 FR-002, FR-002a,
 * FR-004, FR-005, FR-008a).
 *
 * Called synchronously from the update listener, and cheap enough to be: `lineAt` is a binary
 * search over the line index CodeMirror already maintains, and the only string this touches is the
 * caret's own line.
 *
 * ══ WHERE EACH HALF OF THE POSITION COMES FROM ══
 *
 * The LINE number is CodeMirror's, because its index already answers the question and re-deriving
 * it would be an O(document) scan on the keystroke path. The COLUMN comes from `@throng/core`'s
 * `caretPosition`, applied to that one line — so the definition that says a tab advances the column
 * by exactly 1 (FR-002a, and NOT a display column) lives in one place, is unit-tested there, and
 * cannot drift into an indent-width-dependent variant here.
 *
 * ══ WHY THE RANGES ARE STREAMED AND NOT SLICED ══
 *
 * `iterRange` hands `selectedCharacters` a CURSOR over the rope, so a selection is counted without
 * ever being assembled into a string. `sliceString` would assemble it: Ctrl+A then `Shift+Down` in
 * a 5 MB document would allocate and discard ~5 MB here, on this synchronous path, once per
 * selection change — and once per mouse-move of a shift-drag (T012a). The counting rule is
 * per-character and therefore identical over chunks, so nothing is traded for it.
 *
 * Empty ranges are skipped before a cursor is even opened: a bare caret is the common case by an
 * enormous margin, and it must cost nothing at all.
 */
function publishCaret(panelId: string, state: EditorState): void {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const { column } = caretPosition(line.text, head - line.from);
  const ranges: Iterable<string>[] = [];
  for (const range of state.selection.ranges) {
    if (!range.empty) ranges.push(state.doc.iterRange(range.from, range.to));
  }
  setPanelCaret(panelId, { line: line.number, column }, selectedCharacters(ranges));
}

/**
 * How a change may coalesce into the undo entry above it (FR-026).
 *
 * Only the view can tell these apart — a pasted "x" and a typed "x" produce identical ChangeSets,
 * and FR-026 requires the paste to be its own single undo entry. A batch is only a typing run if
 * EVERY transaction in it is one; anything else closes the run.
 */
function mergeClassOf(update: ViewUpdate): MergeClass {
  const edits = update.transactions.filter((tr: Transaction) => !tr.changes.empty);
  if (edits.length === 0) return null;
  if (edits.every((tr) => tr.isUserEvent('input.type'))) return 'type';
  // Backspace and Delete runs only. NOT `isUserEvent('delete')`, which also matches `delete.cut` —
  // a COMMAND, and FR-026 requires a command to be its own undo entry. Matching the prefix would
  // quietly let a Ctrl+X coalesce into the backspaces before it, and one Ctrl+Z would take both.
  if (edits.every((tr) => tr.isUserEvent('delete.backward') || tr.isUserEvent('delete.forward'))) {
    return 'delete';
  }
  return null;
}

/**
 * The editor's rebindable commands, bound from the LIVE keybindings (016, US3/US4).
 *
 * Everything they depend on is read at CALL time, not captured: a Save-As from `notes` to `notes.py`
 * changes both the document's language (and therefore its indentation) and, potentially, its line
 * ending — and the command must act on what the document is NOW, not what it was when the panel
 * mounted.
 */
function commandsFor(deps: {
  lineEnding: () => LineEndingId;
  indent: () => IndentProfile;
  toggleWrap: () => void;
  /**
   * 047 US3, research R5 — the six `markdown.*` fold actions, bound ONLY while `isMarkdown` is true
   * at the moment `commandsFor` is called (the rebuild effect below re-runs whenever the panel's
   * language changes, exactly as it does for a rebind). Omitting the keys entirely — not merely
   * making the handlers no-ops — is what keeps CodeMirror's own `Ctrl-m` (`toggleTabFocusMode`) alive
   * in every other language: an ABSENT action is never bound inside CodeMirror at all (`editorChordsFor`'s
   * own reasoning, one level up).
   */
  markdownFold?: { isMarkdown: boolean } & FoldCommandDeps;
}): Partial<Record<ActionId, ReturnType<typeof cutLineCommand>>> {
  return {
    'editor.cutLine': cutLineCommand(deps.lineEnding),
    'editor.indentLines': indentLinesCommand(deps.indent),
    'editor.outdentLines': outdentLinesCommand(deps.indent),
    'editor.columnSelectUp': columnSelectUp,
    'editor.columnSelectDown': columnSelectDown,
    'editor.columnSelectLeft': columnSelectLeft,
    'editor.columnSelectRight': columnSelectRight,
    // 024 US1: the wrap chord (`Ctrl+E,W` by default, 046 FR-091, FR-124) toggles the focused editor's
    // document wrap; the compartment reconfigure
    // effect reflows every view of that document.
    'editor.toggleWordWrap': () => {
      deps.toggleWrap();
      return true;
    },
    ...(deps.markdownFold?.isMarkdown
      ? {
          'markdown.toggleSection': markdownFoldCommand('toggleSection', deps.markdownFold),
          'markdown.collapseSection': markdownFoldCommand('collapseSection', deps.markdownFold),
          'markdown.expandSection': markdownFoldCommand('expandSection', deps.markdownFold),
          'markdown.collapseAll': markdownFoldCommand('collapseAll', deps.markdownFold),
          'markdown.expandAll': markdownFoldCommand('expandAll', deps.markdownFold),
          'markdown.toggleAll': markdownFoldCommand('toggleAll', deps.markdownFold),
          // 054 FR-011, FR-013 — shipped unbound; reachable from the Outlining submenu and any rebind.
          'markdown.collapseAllInside': markdownFoldCommand('collapseAllInside', deps.markdownFold),
          'markdown.expandAllInside': markdownFoldCommand('expandAllInside', deps.markdownFold),
        }
      : {}),
  };
}

/**
 * US8 (#154): a document's scroll anchor, keyed by absolute path, saved when it is switched away
 * from IN PLACE and restored on reopen when "Save Document Scroll Position" is on. Module-level so
 * it survives a document swap within the same editor view. Distinct from #144's per-panel view
 * state (switching tabs/projects/panels), which is unchanged.
 */
const docScrollByPath = new Map<string, number>();

export function useEditor(params: UseEditorParams): void {
  const { panel, tabId, projectRoot, rootless, ownerProjectId, container } = params;
  const onReadyRef = useRef(params.onReady);
  onReadyRef.current = params.onReady;
  const ws = useWorkspace();
  const { projects } = useProjects();
  const settings = useAppSettings().editor;
  /**
   * The consolidated raise (030 FR-029/FR-035), through a ref.
   *
   * `maybeWarn` is called from inside async closures that were built when the view mounted, so it
   * must reach the CURRENT reporter rather than the one that existed at mount — the layout it reads
   * changes as tabs and panels move.
   */
  const reportPanelFailure = useReportPanelFailure();
  const reportPanelFailureRef = useRef(reportPanelFailure);
  reportPanelFailureRef.current = reportPanelFailure;
  // The live bindings. `editor.cutLine` is rebindable (FR-017), and the keymap below is built from
  // them — minus any chord 012's window-level commands own (FR-024b).
  const keybindings = useKeybindings();

  // 024 US1 (#152): word wrap is a per-DOCUMENT flag (Principle XI) — key it by the open file's path
  // so every panel showing that file wraps together; an untitled buffer keys per panel. A first-seen
  // document is seeded from the `editor.defaultWordWrap` preference (FR-002).
  const wrapFilePath = (panel.config as EditorPanelConfig | undefined)?.filePath ?? null;
  const wrapDocKey = wordWrapDocKey(wrapFilePath, panel.id);
  const wordWrapOn = useDocumentWordWrap(wrapDocKey, settings.defaultWordWrap);
  // Read through a ref so the chord/menu toggle always acts on the CURRENTLY open document, even
  // after a file switch reuses this same view.
  const wrapDocKeyRef = useRef(wrapDocKey);
  wrapDocKeyRef.current = wrapDocKey;
  const toggleWrap = useCallback(() => {
    toggleDocumentWordWrap(wrapDocKeyRef.current, metaRef.current.settings.defaultWordWrap, panel.id);
  }, [panel.id]);

  // Seed this view from the AUTHORITY, not from the preference (FR-001a). The document may already
  // be open in another window with the toggle turned off; seeding locally would give this Panel its
  // own answer and the two would disagree until someone toggled again. The authority knows both
  // whether the document has been seen and what it was set to, so it is the only correct source —
  // for a document nobody has opened it simply returns the preference we pass in.
  useEffect(() => {
    let live = true;
    const key = wrapDocKey;
    void window.throng?.editor
      ?.wordWrap?.(panel.id, settings.defaultWordWrap)
      .then((on) => {
        if (live && typeof on === 'boolean') applyWordWrapFromSync(key, on);
      })
      .catch(() => {
        /* No authority to ask (a torn-down window): the local seed stands. */
      });
    return () => {
      live = false;
    };
  }, [wrapDocKey, panel.id, settings.defaultWordWrap]);

  /*
   * 047 US3 (research R3) — fold state follows the SAME per-document key as word wrap: an editor or
   * a parented preview both resolve to `file:<path>` in main's fold map, so a document folds together
   * exactly as it wraps together (Principle XI). `foldStateValue` is the renderer's cache
   * (`fold-state-store.ts`), seeded locally from `editor.markdownSectionsOpen` (FR-039) until the
   * authority answers (below) — the same two-step seed word wrap uses, for the same reason (FR-001a):
   * the document may already be open elsewhere with sections collapsed, and a local-only seed would
   * disagree with it until the next toggle.
   */
  const languageId = usePanelLanguage(panel.id)?.languageId;
  const isMarkdown = languageId === 'markdown';
  const theme = useActiveTheme();
  const iconPacks = useIconPacks();
  const foldSeed = initialFold(settings.markdownSectionsOpen);
  const foldStateValue = useDocumentFoldState(wrapDocKey, foldSeed);
  // Read through a ref so the gutter's click handler (built in an effect that does NOT depend on
  // `foldStateValue` — see below) always acts on the CURRENT state rather than the one captured when
  // the gutter extension was last (re)built.
  const foldStateValueRef = useRef(foldStateValue);
  foldStateValueRef.current = foldStateValue;
  // Read at call time by the find controller's fold dependency (049): the controller is built once per view,
  // but whether the document is Markdown (and so foldable) can change under it.
  const isMarkdownRef = useRef(isMarkdown);
  isMarkdownRef.current = isMarkdown;

  /**
   * `commandsFor()`'s fold deps (R5) — `isMarkdown` is THIS render's, so the rebuild effect that
   * calls this must list it as a dependency; `docKey`/`seedDefault` read through refs, matching
   * `currentLineEnding`/`currentIndent`'s own "read at call time" contract.
   */
  const markdownFoldDeps = useCallback((): { isMarkdown: boolean } & FoldCommandDeps => ({
    isMarkdown,
    docKey: () => wrapDocKeyRef.current,
    panelId: panel.id,
    seedDefault: () => initialFold(metaRef.current.settings.markdownSectionsOpen),
  }), [isMarkdown, panel.id]);

  useEffect(() => {
    if (!isMarkdown) return;
    let live = true;
    const key = wrapDocKey;
    void window.throng?.editor
      ?.foldState?.(panel.id, settings.markdownSectionsOpen)
      .then((state) => {
        if (live && state) applyFoldStateFromSync(key, state);
      })
      .catch(() => {
        /* No authority to ask (a torn-down window): the local seed stands. */
      });
    return () => {
      live = false;
    };
  }, [wrapDocKey, panel.id, isMarkdown, settings.markdownSectionsOpen]);

  /*
   * The fold relay is carried on `EditorSyncMsg.foldState`, keyed by the DOCUMENT key rather than by
   * `panelId` (contracts/preview-ipc-047.md §5) — one document, however many views, one broadcast —
   * so it cannot be filtered by the `msg.panelId !== panelId` guard the main `onSync` handler below
   * uses for every other field. A second, independent subscription filters on the key instead.
   */
  useEffect(() => {
    if (!isMarkdown) return;
    const off = window.throng?.editor?.onSync?.((msg) => {
      if (msg.foldState && relayedKeyMatches(msg.foldState.key, wrapDocKey)) {
        applyFoldStateFromSync(wrapDocKey, msg.foldState.state);
      }
    });
    return () => off?.();
  }, [wrapDocKey, isMarkdown]);

  // The fold mechanism reaches the live view through `foldCompartment` — CodeMirror's folding extension plus the
  // heading gutter — populated only while Markdown (R4), the same way `languageCompartment` is.
  // Rebuilt on a language change, a gutter-visibility change, or a theme/icon-pack change (the
  // gutter's markers are drawn from theme icon tokens); NOT on `foldStateValue` — the effect below
  // applies fold RANGES to whatever is already installed, which is cheaper than reinstalling the
  // gutter on every toggle and is what makes a toggle repaint just the markers it touched.
  //
  // Also run by the mount effect once it has built a view (MT-04): a panel re-parented by a layout change
  // (a preview split beside it) gets a NEW view while `isMarkdown` stays true, so this effect — which ran
  // before that view existed — would never run again, and the rebuilt view had no folding at all.
  const installFold = (): void => {
    const view = viewRef.current;
    if (!view) return;
    if (!isMarkdown) {
      view.dispatch({ effects: foldCompartment.reconfigure([]) });
      return;
    }
    // Force the syntax tree fully parsed BEFORE installing the gutter: `ensureSyntaxTree` cannot do
    // this reentrantly from within the gutter's own `lineMarker` (CodeMirror will not force a parse
    // from inside a render pass), so a call from here — an ordinary function call, not a view update
    // — is what the gutter's first render actually sees. `markdown-fold.ts`'s `lineMarkerChange`
    // still recomputes the markers on a LATER edit that advances the tree further.
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({
      effects: foldCompartment.reconfigure(
        markdownFoldExtension({
          iconFor: (token) => resolveIconAsset(theme, iconPacks, token),
          // 049 T062 — read the STORE, not the render's copy of it: a command (Collapse All) writes the store and
          // folds the ranges in one go, and the ref below only catches up on the next render — after the
          // gutter had already redrawn its markers from the old state.
          getFoldState: () =>
            documentFoldState(wrapDocKeyRef.current, initialFold(metaRef.current.settings.markdownSectionsOpen)),
          onToggle: (slug) => {
            setDocumentFoldState(
              wrapDocKeyRef.current,
              toggleSection(foldStateValueRef.current, slug),
              panel.id,
            );
          },
          showGutter: metaRef.current.settings.showGutter,
        }),
      ),
    });
  };
  const installFoldRef = useRef(installFold);
  installFoldRef.current = installFold;
  useEffect(() => {
    installFoldRef.current();
  }, [isMarkdown, settings.showGutter, theme, iconPacks, panel.id]);

  // Make the view's CodeMirror fold ranges equal the derivation from the CURRENT FoldState (R4) —
  // runs on every change, whichever view or window it came from (Principle XI: one document, one
  // state, every view redraws the same way).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !isMarkdown) return;
    const sections = markdownSections(markdownHeadingRecords(view.state), view.state.doc.lines - 1);
    syncFoldRanges(view, sections, foldStateValue);
  }, [isMarkdown, foldStateValue]);

  // Latest values read through refs so the mount effect isn't torn down on every
  // render (mirrors the terminal view's approach). `tabTitle` is resolved from the
  // live layout so the file-changed notice can name the containing tab (011, FR-010).
  const tabTitle = ws.layout?.tabs.find((t) => t.id === tabId)?.title ?? tabId;
  const { documents } = useServices();
  const metaRef = useRef({ projectRoot, rootless, ownerProjectId, tabId, projects, settings, title: panel.title, tabTitle, documents });
  metaRef.current = { projectRoot, rootless, ownerProjectId, tabId, projects, settings, title: panel.title, tabTitle, documents };

  const viewRef = useRef<EditorView | null>(null);
  // The document position to scroll back to the top on this mount (issue #144). Held so
  // it can be RE-asserted after the async language/indent reconfigure, which re-renders
  // and would otherwise drop the restored viewport back to the top.
  const pendingScrollAnchorRef = useRef<number | null>(null);
  /*
   * 044 FR-121 — this view's scroll relay (`editor-scroll-relay.ts`), and whether its initial placement is
   * still to settle. A preview's request is HELD until then (R-E4): the #144 restore is re-asserted after
   * the async language load, and a request applied before that would be scrolled away by it.
   */
  const scrollRelayRef = useRef<EditorScrollRelay | null>(null);
  const placementPendingRef = useRef(false);
  // US8 (#154): the live scroll anchor (updated by the scroll listener) so an in-place open can
  // save the OUTGOING document's position; and a flag set by openFile so the next document RESET
  // applies the US8 scroll policy (reset to top, or restore the incoming document's saved scroll).
  const currentScrollAnchorRef = useRef(0);
  const pendingOpenScrollRef = useRef<{ path: string; restore: boolean } | null>(null);
  // Whether this panel is the active panel of the active tab — read through a ref so
  // the (async) initialise can take keyboard focus on mount only when it should (#144).
  const activeTab = ws.layout?.tabs.find((t) => t.id === tabId);
  const isActivePanelRef = useRef(false);
  isActivePanelRef.current =
    ws.layout?.activeTabId === tabId && !!activeTab && effectiveActivePanelId(activeTab) === panel.id;
  const configRef = useRef<EditorPanelConfig>((panel.config ?? {}) as EditorPanelConfig);
  /**
   * A move took this document out of its project (050 FR-035): it no longer reads or saves its file,
   * shows the moved notice, and is read-only. Seeded from the persisted config, so a panel mounted
   * after the layout walk (R19) or a restart starts in the state without reading anything.
   */
  const movedOutRef = useRef(configRef.current.movedOut === true);
  /**
   * Whose config `configRef` currently holds — and a re-seed if this hook is ever handed a
   * DIFFERENT panel (#228).
   *
   * `configRef` is seeded once, at mount, and everything downstream trusts it: it is the path the
   * mount loads, the path a Ctrl+S writes to, and the path the header shows. So a component instance
   * reused for another panel would open one panel's file into another panel's document — which is
   * exactly what an unkeyed panel leaf allowed, across a project switch, until `split-tree.tsx`
   * started keying by panel id.
   *
   * That key is the fix; this is the guard behind it. The cost is one comparison per render, and the
   * failure it refuses is silent, cross-project, and one keystroke from writing a buffer over the
   * wrong file — the kind of thing that should be impossible from two directions rather than one.
   */
  const seededFor = useRef(panel.id);
  if (seededFor.current !== panel.id) {
    seededFor.current = panel.id;
    configRef.current = (panel.config ?? {}) as EditorPanelConfig;
    movedOutRef.current = configRef.current.movedOut === true;
  }
  /**
   * 044 US7 — the panel's LIVE `config.history`, the mirror `HistoryMirrorSync` keeps. `configRef` is the
   * editor's own record of its document and is rebuilt on every in-place open, so the history is read from
   * the layout's panel at the moment a load is sent, beside the path it loads (contracts §6).
   */
  const liveHistoryRef = useRef<EditorPanelConfig['history']>(undefined);
  liveHistoryRef.current = (panel.config as EditorPanelConfig | undefined)?.history;
  /**
   * The DOCUMENT this panel is showing right now, named the way the status bar's stores key it
   * (040 FR-007).
   *
   * ══ WHY THIS IS NOT `wrapDocKeyRef` ══
   *
   * Word wrap keys its document off `panel.config.filePath` — the workspace LAYOUT's copy of the
   * path — and gets away with it because it re-reads the key on every render, so a key that arrives
   * late simply starts working. The counts do not: they are written ONCE per document change, and a
   * figure written under a key that later changes is invisible for the rest of the session.
   *
   * `openFile` sets `configRef.current.filePath` the instant the load returns, and `publishState`
   * copies that into `editor-state`, which is where {@link StatusStrip} reads its key from. So this
   * and the bar name the document from the SAME value at the same moment. The layout's copy follows
   * a render or two later, which was long enough for the bar to show `Ln 1 Col 1` and no counts at
   * all — every store and every component test green, and blank readouts in the running app.
   */
  const metricsDocKey = (): string => wordWrapDocKey(configRef.current.filePath ?? null, panel.id);

  /**
   * Re-publish this document's counts under the key the panel has NOW (040 FR-003, FR-007).
   *
   * ══ THE RACE, WHICH IS THE SAME ONE `refreshLanguage` DOCUMENTS ══
   *
   * The authority broadcasts a document's replacement as soon as it has loaded the file, so the
   * RESET can reach this view before `openFile` has recorded the new path — `use-editor.ts:659`
   * says so in as many words, about language detection resolving the old file's language. The
   * counts have exactly the same problem one step along: the reset's own schedule names the
   * OUTGOING document, and the bar then reads a key nobody ever wrote.
   *
   * The caret does not need this because it is republished on every keystroke and heals itself
   * within one. A count is written once per document change, so it never does.
   *
   * Called wherever `configRef` is REPLACED — an open in place, and a Save-As. A revert or an
   * external reload keeps the path, so the reset's own schedule is already correctly keyed.
   */
  const republishCounts = (): void => {
    const view = viewRef.current;
    if (!view) return;
    scheduleDocumentMetrics(metricsDocKey(), () => view.state.doc.toString());
  };

  const keybindingsRef = useRef(keybindings);
  keybindingsRef.current = keybindings;
  /*
   * 045 US3 — file links in THIS editor (FR-002, FR-022, FR-033, FR-040 – FR-044, FR-060).
   *
   * Everything is read through refs and through `configRef`, never captured: the open file changes
   * under a live view (an in-place open, a Save As), and with it the base directory a relative path
   * is measured from. A captured site would keep resolving `./b.md` against the folder of a file the
   * panel stopped showing.
   *
   * FR-055 is not enforced here — `performLinkTarget` refuses an editor or a preview for anything
   * outside the owning project once, below every caller, so no call site can forget to.
   */
  const reportSubject = useReportSubjectFailure();
  const linkDepsRef = useRef<EditorLinkDeps | null>(null);
  linkDepsRef.current = {
    site: () =>
      editorLinkSiteFor({
        panelId: panel.id,
        filePath: configRef.current.filePath ?? null,
        ...(metaRef.current.ownerProjectId ?? panel.originProjectId
          ? { originProjectId: metaRef.current.ownerProjectId ?? panel.originProjectId }
          : {}),
      }),
    // FR-060 — read from `metaRef`, which this render has just refreshed. The compartment below
    // takes the decoration plugin out of a live view; this closes the gestures, which are installed
    // on the view itself and would otherwise keep following a link that no longer underlines.
    detect: () => metaRef.current.settings.links.detectInEditors,
    // FR-159, FR-178 — the known extensions and the allowlist, from the same live settings.
    scanOptions: () => linkScanOptions(metaRef.current.settings.links),
    // The owning project's root, which a link's tooltip is worded against by name (FR-155).
    projectRoot: () => (metaRef.current.rootless ? null : metaRef.current.projectRoot),
    // FR-168: the tooltip's destination, worded from the same open-target preference and live
    // preview routing the follow itself reads (FR-054's one-reading rule, extended to the wording).
    openTarget: () => metaRef.current.settings.openTarget,
    previewRegistry: () => previewProvidersRef.current.registry,
    previewSettings: () => metaRef.current.settings.previews,
    // FR-103: a web link goes to the system browser by the one route the terminal takes too; a file
    // link goes through the click rule.
    follow: (hit) =>
      hit.kind === 'web'
        ? openWebLink(hit.uri, linkScanOptions(metaRef.current.settings.links).allowlist)
        : void followEditorLink(hit),
  };

  /**
   * FR-054 — the one route Ctrl+click, the chord and the menu's Open Link all take.
   *
   * One `throng:links:follow` for the span the decoration drew (data-model §16.18): main resolves it
   * under one deadline, reveals it itself where that is the outcome, and answers what is left to do
   * here — open in throng by the click rule, or raise the one notice.
   */
  async function followEditorLink(hit: EditorLinkHit): Promise<void> {
    await followLink({
      request: hit.request,
      ...(hit.position === undefined ? {} : { position: hit.position }),
      deps: editorLinkDestinations(),
    });
  }

  function editorLinkDestinations(): LinkFollowDeps {
    const meta = metaRef.current;
    return {
      /*
       * FR-051, FR-052, FR-110 — the file's own default open action, read at the GESTURE. It is the
       * click rule's one settings-derived input: the *Default link action* is retired (FR-112), and
       * what a click does is otherwise fixed by `resolveDefaultLinkAction`.
       *
       * `metaRef` is rewritten on every render and `previewProvidersRef` follows the injected
       * registry, so the reader below sees whatever is current even though the extension holding
       * these deps was installed at mount. Composed through `linkRouting` rather than written out,
       * so this and the terminal cannot read the same preference differently (FR-054).
       */
      ...linkRouting(() => ({
        previewRegistry: previewProvidersRef.current.registry,
        previewSettings: metaRef.current.settings.previews,
      })),
      // FR-033 — `openFileInTab`, honouring *Open files in*, and NEVER `open-router.ts`: a link is
      // always an editor, whatever the file's own default open action (044 FR-055). FR-052's
      // position is placed by `positionRevealTarget`, which resolves once the view holds the text.
      openInEditor: (link, position) =>
        void openFileInTab(
          ws,
          meta.tabId,
          link.path,
          meta.settings.openTarget,
          position ? positionRevealTarget(position.line, position.column) : undefined,
        ),
      openInPreview: (link) =>
        void requestPreviewOpen({
          absPath: link.path,
          projectId: meta.ownerProjectId ?? panel.originProjectId,
          requesterPanelId: panel.id,
        }),
      // One condition, one notice, one wording — shaped in `link-actions.ts` so the terminal's
      // identical failure cannot read differently (FR-036, FR-037).
      reportFailure: (outcome) =>
        reportSubject(
          linkFailureReport(outcome, {
            projectRoot: meta.rootless ? null : meta.projectRoot,
            osName: window.throng?.osName ?? 'windows',
            ...(meta.ownerProjectId ?? panel.originProjectId
              ? { projectId: meta.ownerProjectId ?? panel.originProjectId }
              : {}),
          }),
        ),
    };
  }

  /**
   * The STABLE deps the extension and the DOM handlers hold, delegating through the ref above.
   *
   * They are built once and never rebuilt: an extension is installed in a compartment and a handler
   * is installed on the view, so handing either the render's own closure would freeze this panel's
   * links at whatever the file, the project and the settings were at mount.
   */
  const linkDeps = useRef<EditorLinkDeps>({
    detect: () => linkDepsRef.current!.detect?.() ?? true,
    scanOptions: () => linkDepsRef.current!.scanOptions?.() ?? {},
    site: () => linkDepsRef.current!.site(),
    projectRoot: () => linkDepsRef.current!.projectRoot?.() ?? null,
    openTarget: () => linkDepsRef.current!.openTarget?.() ?? 'lastActive',
    previewRegistry: () => linkDepsRef.current!.previewRegistry?.(),
    previewSettings: () => linkDepsRef.current!.previewSettings?.(),
    follow: (hit) => linkDepsRef.current!.follow(hit),
  }).current;
  const linkPointer = useRef(createLinkPointerHandlers(linkDeps)).current;

  /** FR-060 — detection in editors, read live. `null` empties the compartment. */
  const detectLinks = settings.links.detectInEditors;
  /** FR-159, FR-178 — a value key for what the scan reads, so an edit rebuilds the marks at once. */
  const linkScan = linkScanKey(settings.links);

  /**
   * 045 FR-169 – FR-171, FR-170a – FR-170c, §5 — open the ONE Link menu over the link the menu was
   * asked for, and answer whether it did. `false` — text selected (024 FR-019d), or no link there —
   * leaves the content menu to open, unchanged.
   *
   * A right-click hit-tests the pointer; a keyboard menu (`menu.open`) the CARET, because its
   * synthetic event carries the focused element's corner. The menu is the terminal's, opened by the
   * same `links/file-link-menu.ts` functions with this editor's own Ctrl+click as Open Link, so the
   * two cannot drift (SC-025). The chord IS shown here, unlike in the terminal: `preview.followLink`
   * is live in the editor scope (FR-045, FR-169's note), and it is read at menu-open time so a rebind
   * appears on the next right-click. `editor.links.detectInEditors` is applied by the scan, which
   * drops guessed paths and keeps web links (FR-101).
   */
  function openEditorLinkMenu(view: EditorView, event: MouseEvent, x: number, y: number): boolean {
    if (!view.state.selection.main.empty) return false;
    const pos = linkMenuPosition(view, event);
    if (pos === null) return false;
    const hit: EditorLinkAt | null = linkAtPosition(view.state, pos, linkDeps);
    if (!hit) return false;
    const binding = firstBinding(keybindingsRef.current, 'preview.followLink');
    const chord = binding ? { chord: binding } : {};
    const opener = { openMenu: openMenuRef.current, updateMenu: updateMenuRef.current };

    if (hit.kind === 'web') {
      const uri = hit.uri;
      openWebLinkMenu({
        x,
        y,
        opener,
        ...chord,
        openLink: () => openWebLink(uri, linkScanOptions(metaRef.current.settings.links).allowlist),
        // 'verbatim' — an address is not a line-wise or rectangular selection, so it pastes as written.
        copyLink: () => window.throng?.clipboard?.write({ text: uri, mode: 'verbatim' }),
      });
      return true;
    }

    const meta = metaRef.current;
    openFileLinkMenu({
      x,
      y,
      opener,
      ws,
      request: hit.request,
      ...(hit.position === undefined ? {} : { position: hit.position }),
      ...(hit.positionText === undefined ? {} : { positionText: hit.positionText }),
      projectRoot: meta.rootless ? null : meta.projectRoot,
      previewRegistry: previewProvidersRef.current.registry,
      previewSettings: meta.settings.previews,
      ...chord,
      // FR-054 — Open Link is this editor's Ctrl+click, the one `throng:links:follow`.
      openLink: () => void followEditorLink(hit),
      deps: { ...editorLinkDestinations(), ...osLinkActions() },
    });
    return true;
  }
  /*
   * The content-menu handler is installed on the view ONCE, at mount, so it reaches this render's
   * function through a ref: a captured one would hold the mount render's workspace, whose layout was
   * not loaded yet — no Open In ▸ <editor name> rows, and every route opening into a stale layout.
   */
  const openEditorLinkMenuRef = useRef(openEditorLinkMenu);
  openEditorLinkMenuRef.current = openEditorLinkMenu;

  // 044 FR-002 — the injected preview providers, read by the content menu when it opens.
  const previewProviders = usePreviewProviders();
  const previewProvidersRef = useRef(previewProviders);
  previewProvidersRef.current = previewProviders;
  /**
   * What the DOCUMENT already does, read from its existing lines when it loads (FR-018a).
   *
   * Null when it has no indentation to read. It outranks every setting, because a document's
   * indentation is a fact about that document — and a preference that overruled it would mix tabs
   * and spaces into a file the user never asked to convert, one keystroke at a time (FR-018d).
   */
  const inferredRef = useRef<InferredIndent>(null);
  const panelId = panel.id;

  /**
   * The indentation this document actually uses: the file ▸ its language ▸ the global default.
   *
   * Stable, and reading everything through refs at CALL time — the commands built from it are
   * installed once and must see the document as it is when the key is pressed, not as it was when
   * the keymap was assembled.
   */
  const currentIndent = useCallback(
    (): IndentProfile =>
      effectiveIndent({
        inferred: inferredRef.current,
        languageId: getPanelLanguage(panelId)?.languageId ?? PLAIN_TEXT_ID,
        settings: metaRef.current.settings,
      }),
    [panelId],
  );

  /** The document's effective line ending — what the CLIPBOARD is terminated with (SC-009a). */
  const currentLineEnding = useCallback(
    (): LineEndingId => configRef.current.lineEnding ?? metaRef.current.settings.defaultLineEnding,
    [],
  );

  /** Push the effective indentation into the live view (FR-018/FR-018e). */
  const refreshIndent = (): void => {
    viewRef.current?.dispatch({
      effects: indentCompartment.reconfigure(indentExtensions(currentIndent())),
    });
  };

  // 024 US1: reflow the live view whenever the document's wrap flag changes — from this panel's
  // toggle, or from another panel showing the same file (the store is the single per-document
  // authority). Rewraps the whole document, not just the viewport (FR-003a).
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.reconfigure(wordWrapOn ? EditorView.lineWrapping : []),
    });
  }, [wordWrapOn]);

  /*
   * 045 FR-060 — `editor.links.detectInEditors`, on the LIVE view.
   *
   * The same shape as word wrap and the gutter above, and for the same reason: recreating the
   * `EditorView` would satisfy every content check and take the undo history, the scroll and the
   * selection with it. The switch itself is read inside the scan (`linkDeps.detect`), which drops
   * guessed paths; reconfiguring here rebuilds the marks the moment it moves.
   *
   * The plugin stays installed with the switch off, because the switch is about GUESSED paths only:
   * a web url is a declaration, and FR-101 keeps it marked and followable in an editor exactly as in
   * a terminal, where an explicit hyperlink is untouched by the same switch (§6).
   *
   * 045 FR-159 / FR-178 (round four): a change to the known extensions or the protocol allowlist
   * rebuilds the marks the same way. The scan reads them live (`linkDeps.scanOptions`); this only makes
   * the redraw immediate rather than waiting for the next edit or scroll.
   */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: linkCompartment.reconfigure(editorLinkExtension(linkDeps)),
    });
  }, [detectLinks, linkScan, linkDeps]);

  // FR-045 — the Open Link chord is dispatched at the window (it has to be: CodeMirror's own
  // `defaultKeymap` binds Ctrl+Enter), and the window knows a panel id and nothing else.
  useEffect(() => {
    registerPanelLinkDeps(panel.id, linkDeps);
    return () => unregisterPanelLinkDeps(panel.id);
  }, [panel.id, linkDeps]);

  /**
   * 040 US4: the gutter follows `editor.showGutter` on the LIVE view (FR-043).
   *
   * The same shape as the word-wrap effect above, and for the same reason — the alternative is
   * recreating the `EditorView`, which would take the undo history, the scroll and the selection
   * with it (FR-044, research D3). Nothing here is per-document: the gutter is a preference about
   * how editors are drawn, so every panel changes together (FR-046).
   *
   * The transaction carries no `changes` and no `selection`, which is what makes FR-044's selection
   * half true by construction rather than by care.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    /*
     * ANCHOR FIRST, AND THIS WAS MEASURED RATHER THAN ASSUMED.
     *
     * FR-044 records that "a compartment reconfigure preserves the reader's place" is an assumption
     * nothing in this repository had ever checked. It is FALSE here, and the first version of this
     * effect — a bare reconfigure — proved it: with the document scrolled to `line 016`,
     * `editor-gutter-visibility.e2e.ts` measured the top visible line as `line 019` afterwards.
     *
     * The mechanism is the one FR-044 predicts. `.cm-content` is `flexGrow: 2` in a flex
     * `.cm-scroller`, so removing the gutter WIDENS the text column; every wrapped line then needs
     * fewer visual rows, the document above the viewport gets shorter, and the same pixel
     * `scrollTop` lands further down the file. CodeMirror does not compensate: the pixel offset is
     * preserved and the LINE is not, which is precisely backwards from what a reader wants.
     *
     * So the document position is captured before the reconfigure and re-asserted after it, using
     * this file's own idiom for exactly this problem (#144, `scrollIntoView(anchor, { y: 'start' })`
     * — doc-position based, so re-applying is idempotent).
     *
     * ══ AT VISUAL-ROW GRANULARITY, WHICH IS NOT WHAT `lineBlockAtHeight` GIVES ══
     *
     * This read `view.lineBlockAtHeight(view.scrollDOM.scrollTop).from`, and that anchor is the
     * start of the whole LOGICAL line. CodeMirror's own words for a line block: "a range delimited
     * on both sides by either a non-hidden line break, or the start/end of the document" — wrapping
     * does not subdivide it. So restoring with `y: 'start'` put the line's FIRST row at the top and
     * the reader lost however far into the line they had scrolled: measured at 2.3 rows in the
     * modest fixture `editor-gutter-visibility.e2e.ts` uses, and hundreds of rows in the case the
     * fix exists for — minified JSON, a prose paragraph, the preferences JSON editor, which declares
     * `lineWrapping` unconditionally.
     *
     * `posAtCoords` answers at the granularity that actually matters: the document position at the
     * top-left of the viewport, wherever inside a wrapped line that falls. `false` as the second
     * argument is what makes it total — the precise overload returns null for a point the rendered
     * DOM does not cover, and there is no sensible thing to do with a null here.
     *
     * SCREEN coordinates, not the document heights `lineBlockAtHeight` takes, which is why this
     * reads the scroller's bounding rect rather than its `scrollTop`. The 1px insets keep the point
     * off the exact boundary, where it would resolve to the row above.
     */
    const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
    const contentLeft = view.contentDOM.getBoundingClientRect().left;
    const anchor = view.posAtCoords({ x: contentLeft + 1, y: scrollerTop + 1 }, false);
    view.dispatch({
      effects: gutterCompartment.reconfigure(settings.showGutter ? lineNumbers() : []),
    });
    /*
     * A SECOND transaction, after the reconfigure, so the scroll is re-asserted against the widths
     * the new configuration produces rather than the ones it replaced.
     *
     * `yMargin: 0` where the #144 sites take the default, and the difference was measured too: the
     * default margin is 5px, which leaves the last few pixels of the PREVIOUS line peeking in above
     * the anchor — so the same E2E then read the top visible line as `line 015` where it had been
     * `line 016`. Restoring a scroll position should restore it, not nudge it; five pixels is
     * immaterial when #144 re-asserts a scroll across a remount, and is the whole assertion here.
     */
    view.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'start', yMargin: 0 }) });
    // No `eslint-disable` here, unlike the indent effect below: `settings.showGutter` really is the
    // whole dependency, because the value goes straight into the reconfigure rather than through a
    // helper that closes over anything else.
  }, [settings.showGutter]);

  // 049 FR-019: `editor.highlightOccurrences` takes effect in every open editor without a reload.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: occurrenceCompartment.reconfigure(occurrenceExtensionFor(settings.highlightOccurrences)),
    });
  }, [settings.highlightOccurrences]);
  // The app-wide context-menu host (FR-036/037): exactly one menu is open anywhere at a time, so
  // the editor asks for one rather than rendering its own.
  const { openMenu, updateMenu } = useContextMenu();
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;
  // 045 FR-170b / FR-170c — the Link menu opens at once and is updated in place when main answers.
  const updateMenuRef = useRef(updateMenu);
  updateMenuRef.current = updateMenu;
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * This view's replica of the document UI main owns (016, FR-028f · constitution XI).
   *
   * The view is no longer a source of truth. It echoes the user's keystroke instantly — typing
   * cannot wait for IPC — and sends the change to the authority, which orders it, rebases it if it
   * raced another view, and broadcasts the canonical result to every view including this one.
   */
  const replicaRef = useRef<DocumentReplica | null>(null);
  /**
   * DERIVED by the authority and pushed here — never computed locally. A view that decided for
   * itself whether the document was dirty would be a second owner of that state, which is exactly
   * what Principle XI forbids (and how 006's relay went wrong).
   */
  const dirtyRef = useRef(false);
  // The backing file could not be loaded (missing/deleted). Published to editor-state
  // so the TAB-open watcher (not this mount) raises the "cannot open" notice (FR-105).
  const fileMissingRef = useRef(false);
  /**
   * This editor's path could not be READ, so what it shows is not its file (027 / #161).
   *
   * Kept apart from `fileMissingRef` deliberately — see `EditorUiState.unloadable`. Driving the
   * banner from the missing-file flag was tried and reverted: it made the tab-open dialog fire on
   * the remounts FR-105 exempts.
   */
  const unloadableRef = useRef(false);
  /** WHY, where this view was the one that tried to read it (030 FR-052) — see `unloadableDetail`. */
  const unloadableDetailRef = useRef<string | undefined>(undefined);
  /**
   * This panel's INITIAL open has not answered yet (#369) — see `EditorUiState.openPending`.
   *
   * Set true by the mount effect and cleared the moment the open decides, whichever of the three
   * routes it took. It is the difference between "the file is there" and "nobody has looked yet",
   * which the two flags above cannot express between them, and which the missing-file scan needs in
   * order to wait on an answer rather than on 300 ms.
   */
  const openPendingRef = useRef(false);
  /**
   * A Replace landed on this DIRTY document's path (052 FR-012): the buffer is kept, the path is another
   * document's now, and the panel says so in its one replaced notice. The AUTHORITY decides it and relays it
   * (`replaced`); this only mirrors it, so a remount reads it from `getContent` rather than from a relay.
   */
  const replacedRef = useRef(false);

  // Build the metadata UI main needs for confinement / mirror. It rides with every dispatched
  // change because it is MUTABLE — projects come and go, a Save-As re-points the file — and the
  // authority must not act on a stale copy of it.
  const buildMeta = (): Record<string, unknown> => {
    const m = metaRef.current;
    const cfg = configRef.current;
    return {
      panelId,
      ownerKind: m.rootless ? 'subworkspace' : 'project',
      ownerProjectId: m.ownerProjectId,
      ownerRoot: m.projectRoot,
      allProjectRoots: m.projects.map((p) => p.rootFolder),
      tabId: m.tabId,
      absPath: cfg.filePath ?? null,
      encoding: cfg.encoding ?? 'utf8',
      hasBom: cfg.hasBom ?? false,
      lineEnding: cfg.lineEnding ?? m.settings.defaultLineEnding,
    };
  };

  const publishState = (): void => {
    const cfg = configRef.current;
    setEditorState(panelId, {
      filePath: cfg.filePath ?? null,
      displayName: cfg.filePath ? basename(cfg.filePath) : 'Untitled',
      ownerRoot: metaRef.current.projectRoot,
      ownerKind: metaRef.current.rootless ? 'subworkspace' : 'project',
      dirty: dirtyRef.current,
      fileMissing: fileMissingRef.current,
      unloadable: unloadableRef.current,
      unloadableDetail: unloadableRef.current ? unloadableDetailRef.current : undefined,
      openPending: openPendingRef.current,
      ownerProjectId: metaRef.current.ownerProjectId,
      movedOut: movedOutRef.current,
      replaced: replacedRef.current,
    });
  };

  /**
   * Enter or leave the moved-out state (050 FR-035). Moved out: the file is no longer this panel's to
   * read, so the could-not-read and missing flags clear (the moved notice is the one surface), the view
   * goes read-only and the flag rides the config. Back in (an undo): an ordinary editor again.
   */
  const applyMovedOut = (movedOut: boolean): void => {
    movedOutRef.current = movedOut;
    if (movedOut) {
      fileMissingRef.current = false;
      unloadableRef.current = false;
      unloadableDetailRef.current = undefined;
      openPendingRef.current = false;
      configRef.current = { ...configRef.current, movedOut: true };
    } else {
      const { movedOut: _gone, ...rest } = configRef.current;
      configRef.current = rest;
    }
    viewRef.current?.dispatch({ effects: readOnlyCompartment.reconfigure(movedOutExtensions(movedOut)) });
    publishState();
  };

  /**
   * The initial open has DECIDED — whatever it decided (#369).
   *
   * Called from every route out of the mount: the load answered, the authority's verification came
   * back, or there was no path to open at all. Publishes, because the whole point of the flag is
   * that somebody outside this hook is waiting to be told.
   */
  const openAnswered = (): void => {
    if (!openPendingRef.current) return;
    openPendingRef.current = false;
    publishState();
  };

  /**
   * Report a deliberate open that failed (FR-105 · 030 FR-030/FR-035).
   *
   * Missing-file warnings are gated by `editor.warnOnMissingFile`; everything else always shows.
   *
   * 030 removed the per-tab batch this used to build (FR-035), so this reports the PANEL as one
   * casualty and the notification model decides whether it joins a notice already speaking for the
   * same cause. A deliberate open is a single file by construction, so nothing here ever had a batch
   * to lose.
   */
  const maybeWarn = (
    entries: LoadErrorEntry[],
  ): void => {
    const os = win()?.osName ?? 'windows';
    for (const entry of entries) {
      if (isMissingReason(entry.reason) && !metaRef.current.settings.warnOnMissingFile) continue;
      reportPanelFailureRef.current({
        panelId,
        message: missingFileMessage(entry.reason),
        detail: missingFileDetail(entry, os),
      });
    }
  };

  const dirname = (p: string): string => {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i < 0 ? '' : p.slice(0, i);
  };
  const basename = (p: string): string => {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i < 0 ? p : p.slice(i + 1);
  };

  // Write the current content to `absPath` via UI main (confinement enforced there).
  // On refusal, surface a visible message and keep the buffer unsaved (FR-078/083).
  const writeTo = async (absPath: string, isNewPath: boolean): Promise<boolean> => {
    const cfg = configRef.current;
    // The authority writes the file, so everything this view has typed must have REACHED it first.
    // Saving with a keystroke still in flight would write the document as it was a moment ago —
    // silently, and to the user's file.
    await replicaRef.current?.settled();
    const meta = buildMeta();
    const result = await win()?.editor?.save({
      panelId,
      absPath: isNewPath ? absPath : undefined,
      lineEnding: (meta.lineEnding as LineEndingId) ?? metaRef.current.settings.defaultLineEnding,
      ownerKind: meta.ownerKind,
      ownerRoot: meta.ownerRoot,
      allProjectRoots: meta.allProjectRoots,
    });
    if (!result || result.ok !== true) {
      if (result && 'reason' in result && result.reason === 'replaced') {
        // The standing replaced notice already says it (one condition, one notice) — flashed, not repeated.
        flashReplacedNotice(panelId);
      } else if (result && 'reason' in result) {
        reportSaveError(result.reason, metaRef.current.rootless ? 'subworkspace' : 'project');
      }
      return false;
    }
    // Built from the config AS IT IS NOW, not the `cfg` snapshotted before the awaits: main relays
    // `movedOut: false` (a Save As into the owner project) before this invoke returns, and writing the
    // old config back would resurrect the flag in the persisted layout.
    const now = configRef.current;
    configRef.current = {
      ...now,
      filePath: result.absPath,
      encoding: result.encoding,
      lineEnding: result.lineEnding,
      hasBom: cfg.hasBom ?? false,
    };
    // `movedOut` named explicitly: the store MERGES, so an absent key would leave the layout's flag standing.
    ws.updatePanelConfig(panelId, {
      ...configRef.current,
      movedOut: configRef.current.movedOut === true ? true : undefined,
    });
    fileMissingRef.current = false; // a successful save (re)created the file on disk
    publishState();
    // Save-As gave the document a new name, and the name is what decides the language (FR-002a):
    // saving `notes` as `notes.py` must highlight it as Python, there and then.
    //
    // The counts follow the name too (040 FR-007). The FIGURES are unchanged — a save writes what
    // is already in the buffer — but they are keyed by the document's identity, and the identity is
    // exactly what just changed, so the bar would go on reading the untitled key it was written to.
    if (isNewPath) {
      refreshLanguage();
      republishCounts();
    }
    return true;
  };

  // Prompt for a location (file-name pre-filled) then save there (new doc / Save As).
  const chooseThenSave = async (): Promise<boolean> => {
    const cfg = configRef.current;
    const chosen = await win()?.editor?.chooseSavePath?.({
      defaultDir: cfg.filePath ? dirname(cfg.filePath) : (metaRef.current.projectRoot ?? undefined),
      // FR-083: default the file-name field to the current name or the Panel's name
      // (read through the ref so the Panel's current derived title is used, not the mount-time one).
      // 048 FR-032 / FR-130 — the name the panel SHOWS: a generated title is plain "Blank Panel".
      defaultName: cfg.filePath
        ? basename(cfg.filePath)
        : isDefaultPanelName(metaRef.current.title)
          ? BLANK_PANEL_NAME
          : metaRef.current.title,
    });
    if (!chosen) return false; // cancelled
    return writeTo(chosen, true);
  };

  const save = async (): Promise<boolean> => {
    // Save is unavailable while moved out (FR-036): the file belongs to another project now, and main
    // would refuse it. Save As is the way out, so nothing here is silent — the notice says why.
    if (movedOutRef.current) return false;
    // A REPLACED document's path is another file's: a plain Save is refused by the authority, so it is not
    // even asked — the standing notice flashes instead (052 FR-012, one condition one notice).
    if (replacedRef.current) {
      flashReplacedNotice(panelId);
      return false;
    }
    const cfg = configRef.current;
    // Pathed → save in place; new/unpathed → choose a location (name pre-filled).
    return cfg.filePath ? writeTo(cfg.filePath, false) : chooseThenSave();
  };

  // Save As: always choose a new location, even for an already-pathed doc (FR-084).
  const saveAs = async (): Promise<boolean> => chooseThenSave();

  /**
   * Re-resolve the document's language and swap the grammar in place (016, FR-002a).
   *
   * Called ONLY where the document's IDENTITY or CONTENT is replaced — first load, opening another
   * file into this panel, Save-As, revert, and an external reload. Never on a keystroke: detection
   * reads the file's extension, which typing cannot change, and re-running it per edit would be
   * pure cost. (It is also why a `#!` shebang typed into a file changes nothing — FR-002.)
   *
   * The persisted OVERRIDE is read here too, and it outranks detection (FR-005a): a panel opening
   * a file adopts the user's past decision about it rather than overruling it.
   */
  const refreshLanguage = (): void => {
    const view = viewRef.current;
    if (!view) return;
    const filePath = configRef.current.filePath ?? null;
    const m = metaRef.current;

    // Claim the panel's language slot NOW, synchronously. Everything below suspends — a database
    // read, then a dynamic import of the grammar — and by the time it resumes the panel may be
    // showing a different file entirely. See `claimLanguage`.
    const fresh = claimLanguage(panelId);
    const isCurrent = (): boolean => viewRef.current === view && fresh();

    void loadDocumentOverride({
      panelId,
      projectId: m.ownerProjectId ?? null,
      relPath: toRelPath(m.projectRoot, filePath),
      filePath,
      documents: m.documents,
      stillMounted: isCurrent,
    }).then(() => {
      // The language decides the indentation when the file itself has none to read, so the two are
      // resolved together — not in two effects that could disagree for a frame.
      if (!isCurrent()) return;
      refreshIndent();
      // Re-assert a pending restored scroll AFTER the language + indent reconfigure
      // (issue #144). Those reconfigures re-render a frame after `initialise` scrolled the
      // viewport and would otherwise drop it back to the top. Doc-position based, so
      // re-applying is idempotent. One-shot: cleared so a later user-driven language
      // change does not yank the viewport.
      const anchor = pendingScrollAnchorRef.current;
      if (anchor != null && anchor <= view.state.doc.length) {
        pendingScrollAnchorRef.current = null;
        view.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'start' }) });
      }
    }).finally(() => {
      // 044 FR-121 (R-E4) — the mount's placement has now run (or had nothing to re-assert): a
      // preview's held request may move this view. Only for the refresh that is still current, whose
      // re-assert above is the last word on the restored scroll.
      if (!placementPendingRef.current || !isCurrent()) return;
      placementPendingRef.current = false;
      scrollRelayRef.current?.ready();
    });
  };

  /**
   * Read what the document ALREADY does, from its own lines (FR-018a).
   *
   * Called only where the content is REPLACED — a load, a revert, an external reload — never on a
   * keystroke: a file's indentation style is not something typing changes, and re-inferring it per
   * edit would be pure cost. Critically, this only DECIDES what the next indent inserts; it never
   * rewrites a line (FR-018d).
   */
  const reinferIndent = (text: string): void => {
    inferredRef.current = inferIndent(text);
    refreshIndent();
  };

  // Load a file into THIS editor, replacing its current document (open-from-tree).
  // UI main replaces the document and broadcasts the replacement to every view of it,
  // so there is nothing to apply here — this view receives it like any other.
  const openFile = async (absPath: string, opts?: { navigation?: EditorLoadNavigation }): Promise<void> => {
    // US8 (#154): opening a DIFFERENT file IN PLACE. Save the outgoing document's scroll anchor
    // (only when the pref is on) and flag the incoming document RESET so it applies the scroll
    // policy — restore the incoming file's saved anchor (on), or reset to the top (off).
    const outgoing = configRef.current.filePath;
    if (outgoing && outgoing !== absPath) {
      const restore = metaRef.current.settings.saveDocumentScroll;
      if (restore) docScrollByPath.set(outgoing, currentScrollAnchorRef.current);
      pendingOpenScrollRef.current = { path: absPath, restore };
      /*
       * 045 FR-167 (review round four, editor L1) — the hovered link belongs to the OUTGOING
       * document. A Ctrl+click that loads its target into this same panel (023 FR-025's "Active
       * Editor") never moves the pointer, so `mouseleave` never fires and the hit would survive the
       * swap — leaving the status bar naming a link the panel no longer shows. Cleared here, where
       * the document changes, rather than only in `disposeEditor`, which a swap never reaches.
       */
      clearEditorHoveredLink(panelId);
    }
    // 044 US7 — every load carries the panel's persisted history (main adopts it only when it holds no
    // record), and a Back / Forward step carries its intent, so main moves the position rather than
    // recording (contracts/navigation-history.md §3, §6).
    const history = liveHistoryRef.current;
    const loaded = await win()?.editor?.load({
      ...buildMeta(),
      absPath,
      ...(history !== undefined ? { history } : {}),
      ...(opts?.navigation ? { navigation: opts.navigation } : {}),
    });
    if (loaded && loaded.ok === true) {
      configRef.current = {
        filePath: absPath,
        encoding: loaded.encoding,
        hasBom: loaded.hasBom,
        lineEnding: loaded.lineEnding,
        // 052 R1 — the path was held by another panel's document, so this panel now shows THAT one (the
        // relay that said so arrived before this answer, and this assignment must not undo it).
        ...(loaded.linkedTo !== undefined ? { linkedTo: loaded.linkedTo } : {}),
      };
      // `linkedTo` named explicitly: the store MERGES, so an ordinary open must remove a stale link.
      ws.updatePanelConfig(panelId, { ...configRef.current, linkedTo: loaded.linkedTo });
      fileMissingRef.current = false;
      unloadableRef.current = false; // the path read, so whatever the banner was about is over
      unloadableDetailRef.current = undefined;
      // A file opened in place is this project's own file: the moved-out state belongs to the document it left.
      if (movedOutRef.current) {
        applyMovedOut(false);
        ws.updatePanelConfig(panelId, { movedOut: undefined });
      }
      publishState();
      // …and the counts belong to the new document too (040 FR-007). Same race, same remedy: see
      // `republishCounts`.
      republishCounts();
      // The document's IDENTITY changed, and its name is what decides its language (FR-002a).
      //
      // This must happen HERE, and not only when the replacement content arrives: the authority
      // broadcasts that replacement as soon as it loads the file, so it can reach this view BEFORE
      // the line above records the new path — and language detection reading the OLD path resolves
      // the OLD language. The file would open with its content and no highlighting.
      refreshLanguage();
    } else if (loaded && loaded.ok === false && opts?.navigation && isMissingReason(loaded.reason)) {
      /*
       * 044 FR-106d — a Back / Forward step onto a file that is gone or cannot be read. Main has MOVED the
       * position and replaced the document with an empty, unloadable one at that path (its reset reaches this
       * view like any other), so this panel now holds THAT file — in the could-not-read state a restore
       * reaches for the same condition: the banner, naming it, for as long as it is true. The banner is the
       * condition's one surface, so no second, one-shot notice is raised beside it.
       */
      configRef.current = { ...configRef.current, filePath: absPath };
      ws.updatePanelConfig(panelId, { filePath: absPath });
      fileMissingRef.current = true;
      unloadableRef.current = true;
      unloadableDetailRef.current = missingFileDetail(
        { filePath: absPath, reason: loaded.reason },
        win()?.osName ?? 'windows',
      );
      publishState();
      republishCounts();
      refreshLanguage();
    } else if (loaded && loaded.ok === false) {
      // A deliberate open of a bad/missing file: warn immediately (single file).
      fileMissingRef.current = isMissingReason(loaded.reason);
      maybeWarn([{ filePath: absPath, reason: loaded.reason }]);
      publishState();
    }
  };

  /**
   * Re-read this document's file and adopt what is on disk NOW (027 / #161, FR-013).
   *
   * Performed by the AUTHORITY — it owns the document, and the replacement reaches every view of it
   * through the ordinary reset broadcast, so a mirrored editor reloads in both windows at once.
   *
   * It deliberately does NOT go through `openFile`. That path warns on failure, immediately, by
   * design ("a deliberate open of a bad file is news") — and routing a reload through it is what
   * made the first attempt at this issue pop the tab-open dialog on remounts FR-105 exempts. A
   * reload that finds the path still broken is the state the user is already looking at.
   */
  const reloadFromDisk = async (): Promise<boolean> => {
    const result = await win()?.editor?.reload?.(panelId);
    if (!result || result.ok !== true) return false;
    fileMissingRef.current = false;
    unloadableRef.current = false;
    unloadableDetailRef.current = undefined;
    publishState();
    // The bytes decide the encoding and the name decides the language — both may have changed
    // while the path was unreadable (FR-002a).
    refreshLanguage();
    return true;
  };

  // Revert: discard all unsaved changes back to the loaded/last-saved content (FR-075).
  // Performed by the AUTHORITY — it owns the document and knows what is on disk — and
  // broadcast to every view, so a mirrored editor reverts in both windows at once.
  const revert = (): void => {
    void win()?.editor?.revert(panelId);
  };

  // Register imperative actions for the app-level keybinding handler + open-from-tree.
  useEffect(() => {
    registerEditorActions(panelId, {
      save,
      saveAs,
      // Moved out or REPLACED (052 FR-012): a plain Save is refused, so "save first" is Save As.
      saveForClose: () => (movedOutRef.current || replacedRef.current ? saveAs() : save()),
      isDirty: () => dirtyRef.current,
      openFile,
      revert,
      reloadFromDisk,
    });
    return () => unregisterEditorActions(panelId);
    // save/isDirty/openFile read refs, so a stable registration is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId]);

  /**
   * An indentation SETTING changed — bring open editors into step (FR-018).
   *
   * Editors whose file has an inferred style are unaffected, and that is not an oversight: the file
   * outranks the setting, so a document that already indents with tabs goes on indenting with tabs
   * however the preference moves. Changing the setting must never silently start mixing styles into
   * an open document (FR-018d) — the setting decides what a NEW indent inserts where the file has no
   * opinion, and nothing more. `effectiveIndent` already encodes that, so re-running it is enough.
   */
  useEffect(() => {
    refreshIndent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.indent, settings.indentByLanguage]);

  // A rebind must reach the LIVE view (FR-017): rebinding `cut-line` moves the behaviour to the new
  // chord in every open editor, there and then, and returns `Ctrl+X` to a native cut. Telling the
  // user to reopen the panel for their keybinding to take effect is not an option anybody would
  // think to mention, so it would simply look broken.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: commandKeymapCompartment.reconfigure(
        editorCommandKeymap(
          keybindings,
          // Both deps, every time. Passing only the line ending here — which is what this call did
          // until the renderer was first typechecked — left `indent` undefined in the rebuilt
          // keymap, so Tab and Shift+Tab threw the moment the user changed ANY keybinding. Nothing
          // caught it: the renderer is compiled by Vite, which strips types without checking them.
          commandsFor({
            lineEnding: currentLineEnding,
            indent: currentIndent,
            toggleWrap,
            markdownFold: markdownFoldDeps(),
          }),
        ),
      ),
    });
  }, [keybindings, currentLineEnding, currentIndent, toggleWrap, markdownFoldDeps]);

  // Mount the CodeMirror view and initialise content.
  useEffect(() => {
    if (!container) return;

    // Unique per VIEW, not per panel: a mirrored document is ONE panel shown in two windows, so
    // panelId is exactly what its two views have in common. The authority tells them apart by this,
    // and a view that could not be told from its mirror would apply its own edits twice.
    const viewId = crypto.randomUUID();

    const replica = new DocumentReplica(panelId, viewId, (msg) => {
      win()?.editor?.dispatch({ ...buildMeta(), ...msg });
    });
    replicaRef.current = replica;
    /** Set once the view exists (below); the listener can fire only after that. */
    let scrollRelay: EditorScrollRelay | null = null;

    const updateListener = EditorView.updateListener.of((update) => {
      // 044 FR-121f — the top line can change with no scroll event (lines inserted above the viewport,
      // a reflow at the top). Its own guard, above the one below, which it must never widen.
      if (update.docChanged || update.geometryChanged) scrollRelay?.onUpdate(update);
      /*
       * 040 US1 — the status bar's readouts ride THIS listener (FR-008: no figure adds one of its
       * own, in the hottest path in the editor).
       *
       * ══ WHY THESE TWO LINES ARE ABOVE THE GUARD AND NOT PART OF IT ══
       *
       * `if (!update.docChanged) return;` guards everything below it, and everything below it
       * ASSUMES a document change: `replica.record` reports the edit to the document authority,
       * and the auto-save timer starts a save. A caret move is `update.selectionSet`, not
       * `docChanged`, so the obvious widening is to relax that line to
       * `if (!update.docChanged && !update.selectionSet) return;` — and it is WRONG. Every arrow
       * key would then fall into `replica.record` and report a change that never happened: an
       * empty edit against the shared undo history, invisible on screen and undiagnosable later.
       *
       * So the new concerns are added ABOVE, each with its own guard, and the existing line is
       * untouched (research.md D1). A reviewer confirms the old behaviour is intact by reading one
       * line, and `component/editor-update-listener.test.ts` fails if anyone relaxes it.
       *
       * The caret is computed SYNCHRONOUSLY (FR-008a) — a line lookup CodeMirror has already
       * indexed. The counts are only SCHEDULED (FR-008b): they are a full document scan, the
       * store debounces them at 200 ms, and the document is not even flattened until that scan
       * runs (FR-008c).
       */
      if (update.docChanged || update.selectionSet) publishCaret(panelId, update.state);
      if (update.docChanged) {
        scheduleDocumentMetrics(metricsDocKey(), () => update.state.doc.toString());
      }
      if (!update.docChanged) return;
      // A change the authority just gave us. Sending it back would apply it twice.
      if (update.transactions.some((tr) => tr.annotation(fromAuthority))) return;

      // The user's edit is ALREADY on screen. Tell the authority about it; what comes back is the
      // canonical version of it, which this view will not re-apply (it already has it).
      replica.record(
        update.changes,
        update.startState.selection.toJSON(),
        mergeClassOf(update),
      );

      // Debounced auto-save (Phase C) — only when enabled and the doc is pathed.
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      if (metaRef.current.settings.autoSave && configRef.current.filePath) {
        autoSaveTimer.current = setTimeout(() => {
          if (dirtyRef.current) void save();
        }, metaRef.current.settings.autoSaveDebounceMs);
      }
    });

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: '',
        extensions: [
          /*
           * The line-number gutter, in a compartment so `editor.showGutter` can flip it on the live
           * view (040 FR-041/FR-043). Seeded from `metaRef.current.settings`, NOT from the
           * `settings` closure: this mount effect's deps are `[container, panelId]`, so the closure
           * it captured is fixed for the life of the view and would seed a panel opened later with
           * whatever the setting was when the hook first ran.
           */
          gutterCompartment.of(metaRef.current.settings.showGutter ? lineNumbers() : []),
          readOnlyCompartment.of(movedOutExtensions(movedOutRef.current)),
          drawSelection(),
          highlightActiveLine(),
          /**
           * A block is MANY selection ranges, and CodeMirror will not keep them without this (US6).
           *
           * `allowMultipleSelections` defaults to FALSE, and when it is off every transaction's
           * selection is quietly reduced to its main range — so a block of ten rows becomes one
           * cursor on the row the head happened to be on. Nothing throws. The command runs, the
           * caret moves, and the editor looks like it did what you asked; only the block is gone,
           * so the next keystroke edits ONE line instead of ten.
           *
           * It is required by the Alt+drag gesture below just as much as by the keyboard commands —
           * neither can produce a block without it.
           */
          EditorState.allowMultipleSelections.of(true),
          /**
           * Rectangular (column) selection by Alt+drag (016, US6 · FR-025).
           *
           * CodeMirror provides the gesture itself, so the mouse half of this story is nearly free —
           * and deliberately NOT a command: FR-025 asks for a drag, and a drag has no chord to
           * rebind. `crosshairCursor` shows the modifier is live, so the user can tell the editor is
           * about to do something different before they commit to the drag.
           */
          rectangularSelection({
            // The modifier comes from the shipped-defaults record, per platform (FR-017e) — not from
            // CodeMirror's hardcoded Alt, which happened to agree with the Windows value and would
            // have quietly stopped agreeing the day a second platform shipped.
            eventFilter: (event) =>
              event.button === 0 &&
              columnSelectHeld(COLUMN_SELECT_MODIFIER, {
                alt: event.altKey,
                ctrl: event.ctrlKey,
                meta: event.metaKey,
              }),
          }),
          crosshairCursor({ key: CROSSHAIR_KEY }),
          /** The keyboard half's goal columns (`Shift+Alt+Arrow…`). */
          columnBlockField,
          /**
           * Undo and Redo (016, FR-026c/T116).
           *
           * CodeMirror's `history()` is GONE, and with it its `undo`/`redo` commands — they operate
           * on a state field that no longer exists, so binding them here would leave Ctrl+Z a dead
           * no-op that looks perfectly correct in the source. The history now belongs to the
           * DOCUMENT, in UI main, which is what lets an Undo pressed in one mirrored view revert an
           * edit made in the other (FR-026c).
           *
           * `Prec.highest` so nothing below can claim these chords first. They stay NATIVE and
           * unregistered — FR-017c keeps Undo/Redo off the rebindable command list deliberately.
           */
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-z',
                preventDefault: true,
                run: () => {
                  win()?.editor?.undo({ panelId, viewId });
                  return true;
                },
              },
              {
                key: 'Mod-y',
                mac: 'Mod-Shift-z',
                preventDefault: true,
                run: () => {
                  win()?.editor?.redo({ panelId, viewId });
                  return true;
                },
              },
              {
                key: 'Mod-Shift-z',
                preventDefault: true,
                run: () => {
                  win()?.editor?.redo({ panelId, viewId });
                  return true;
                },
              },
            ]),
          ),
          /**
           * The rebindable editor commands (016, US3 · FR-016/FR-017).
           *
           * Inside CodeMirror at `Prec.highest`, because `defaultKeymap` already owns several of
           * these chords and a window-level listener would lose to it — and because they are
           * EDITOR-scoped: `Ctrl+X` in the File Explorer must still cut a FILE.
           *
           * In a COMPARTMENT so a rebind reaches the live view (see the effect below).
           */
          commandKeymapCompartment.of(
            editorCommandKeymap(
              keybindingsRef.current,
              commandsFor({
                lineEnding: currentLineEnding,
                indent: currentIndent,
                toggleWrap,
                markdownFold: markdownFoldDeps(),
              }),
            ),
          ),
          /**
           * Paste, honouring the SHAPE of what was copied (FR-015a).
           *
           * Bound natively and left UNREGISTERED — FR-017c keeps Cut/Copy/Paste off the rebindable
           * command list deliberately, so this is not an ActionId and does not go through the
           * keybinding editor. It sits at `Prec.highest` for the same reason as the commands above.
           */
          Prec.highest(keymap.of([{ key: 'Mod-v', preventDefault: true, run: pasteCommand() }])),
          /**
           * The NATIVE Ctrl+C / Ctrl+X, routed through the clipboard seam so the SELECTION decides
           * the mode whichever route performed the copy (FR-016b). Unregistered, like paste above.
           */
          clipboardEventHandlers(currentLineEnding),
          /**
           * The editor's CONTENT context menu (016, FR-012) — distinct from 006's panel-HEADER
           * menu, which acts on the panel rather than on the text (FR-014).
           */
          EditorView.domEventHandlers({
            /*
             * 045 FR-040, FR-041 — G1, G3 and G4.
             *
             * The press is claimed ONLY over a resolved link; otherwise `false` lets CodeMirror's own
             * multi-cursor handler run, which is FR-041 by default rather than by imitation. The
             * release decides between a click and a drag — see `link-decorations.ts`.
             */
            mousedown: (event, target) => linkPointer.mousedown(event, target),
            mouseup: (event, target) => linkPointer.mouseup(event, target),
            /*
             * 045 FR-167 — the status-bar readout's source. `linkAtPosition` is the SAME hit-test the
             * decoration and the pointer handlers use, so the readout can never name a link the mark
             * does not draw. Never claims the event (always `false`): this is an observer, not a
             * gesture.
             */
            mousemove: (event, view) => {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              const hit = pos === null ? null : linkAtPosition(view.state, pos, linkDeps);
              setEditorHoveredLink(panelId, hit);
              return false;
            },
            mouseleave: () => {
              setEditorHoveredLink(panelId, null);
              return false;
            },
            contextmenu: (event, target) => {
              // Right-clicking INSIDE a selection preserves it — the user is about to act on the
              // thing they right-clicked. Outside it, the caret moves to the click (FR-012a).
              placeCaretForContextMenu(target, event);
              const x = event.clientX;
              const y = event.clientY;
              const open = (): void =>
                void openMenuRef.current(
                x,
                y,
                editorContentMenu({
                  view: target,
                  panelId,
                  viewId,
                  // 048 FR-015 — the Split submenu, with the live chords.
                  split: { panelId, keybindings: keybindingsRef.current },
                  lineEnding: () =>
                    configRef.current.lineEnding ?? metaRef.current.settings.defaultLineEnding,
                  wordWrap: {
                    on: documentWordWrap(
                      wrapDocKeyRef.current,
                      metaRef.current.settings.defaultWordWrap,
                    ),
                    toggle: toggleWrap,
                    chord: firstBinding(keybindingsRef.current, 'editor.toggleWordWrap'),
                  },
                  /*
                   * 033 US2 (FR-027) — the menu route to Go To Line.
                   *
                   * The modal lives OUTSIDE this view (`navigate/goto-line.tsx`, mounted by
                   * `NavigationChrome`), so the item asks the one-modal slot to open it rather than
                   * running a CodeMirror command. That is also why this is not a keymap entry: the
                   * chord is dispatched at the window level so its EDITOR_ONLY scope gate can run
                   * (A2), and the menu simply reaches the same opener by a different route.
                   *
                   * The chord is read at MENU-OPEN time, like the language name above and unlike a
                   * captured value: a rebind must show up on the next right-click, not the next
                   * restart.
                   */
                  gotoLine: {
                    open: () => setNavigationModal({ kind: 'gotoLine', panelId }),
                    chord: firstBinding(keybindingsRef.current, 'navigate.gotoLine'),
                  },
                  /*
                   * 044 FR-002 — Open Preview, decided at MENU-OPEN time for Go To Line's reason: the
                   * file, the provider's enabled setting and whether a preview is already open (in any
                   * window) all change under a live view, and a captured answer would offer a preview
                   * that already exists. `rootless` editors belong to no project and are offered none.
                   */
                  openPreview: (() => {
                    const filePath = configRef.current.filePath ?? null;
                    const meta = metaRef.current;
                    return {
                      affordance: currentEditorPreviewAffordance({
                        registry: previewProvidersRef.current.registry,
                        settings: meta.settings.previews,
                        filePath,
                        projectRoot: meta.rootless ? null : meta.projectRoot,
                      }),
                      open: () => {
                        if (filePath === null) return;
                        void requestPreviewOpen({
                          absPath: filePath,
                          projectId: meta.ownerProjectId ?? panel.originProjectId,
                          requesterPanelId: panelId,
                        });
                      },
                      chord: firstBinding(keybindingsRef.current, 'preview.open'),
                    };
                  })(),
                  /*
                   * 044 FR-122b — Synchronise Scrolling, read at menu-open time for the same reason. The
                   * builder draws it only where Open Preview is drawn (FR-122a); choosing it flips the one
                   * global setting from the value this window holds NOW.
                   */
                  syncScroll: {
                    on: metaRef.current.settings.previews.syncScroll,
                    toggle: () => void toggleSyncScroll(metaRef.current.settings.previews.syncScroll),
                    chord: firstBinding(keybindingsRef.current, 'preview.toggleSyncScroll'),
                  },
                  // Read at menu-open time, not captured: the language changes under a live view
                  // (detection settling, an override chosen), and a captured copy would name a
                  // language the document has since stopped being.
                  languageName: languageName(getPanelLanguage(panelId)?.languageId ?? 'plaintext'),
                  /*
                   * 047 US3 (FR-036, contracts "Editor body menu") — the fold rows, Markdown
                   * documents only. `at` is the innermost section containing the CLICKED position:
                   * `placeCaretForContextMenu` already moved the caret there, above. The handlers
                   * reuse `markdownFoldCommand` exactly as the chords and the gutter do (R5's single
                   * implementation, Principle VIII) rather than re-deriving the fold logic here.
                   */
                  markdownFold: isMarkdown
                    ? (() => {
                        const sections = markdownSections(
                          markdownHeadingRecords(target.state),
                          target.state.doc.lines - 1,
                        );
                        const cursorLine0 =
                          target.state.doc.lineAt(target.state.selection.main.head).number - 1;
                        const at = sectionAtLine(sections, cursorLine0);
                        const deps = markdownFoldDeps();
                        return {
                          section: at
                            ? {
                                slug: at.slug,
                                level: at.level,
                                collapsed: isCollapsed(foldStateValueRef.current, at.slug),
                              }
                            : null,
                          hasSections: sections.length > 0,
                          collapseSection: () => void markdownFoldCommand('collapseSection', deps)(target),
                          expandSection: () => void markdownFoldCommand('expandSection', deps)(target),
                          collapseAllInside: () => void markdownFoldCommand('collapseAllInside', deps)(target),
                          expandAllInside: () => void markdownFoldCommand('expandAllInside', deps)(target),
                          collapseAll: () => void markdownFoldCommand('collapseAll', deps)(target),
                          expandAll: () => void markdownFoldCommand('expandAll', deps)(target),
                          chords: {
                            collapseSection: firstBinding(keybindingsRef.current, 'markdown.collapseSection'),
                            expandSection: firstBinding(keybindingsRef.current, 'markdown.expandSection'),
                            collapseAllInside: firstBinding(keybindingsRef.current, 'markdown.collapseAllInside'),
                            expandAllInside: firstBinding(keybindingsRef.current, 'markdown.expandAllInside'),
                            collapseAll: firstBinding(keybindingsRef.current, 'markdown.collapseAll'),
                            expandAll: firstBinding(keybindingsRef.current, 'markdown.expandAll'),
                          },
                        };
                      })()
                    : undefined,
                }),
              );
              event.preventDefault();
              // 045 FR-169 / FR-171 — over a link with nothing selected, the ONE Link menu opens
              // INSTEAD of this panel's menu, exactly as a terminal's does; otherwise the content
              // menu, unchanged.
              if (!openEditorLinkMenuRef.current(target, event, x, y)) open();
              return true;
            },
          }),
          keymap.of(defaultKeymap),
          // 024 US1: word wrap in a compartment so the toggle/menu/chord flip it live (per document).
          wrapCompartment.of(
            documentWordWrap(wrapDocKey, metaRef.current.settings.defaultWordWrap)
              ? EditorView.lineWrapping
              : [],
          ),
          updateListener,
          // Syntax highlighting (016). The grammar sits in a COMPARTMENT so it can be swapped on a
          // live view — remapping an extension, or picking a language by hand, re-highlights the
          // open document without reopening it (FR-004b). It starts empty: the language is not
          // known until the content has loaded and a path exists to detect from.
          languageCompartment.of([]),
          // The document's EFFECTIVE indentation (FR-018): what Tab inserts, and how wide a literal
          // tab is drawn. Re-decided whenever the file, its language, or the setting changes.
          indentCompartment.of(indentExtensions(currentIndent())),
          throngHighlighting,
          // The legacy-language function-name overlay (021, #84 follow-up). Placed AFTER
          // throngHighlighting on purpose: a lower-precedence mark decoration nests INSIDE the
          // syntax-highlight span, so its inline colour paints the innermost element and wins over
          // the `variableName` colour underneath. Empty until a legacy language is applied
          // (`applyLanguage` reconfigures it); first-class grammars keep it empty.
          functionHighlightCompartment.of([]),
          // Section folding (047 US3, research R4) — CodeMirror's folding extension plus the heading gutter, in a
          // compartment so a language change (or `editor.showGutter`/a theme change) reaches the
          // live view without reopening it. Starts empty: the language is not known at creation, and
          // the effect that installs it runs once `isMarkdown` is (research R2's own reasoning for
          // `languageCompartment`, one compartment along).
          foldCompartment.of([]),
          /*
           * 045 FR-002 / FR-060 / FR-100 — file and web links, in a compartment so a change of
           * `editor.links.detectInEditors` rebuilds the marks on a live view. AFTER the
           * highlighting, so the underline nests inside the syntax span rather than wrapping it —
           * the same ordering the function overlay above needs, and for the same reason.
           */
          linkCompartment.of(editorLinkExtension(linkDeps)),
          // In-panel find/replace (013): paints the match decorations. The bar drives
          // it through the controller registered below; CodeMirror's own search panel
          // is deliberately not used (its controls could not be theme-token driven).
          searchHighlightExtension,
          // 049 (#324): other instances of the selected text, softly tinted — in a compartment so
          // `editor.highlightOccurrences` reaches a live view without a remount (FR-019).
          occurrenceCompartment.of(occurrenceExtensionFor(metaRef.current.settings.highlightOccurrences)),
          /*
           * CODEMIRROR MUST NOT EAT THE FILE DROP.
           *
           * Its default `drop` handler reads the dropped files with a FileReader and INSERTS THEIR TEXT
           * into the document. In an editor that is a reasonable default; in THIS application it is a
           * disaster, because dropping a file here already means something else — open it — and the
           * confinement rule may be about to REFUSE it.
           *
           * So a file the rule rejected still had its entire contents poured into the buffer, marked it
           * dirty, and synced it to every other window holding that document. The refusal notice
           * appeared on top of the damage it had failed to prevent. Worse, it happened for ACCEPTED
           * files too: the file opened in one panel and was simultaneously pasted into another.
           *
           * Returning `true` tells CodeMirror the event is handled and it must keep its hands off. The
           * event still bubbles to the panel's drop target, which is the thing that actually knows what
           * a dropped file means.
           */
          EditorView.domEventHandlers({
            drop: (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files'),
            dragover: (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files'),
          }),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': {
              fontFamily: "var(--throng-font-editor-family, \"Consolas, 'Courier New', monospace\")",
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    // MT-04 — the fold compartment starts empty; a view built after `isMarkdown` was already true
    // (a re-parented panel) is filled here, since the install effect has no reason to run again.
    installFoldRef.current();
    // Track the first visible line's DOCUMENT position so the scroll can be persisted on
    // unmount (issue #144). Reading `scrollDOM.scrollTop` in the unmount cleanup can come
    // back 0 (the element is being torn out of layout), so keep the last scrolled anchor
    // here instead — and as a document position, not a pixel offset, so it restores
    // through CodeMirror's own scroll machinery (see editor-view-state.ts).
    let lastScrollAnchor = 0;
    const onScroll = (): void => {
      const v = viewRef.current;
      if (v) {
        lastScrollAnchor = v.lineBlockAtHeight(v.scrollDOM.scrollTop).from;
        currentScrollAnchorRef.current = lastScrollAnchor; // US8 (issue 154): visible to openFile
      }
    };
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    // 049 FR-000a: this view's live caret, selection and scroll for the cross-window hand-off — read when a panel
    // is sent to another window, which is a copy: the receiving renderer's `editor-view-state` starts empty.
    const unregisterStateCapture = registerPanelStateCapture(panelId, 'editor', () => ({
      selection: view.state.selection.toJSON(),
      scrollAnchor: lastScrollAnchor,
    }));
    // The status strip and the language picker live OUTSIDE this view and must be able to
    // reconfigure it when the user picks a language (016).
    registerEditorView(panelId, view);
    /*
     * 044 FR-113, FR-121 — two-way scroll sync (`editor-scroll-relay.ts`): publishes this view's top
     * source line, at most once a frame, for a preview beside it — at once, so a preview that mounted
     * first finds this view — and registers the scroller a preview's request drives. Requests are held
     * until `initialise` has placed the view (`placementPendingRef`, released by `refreshLanguage`).
     */
    placementPendingRef.current = true;
    const relay = attachEditorScrollRelay(view, panelId, {
      raf: (callback) => requestAnimationFrame(callback),
      caf: (handle) => cancelAnimationFrame(handle),
    });
    scrollRelay = relay;
    scrollRelayRef.current = relay;
    // Register this editor's focus so keyboard move-focus (012) can route DOM focus
    // (and the caret) into it when it becomes the active panel.
    registerPanelFocus(panelId, () => viewRef.current?.focus());
    // Register this editor's search engine (013) so the shared find bar — and the
    // rebindable find/replace commands — can drive whichever panel is active.
    attachPanelSearch(
      panelId,
      createEditorSearchController(
        view,
        () => view.state.readOnly,
        // Editing while the bar is open re-runs the query, so the count the user sees keeps
        // pace with the document they are changing.
        (count) => updateCount(panelId, count),
        {
          // 049 R5: a match inside a collapsed Markdown section is opened through the fold authority.
          revealBeforeScroll: (pos) =>
            isMarkdownRef.current &&
            revealOffset(view, pos, {
              docKey: () => wrapDocKeyRef.current,
              panelId,
              seedDefault: () => initialFold(metaRef.current.settings.markdownSectionsOpen),
            }),
          revealSections: (slugs) => {
            if (!isMarkdownRef.current) return;
            revealSections(view, slugs, {
              docKey: () => wrapDocKeyRef.current,
              panelId,
              seedDefault: () => initialFold(metaRef.current.settings.markdownSectionsOpen),
            });
          },
          hidingSections: (pos) =>
            isMarkdownRef.current
              ? hidingSections(
                  liveSections(view),
                  view,
                  pos,
                  documentFoldState(wrapDocKeyRef.current, initialFold(metaRef.current.settings.markdownSectionsOpen)),
                )
              : [],
        },
      ),
    );

    let cancelled = false;
    /** Canonical messages that arrived before this view knew which version it was starting from. */
    const queued: { change?: CanonicalChangeMsg; reset?: ResetDocumentMsg }[] = [];
    let ready = false;

    /** Apply one canonical change from the authority — never echoed back (see `fromAuthority`). */
    const applyChange = (change: CanonicalChangeMsg): void => {
      const target = viewRef.current;
      if (!target) return;
      dirtyRef.current = change.dirty;
      const apply = replica.receive(change);
      if (!apply) {
        publishState(); // our own edit, acknowledged: nothing to apply, but `dirty` may have moved
        return;
      }
      target.dispatch({
        changes: apply.changes,
        // An undo restores the cursor set from before the edit — but ONLY in the view that invoked
        // it. Elsewhere it would wrench the user's viewport to an edit they did not make (FR-026f).
        ...(apply.selection
          ? { selection: EditorSelection.fromJSON(apply.selection), scrollIntoView: true }
          : {}),
        annotations: fromAuthority.of(true),
      });
      publishState();
    };

    /** The document was REPLACED (revert, external reload, resync) — adopt it wholesale. */
    const applyReset = (reset: ResetDocumentMsg): void => {
      const target = viewRef.current;
      if (!target) return;
      /*
       * The document is being REPLACED — a different file opened in place, a revert, or a reload
       * after the file changed underneath us (040 AS7). Any count standing from the outgoing text
       * is now a lie about this document, and a lie the user has no reason to distrust, so it is
       * withdrawn here rather than left to expire. The dispatch below is a document change, so the
       * incoming text schedules its own count through the update listener in the ordinary way.
       */
      invalidateDocumentMetrics(metricsDocKey());
      /*
       * …and the replacement may be a DIFFERENT FILE (an in-place open, a Back / Forward step). The view that
       * asked records the path from its own load's answer, but a second window this panel is synced to never
       * sees that answer (044 FR-110): without adopting it here, that window's pill, title and banner went on
       * naming the file that was replaced, over the new document's text. Adopted AFTER the withdrawal above,
       * which names the outgoing document, and before the publish, language and counts below, which name the
       * incoming one — the same hop `movedTo` makes for a moved file.
       */
      if (typeof reset.filePath === 'string' && reset.filePath !== configRef.current.filePath) {
        configRef.current = { ...configRef.current, filePath: reset.filePath };
      }
      replica.reset(reset.version);
      dirtyRef.current = reset.dirty;
      target.dispatch({
        changes: { from: 0, to: target.state.doc.length, insert: reset.text },
        annotations: fromAuthority.of(true),
      });
      // US8 (#154): this reset carries the content of an in-place OPEN (openFile set the flag just
      // before it loaded). Apply the scroll policy — restore the incoming file's saved anchor (pref
      // on), else reset to the top. A revert/reload of the SAME file leaves the flag null → scroll
      // untouched. The flag (not a path match) is the signal: the reset can arrive before openFile
      // has recorded the new path.
      const pendingOpen = pendingOpenScrollRef.current;
      if (pendingOpen) {
        pendingOpenScrollRef.current = null;
        const anchorRaw = pendingOpen.restore ? (docScrollByPath.get(pendingOpen.path) ?? 0) : 0;
        const anchor = Math.min(anchorRaw, target.state.doc.length);
        target.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'start' }) });
      }
      publishState();
      reinferIndent(reset.text); // a different document — read what IT does (FR-018a)
      refreshLanguage(); // …and re-highlight it
      /*
       * …and COUNT it, rather than leaving that to the dispatch above (040 FR-003).
       *
       * The dispatch usually is enough: replacing the text is a document change, so the update
       * listener schedules the incoming count in the ordinary way. It is not enough when the
       * outgoing and incoming text are BOTH EMPTY — `{ from: 0, to: 0, insert: '' }` is an empty
       * `ChangeSet`, `update.docChanged` is false, and the listener never runs. The withdrawal a
       * few lines up would then be permanent: an empty document whose bar goes blank at the first
       * revert and never comes back.
       *
       * Same document key either way, so the two schedules are one scan (the store cancels and
       * re-arms), and the 200 ms window AS7 asks for is unaffected — the figure is still withdrawn
       * for the whole of it.
       */
      republishCounts();
    };

    // Subscribe FIRST — before the async initialisation below — so no canonical change is missed.
    // Anything that arrives before this view knows its starting version is QUEUED, then replayed
    // once it does: applying a change to a document whose version you do not know is how a replica
    // silently drifts.
    const offSync = win()?.editor?.onSync?.((msg) => {
      if (msg.panelId !== panelId || cancelled) return;

      if (!ready && (msg.change || msg.reset)) {
        queued.push({ change: msg.change, reset: msg.reset });
      } else if (msg.change) {
        applyChange(msg.change);
      } else if (msg.reset) {
        applyReset(msg.reset);
      }

      // The backing file was deleted (FR-099): the document stays dirty (there is no version of it
      // on disk) so the buffer survives and a save re-creates the file. The tab-open watcher (not
      // this event) raises the notice.
      if (msg.deleted === true) fileMissingRef.current = true;
      // …and the file CAME BACK (024 US3, #85 — a delete that was undone). The document is backed
      // again, so the missing-file flag goes; whether it is still DIRTY was decided by the authority
      // (it compared the restored file with this buffer) and arrives with the message. Leaving the
      // flag set would keep telling the user their work is at risk over a file that is on disk.
      if (msg.deleted === false) {
        fileMissingRef.current = false;
        publishState();
      }
      // The path became unreadable, or (027 / #161) became readable again — the authority decided
      // it, on the document, so every view of it agrees rather than each guessing from its own
      // last load attempt.
      /*
       * The verification a mounting view asked for has answered (#369). It carries no state — a
       * verdict that DID change something arrives as `unloadable` below, and is equally an answer —
       * so this exists purely to end the wait on the healthy path, which is silent by design.
       */
      if (msg.verified === true) openAnswered();
      if (typeof msg.unloadable === 'boolean') {
        unloadableRef.current = msg.unloadable;
        openPendingRef.current = false; // a verdict is an answer, and this is the one it came for
        // The AUTHORITY decided the condition, and it carries no reason with it — so the reason this
        // view happened to remember from an earlier read is dropped rather than shown beside a
        // verdict it may no longer belong to.
        unloadableDetailRef.current = undefined;
        publishState();
      }
      // throng moved the file, and this document went with it (019, FR-002). Its PATH changed and
      // nothing else did: no dirty flag, no reload, no missing-file notice — it is the same
      // document, holding the same text, and the user asked for the move.
      //
      // This is the VIEW's copy of the path — what the header's file pill renders (AC1) and what a
      // Ctrl+S saves to. The PERSISTED layout is written by `MovedPathSync`, once per window, for
      // every editor panel in it: this listener dies with the mount, and a panel in a background tab
      // is not mounted (FR-008).
      if (typeof msg.movedTo === 'string') {
        configRef.current = { ...configRef.current, filePath: msg.movedTo };
        // The name is what decides the language (FR-002a), and a rename can change the extension:
        // `notes.txt` renamed to `notes.py` must highlight as Python there and then. Exactly what
        // a Save-As to a new path does (`writeTo`), for exactly the same reason.
        refreshLanguage();
        // …and the counts are keyed by that same identity (040 FR-007). A move is not an edit, so
        // no document change will come along to republish them.
        republishCounts();
      }
      // 050 FR-035 — the move took the file out of this panel's project (true), or an undo / redo brought
      // it back (false). A `movedTo` with no flag is an ordinary move and leaves the state as it is.
      if (typeof msg.movedOut === 'boolean') applyMovedOut(msg.movedOut);
      /*
       * 052 R7 — LINKED to another panel's document (a Replace landed its file on this panel's path), or no
       * longer. The reset that rides with it (the owner's state, or this panel's own once it becomes the owner)
       * was applied above. The PERSISTED link is `MovedPathSync`'s, once per window; this is the view's copy.
       *
       * Unlinked with NO reset: the owner moved away from the shared path (an undo, a rename) and this panel's
       * own document is gone from main, so it reads the path it carries as an ordinary editor.
       */
      if (typeof msg.linkedTo === 'string') {
        configRef.current = { ...configRef.current, linkedTo: msg.linkedTo };
      } else if (msg.linkedTo === null) {
        const { linkedTo: _unlinked, ...unlinked } = configRef.current;
        configRef.current = unlinked;
        const own = configRef.current.filePath;
        if (!msg.reset && own) void getEditorActions(panelId)?.openFile(own);
      }
      // 052 FR-012 — a Replace landed on this dirty document's path (true), or its replaced state cleared (false).
      if (typeof msg.replaced === 'boolean') replacedRef.current = msg.replaced;
      // 024 US1 (FR-001a): the document's wrap changed at the authority — possibly because a
      // Panel in ANOTHER window toggled it. One document, one answer, so this view follows.
      if (typeof msg.wordWrap === 'boolean') applyWordWrapFromSync(wrapDocKeyRef.current, msg.wordWrap);
      if (typeof msg.dirty === 'boolean') dirtyRef.current = msg.dirty;
      // The on-disk file changed under our unsaved edits (FR-028) — a soft, one-shot
      // notice (no lock): saving overwrites the external change, revert loads it. The
      // notice NAMES the affected document — its containing tab, its panel, and the
      // file's full path — via the notice model's files list (011, FR-010).
      if (msg.externalChange === true) {
        const m = metaRef.current;
        showEditorNotice(
          buildFileChangedNotice(
            configRef.current.filePath ?? null,
            m.title,
            m.tabTitle,
            win()?.osName ?? 'windows',
          ),
        );
      }
      publishState();
    });

    /**
     * Adopt the authority's state as this replica's starting point, then replay whatever arrived
     * while we were asking for it — dropping anything already included in the version we were given.
     */
    const initialise = (state: { text: string; version: number; dirty: boolean }): void => {
      if (cancelled) return;
      replica.reset(state.version);
      dirtyRef.current = state.dirty;
      // Restore the caret/selection the user left when this document was last shown
      // here (issue #144). Clamped to the incoming text so a document that changed on
      // disk between unmount and remount cannot point the selection out of bounds.
      const savedView = takeEditorViewState(panelId);
      const restoredSelection = savedView
        ? clampSelection(savedView.selection, state.text.length)
        : undefined;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: state.text },
        ...(restoredSelection ? { selection: EditorSelection.fromJSON(restoredSelection) } : {}),
        annotations: fromAuthority.of(true),
      });
      // Restore the scroll position (issue #144) by scrolling the line that was at the
      // top back to the top, THROUGH CodeMirror's own scroll machinery — so its
      // virtualised viewport re-renders to match (a raw `scrollDOM.scrollTop` write moves
      // the scroller but leaves CodeMirror rendering the old lines). Its own transaction,
      // so the effect's document position is clipped against the now-full document rather
      // than the still-empty pre-insert one. Stashed so `refreshLanguage` re-asserts it
      // after its async reconfigure, which would otherwise drop the viewport.
      if (savedView && savedView.scrollAnchor > 0) {
        const anchor = Math.min(savedView.scrollAnchor, state.text.length);
        pendingScrollAnchorRef.current = anchor;
        view.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'start' }) });
      }
      ready = true;
      for (const msg of queued.splice(0)) {
        if (msg.change && msg.change.version > state.version) applyChange(msg.change);
        else if (msg.reset && msg.reset.version > state.version) applyReset(msg.reset);
      }
      publishState();
      reinferIndent(state.text); // what does THIS file already do? (FR-018a)
      refreshLanguage(); // the document's identity is now known — highlight it
      /*
       * …and COUNT it (040 FR-003, US1 AS1, and the spec's "empty document" Edge Case).
       *
       * ══ WHY ADOPTION CANNOT RELY ON THE UPDATE LISTENER ══
       *
       * The dispatch above is the only thing that ever put this document's text into this view, and
       * for a NON-empty document it is a document change, so the listener schedules the count and
       * this line is redundant. For an EMPTY one it is not a change at all: the view was created
       * with `doc: ''` a few statements earlier, so the dispatch is `{ from: 0, to: 0, insert: '' }`
       * — an empty `ChangeSet`, and `update.docChanged` is FALSE.
       *
       * Nothing else covers it. `republishCounts`'s other callers are a Save-As, an in-place open
       * and a move; a plain mount is none of those. So `documentMetrics()` stayed `null` for the
       * life of the panel, and the bar's `if (metrics !== null)` omitted BOTH readouts — for every
       * untitled/scratch panel and every 0-byte file. The spec says an empty document reports 0
       * characters and 0 words; it reported nothing, and a blank readout is indistinguishable from
       * the FR-008b debounce window that is supposed to be transient.
       *
       * Scheduled rather than computed, like every other count: an empty scan is free, but a 5 MB
       * one is not, and FR-008c keeps that off the adoption path as firmly as off the keystroke one.
       */
      republishCounts();
      onReadyRef.current?.(); // content adopted — the panel can drop its loading skeleton
      // When RESTORING a previously-shown editor (a project/tab switch: it was unmounted
      // and now remounts with saved view state), take keyboard focus so the restored
      // caret is live (issue #144) — nothing else routes DOM focus into a programmatic
      // remount. Gated on `savedView` so this fires ONLY on a restore: a FRESH open (e.g.
      // single-clicking a file in the tree) has no saved state, and there the tree must
      // keep focus so F2-rename still reaches it (an editor open does not move DOM focus).
      // Also gated on being the active panel so a background tab / inactive split never
      // steals focus. And gated on the workspace holding the active pane: a switch made from the
      // Projects list keeps focus on the chosen row (046 FR-082), so a restore under it stays quiet.
      if (savedView && isActivePanelRef.current && getActivePane() === 'workspace') view.focus();
    };

    /*
     * THIS PANEL'S OPEN IS NOW IN FLIGHT (#369), and stays so until one of the routes below
     * answers. Set before the first `await` so the flag is already published by the time anything
     * can observe it — a scan that sampled between the mount and the first `publishState` would
     * otherwise see a panel with three false flags and read it as healthy, which is the defect in
     * miniature.
     */
    openPendingRef.current = true;

    void (async () => {
      const bridge = win()?.editor;
      // Already open (moved panel / mirrored view): adopt UI main's document as it stands.
      let existing = await bridge?.getContent?.(panelId);
      /*
       * 052 R7 — a restored LINKED panel: main has no link after a restart, so it is re-made from the config.
       * The owner open → this panel shows the owner's document (main answers `getContent` for it from now on)
       * and takes the adoption route below. The owner not open → the link is dropped, from the view and from
       * the layout, and `filePath` loads as an ordinary editor. Nothing is shown to the user about it.
       */
      const ownerId = configRef.current.linkedTo;
      if (!existing && ownerId && !cancelled) {
        const linked = await bridge?.link?.(panelId, ownerId, metaRef.current.tabId);
        if (linked) existing = await bridge?.getContent?.(panelId);
        if (!existing) {
          const { linkedTo: _dropped, ...ordinary } = configRef.current;
          configRef.current = ordinary;
          ws.updatePanelConfig(panelId, { linkedTo: undefined });
        }
      }
      if (existing && cancelled === false) {
        configRef.current = {
          ...configRef.current,
          filePath: existing.absPath ?? configRef.current.filePath,
          // The FILE's own encoding, from UI main — NOT the app defaults. A mirrored view that
          // assumed LF would show the wrong line ending and offer the wrong one in a Save-As.
          encoding: existing.encoding,
          hasBom: existing.hasBom,
          lineEnding: existing.lineEnding,
        };
        // Publish file-missing so the tab-open watcher (not this mount) raises the
        // notice — a panel drag/move remounts here but must NOT re-warn (FR-105).
        fileMissingRef.current = !!existing.fileMissing;
        // …and the banner, which must survive exactly that remount: this path never attempts a
        // load, so without adopting the authority's answer the editor would quietly go back to
        // presenting remembered text as the file (027 / #161).
        unloadableRef.current = !!existing.unloadable;
        // 050 R18 — the authority's word on it joins the persisted one: a remount reads it.
        if (existing.movedOut === true || movedOutRef.current) applyMovedOut(true);
        replacedRef.current = existing.replaced === true;
        initialise(existing);
        /*
         * 044 T158 — a mount WITHOUT a load (this branch) still has to reach this panel's history: main
         * adopts the persisted one if it holds no record, and a window opened after the history last changed
         * (a sub-workspace, a reload) learns it from the answer. A load carries the history itself instead.
         */
        const persisted = configRef.current.history;
        void win()
          ?.history?.attach({ panelId, panelKind: 'editor', ...(persisted !== undefined ? { persisted } : {}) })
          .then((h) => {
            if (!cancelled) setPanelHistory(panelId, h);
          })
          .catch(() => {
            /* No authority to ask (a torn-down window): the next `changed` broadcast seeds it. */
          });
        // …and CHECK, rather than take the authority's last answer on trust (027 / #161). This
        // branch never touches the disk, so a path that broke while this panel was unmounted — a
        // project switch, a window reload — would otherwise show remembered text as the file with
        // nothing to say it is not. The verdict comes back on the sync channel, whichever way it
        // goes, so nothing here waits for it.
        // A moved-out document holds no path this panel can serve: nothing to verify (050 FR-035).
        if (!movedOutRef.current) bridge?.verifyPath?.(panelId);
        else openAnswered();
        return;
      }
      /*
       * 052 T024 — mounted REPLACED with no live document (a restart): the path is another document's now, so
       * it is neither loaded nor claimed. The unsaved text that survived (the recovery snapshot) is registered
       * as a REPLACED document — detached, so Save As is the way out — exactly as a moved-out one is. With
       * nothing to keep there is nothing to show: the flag is dropped and the path loads as an ordinary editor.
       */
      if (configRef.current.replaced === true && !cancelled) {
        const snapshot = await bridge?.recoverOne?.(panelId);
        if (snapshot && snapshot.text.length > 0 && !cancelled) {
          bridge?.register({ ...buildMeta(), replaced: true, text: '' });
          await bridge?.restoreRecovered(panelId, snapshot.text, snapshot.history);
          const state = await bridge?.getContent?.(panelId);
          if (state) {
            replacedRef.current = state.replaced === true;
            initialise(state);
          }
          publishState();
          openAnswered();
          onReadyRef.current?.();
          return;
        }
        const { replaced: _gone, ...ordinary } = configRef.current;
        configRef.current = ordinary;
        ws.updatePanelConfig(panelId, { replaced: undefined });
      }
      // 050 R19 — mounted MOVED OUT with no live document: the file is another project's now, so it is
      // neither read nor registered (a load would be refused, and a refusal is a "could not be read"
      // notice the user must not see). The notice says it all; the view stays empty and read-only.
      if (movedOutRef.current) {
        // Unsaved text that survived the restart (FR-036 "MUST keep them") is in the recovery snapshot,
        // keyed by panel — reading it touches no file. It is registered with main as a MOVED-OUT document
        // (no claim, no watch, no read), so Save As has a document to write.
        const snapshot = await bridge?.recoverOne?.(panelId);
        if (snapshot && snapshot.text.length > 0 && !cancelled) {
          bridge?.register({ ...buildMeta(), movedOut: true, text: '' });
          await bridge?.restoreRecovered(panelId, snapshot.text, snapshot.history);
          const state = await bridge?.getContent?.(panelId);
          if (state) initialise(state);
        }
        publishState();
        openAnswered();
        onReadyRef.current?.();
        return;
      }
      // Launch-time crash recovery: in-progress content saved to a recovery temp
      // (FR-042) matched by panelId. Restored OVER the saved/disk content as dirty.
      // THIS panel's snapshot only. Pulling the whole recovery directory and filtering here would
      // hand this renderer every other document's undo history — i.e. text the user cut out of files
      // this window is not even showing (FR-027b).
      const recovered = await bridge?.recoverOne?.(panelId);
      const cfg = configRef.current;
      if (cfg.filePath) {
        // 044 US7 — the persisted history rides the restoring load, read with the path it loads (§6).
        const loaded = await bridge?.load({
          ...buildMeta(),
          absPath: cfg.filePath,
          ...(cfg.history !== undefined ? { history: cfg.history } : {}),
        });
        if (loaded && loaded.ok === true) {
          configRef.current = {
            ...cfg,
            encoding: loaded.encoding,
            hasBom: loaded.hasBom,
            lineEnding: loaded.lineEnding,
          };
          // 052 R1 — the path was already held (the owner loaded first, or this panel's own link lost the
          // race): this panel is a view of the holder's document, and the link goes back into the layout.
          if (loaded.linkedTo !== undefined) {
            configRef.current = { ...configRef.current, linkedTo: loaded.linkedTo };
            ws.updatePanelConfig(panelId, { linkedTo: loaded.linkedTo });
          }
          fileMissingRef.current = false;
          unloadableRef.current = false;
          unloadableDetailRef.current = undefined;
          if (recovered && recovered.text !== loaded.text) {
            // Unsaved edits survived a restart — restore them INTO THE AUTHORITY, dirty against the
            // disk file. Restoring them into this view alone would make it disagree with the
            // document it is a replica of, from its very first frame.
            await bridge?.restoreRecovered(panelId, recovered.text, recovered.history);
          }
        } else if (loaded && loaded.ok === false) {
          // The file could not be loaded. Publish it (the tab-open watcher raises the
          // notice — not this mount, so a panel drag/move never re-warns; FR-105).
          fileMissingRef.current = isMissingReason(loaded.reason);
          /**
           * And say so ON SCREEN, for as long as it is true (027 / #161).
           *
           * This is the state the issue is actually about. What the editor shows now is either
           * blank or — if a recovery snapshot survived — the text the file used to hold, over a
           * path throng could not read; and nothing whatsoever distinguishes that from the file
           * itself. A Ctrl+S would write remembered text back over a path we could not even open.
           * The dialog that fires here is a one-shot on tab open; the banner is the standing
           * statement, and it is what auto-recovery and `Reload from disk` clear.
           */
          unloadableRef.current = true;
          // …and WHY, in the same words the notice's own row carries (FR-052/FR-048a). This view is
          // the one that tried to read the path, so it is the only place the reason exists at all.
          unloadableDetailRef.current = missingFileDetail(
            { filePath: cfg.filePath ?? null, reason: loaded.reason },
            win()?.osName ?? 'windows',
          );
          // The file is gone, but its last content may survive in the recovery temp
          // (FR-102): show it (dirty) rather than a blank editor, so a save writes it
          // back to the original location. Blank only when nothing was captured.
          bridge?.register({ ...buildMeta(), text: '', unloadable: true });
          if (recovered) await bridge?.restoreRecovered(panelId, recovered.text, recovered.history);
        }
      } else if (recovered && recovered.text.length > 0) {
        // A brand-new unsaved document restored from its recovery temp (dirty).
        bridge?.register({ ...buildMeta(), text: '' });
        await bridge?.restoreRecovered(panelId, recovered.text, recovered.history);
      } else {
        // Brand-new empty document — register it (unpathed) so it appears in the
        // one-buffer registry only once it gains a path.
        bridge?.register({ ...buildMeta(), text: '' });
      }
      /*
       * THE OPEN HAS DECIDED (#369) — on every route that reaches here.
       *
       * The load answered ok, the load answered no, or there was no path to open at all. Each of
       * those has already written whatever it decided into the two flags above, so this is the
       * point at which "nobody has looked yet" stops being true.
       *
       * The one route that does NOT reach here is the adoption branch, which returned above after
       * asking for a verification. That branch stays pending on purpose: it has not touched the
       * disk, so nothing it published is an answer yet — its answer arrives on the sync channel.
       */
      if (!cancelled) openAnswered();
      // Whatever route we took, the authority now holds this document. Start from ITS state —
      // never from a copy assembled here, which is how a replica becomes a second original.
      const state = await bridge?.getContent?.(panelId);
      if (state) initialise(state);
    })();

    return () => {
      cancelled = true;
      // Remember where the caret/viewport were before the view is torn down, so the
      // next mount of this document (tab/panel/project switch) can restore them (#144).
      view.scrollDOM.removeEventListener('scroll', onScroll);
      saveEditorViewState(panelId, {
        selection: view.state.selection.toJSON(),
        scrollAnchor: lastScrollAnchor,
      });
      // 049: the view is gone, so its live capture goes with it (the saved entry above answers from here on).
      unregisterStateCapture();
      offSync?.();
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      unregisterPanelFocus(panelId);
      unregisterPanelSearch(panelId);
      // NB: the panel's LANGUAGE is not removed here (#295). A language the user picked is their
      // decision, not a property of this view — and in a rootless panel it is not persisted
      // either (`language-override.ts` skips the write with no projectId/relPath to key a row
      // against), so dropping it on unmount destroyed the only copy and the document silently
      // reverted to whatever its filename implied. Removed in `disposeEditor` instead, with the
      // rest of the explicit teardown.
      unregisterEditorView(panelId);
      // No mounted view of this editor in this window any more, so nothing for a preview to follow and
      // nothing for one to drive (FR-113, FR-121a). The relay cancels its frames, forgets the line and
      // unregisters its scroller.
      relay.dispose();
      scrollRelay = null;
      if (scrollRelayRef.current === relay) scrollRelayRef.current = null;
      placementPendingRef.current = false;
      replicaRef.current = null;
      view.destroy();
      viewRef.current = null;
      // NB: the document lives in UI main keyed by panelId and survives a remount
      // (move between tabs/windows). Explicit teardown happens on Panel destroy.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, panelId]);
}

/** Remove the renderer-side editor state (called on explicit Panel destroy). */
export function disposeEditor(panelId: string): void {
  // Read the document key BEFORE the state goes: it is derived from this panel's `filePath`, and
  // `removeEditorState` is what takes that away.
  const docKey = wordWrapDocKey(getEditorState(panelId)?.filePath ?? null, panelId);
  removeEditorState(panelId);
  unregisterEditorActions(panelId);
  // The panel is gone, so the language chosen for it goes too — otherwise a recycled panel id
  // would inherit a dead document's language (#295: moved here from the unmount cleanup).
  removePanelLanguage(panelId);
  // The document is gone — don't leak its saved caret (issue 144).
  clearEditorViewState(panelId);
  /*
   * …and the find session that was open on it (043 FR-006).
   *
   * NOT in the unmount cleanup beside `unregisterPanelSearch`, which is the obvious place and the
   * wrong one: a panel's view is rebuilt when it is hidden by a tab switch, dragged to another tab
   * or split, and the session outlives the view (FR-025b; `attachPanelSearch` re-runs it on the new
   * one — and a copy sent to another window takes it along as a hand-off snapshot, 049 R3). Only an
   * explicit destroy discards it, and this function IS the explicit destroy.
   */
  destroyPanelSearch(panelId);
  // …nor the status bar's READOUT of that caret (040 FR-006, data-model.md §3.1). Keyed by panel,
  // so a recycled panel id would otherwise inherit a dead document's line and column.
  forgetPanelCaret(panelId);
  // …nor the link readout (045 FR-167), for the same reason: a recycled panel id must not inherit a
  // stale "hovered" target from whatever this id last pointed at.
  clearEditorHoveredLink(panelId);
  // …nor a link hint this panel raised (045 FR-165d, review round four I4): it describes a link in a
  // panel that no longer exists. Another panel's hint is left alone.
  hideLinkHintFor(panelId);
  /*
   * …and the document's COUNTS, once no panel is left showing it (040 FR-007, data-model.md §3.2).
   *
   * Two things this stops, and neither is visible from the strip. `settled` grew one entry per
   * document ever opened, for the life of the session — and an untitled buffer keys on
   * `panel:<id>`, so every scratch panel leaked one with no path that could ever be revisited. And
   * a scan armed inside the 200 ms debounce window still RAN after the view was destroyed: the
   * scheduled thunk is `() => update.state.doc.toString()`, so it holds the whole `ViewUpdate` —
   * both `EditorState`s and the rope — alive past teardown, then materialises the entire document
   * as a string to count a file nobody has open. `document-metrics-store.ts` describes exactly that
   * hazard beside `cancel()`; until now its cancel path had no caller.
   *
   * GUARDED, because the key is per DOCUMENT and not per panel. Two panels on one file share this
   * entry, so disposing either of them unconditionally would blank the other one's counts with
   * nothing to restore them until the next keystroke — Principle XI's "shared as a single value"
   * turned into a defect. `removeEditorState` has already run, so this panel is not counted.
   */
  if (!allEditorStates().some((s) => wordWrapDocKey(s.filePath, s.panelId) === docKey)) {
    forgetDocumentMetrics(docKey);
  }
  win()?.editor?.destroy(panelId);
}

function reportSaveError(reason: string, ownerKind: 'project' | 'subworkspace'): void {
  // A visible message box, not a silent no-op — the buffer stays unsaved (FR-078).
  const message =
    reason === 'out-of-tree'
      ? ownerKind === 'subworkspace'
        ? 'This editor belongs to a sub-workspace, so it can only be saved OUTSIDE every open project. Choose a location outside your projects.'
        : 'This editor belongs to a project, so it can only be saved INSIDE that project’s folder. Choose a location within the project.'
      : reason === 'no-location'
        ? 'Choose where to save first.'
        : 'Save failed — the file may be missing, locked, or read-only.';
  showEditorNotice({ title: 'Cannot save', message });
}
