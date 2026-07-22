import { useCallback, useEffect, useRef } from 'react';
import { Annotation, EditorSelection, EditorState, Prec, type Transaction } from '@codemirror/state';
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
import {
  columnSelectHeld,
  DEFAULT_BINDING_PLATFORM,
  effectiveActivePanelId,
  effectiveIndent,
  inferIndent,
  PLAIN_TEXT_ID,
  shippedBindingsFor,
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
import { useAppSettings } from '../config/config-store.js';
import { setEditorState, removeEditorState } from './editor-state.js';
import { registerEditorActions, unregisterEditorActions } from './editor-actions.js';
import { registerPanelFocus, unregisterPanelFocus } from '../workspace/panel-focus.js';
import { registerPanelSearch, unregisterPanelSearch } from '../search/search-controller.js';
import { updateCount } from '../search/search-store.js';
import {
  createEditorSearchController,
  searchHighlightExtension,
} from '../search/editor-search.js';
import { showEditorNotice } from './editor-notice-store.js';
import { isMissingReason, showMissingFilesNotice } from './editor-missing-notice.js';
import { buildFileChangedNotice } from './file-changed-notice.js';
import { throngHighlighting } from './highlight-style.js';
import {
  claimLanguage,
  functionHighlightCompartment,
  languageCompartment,
  removePanelLanguage,
} from './editor-language.js';
import { loadDocumentOverride, toRelPath } from './language-override.js';
import { registerEditorView, unregisterEditorView } from './editor-views.js';
import {
  clampSelection,
  clearEditorViewState,
  saveEditorViewState,
  takeEditorViewState,
} from './editor-view-state.js';
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
  indentCompartment,
  indentExtensions,
  indentLinesCommand,
  outdentLinesCommand,
  pasteCommand,
} from './commands.js';
import { getPanelLanguage } from './editor-language.js';
import { editorContentMenu, placeCaretForContextMenu } from './content-menu.js';
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
}): Partial<Record<ActionId, ReturnType<typeof cutLineCommand>>> {
  return {
    'editor.cutLine': cutLineCommand(deps.lineEnding),
    'editor.indentLines': indentLinesCommand(deps.indent),
    'editor.outdentLines': outdentLinesCommand(deps.indent),
    'editor.columnSelectUp': columnSelectUp,
    'editor.columnSelectDown': columnSelectDown,
    'editor.columnSelectLeft': columnSelectLeft,
    'editor.columnSelectRight': columnSelectRight,
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
  // The live bindings. `editor.cutLine` is rebindable (FR-017), and the keymap below is built from
  // them — minus any chord 012's window-level commands own (FR-024b).
  const keybindings = useKeybindings();

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
  const keybindingsRef = useRef(keybindings);
  keybindingsRef.current = keybindings;
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
  // The app-wide context-menu host (FR-036/037): exactly one menu is open anywhere at a time, so
  // the editor asks for one rather than rendering its own.
  const { openMenu } = useContextMenu();
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;
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
      ownerProjectId: metaRef.current.ownerProjectId,
    });
  };

  // Show the "cannot open" notice for a deliberate open — missing-file warnings are
  // gated by editor.warnOnMissingFile; everything else always shows (FR-105).
  const maybeWarn = (
    entries: { filePath: string | null; panelName: string; reason: string }[],
  ): void => {
    const shown = entries.filter(
      (e) => !isMissingReason(e.reason) || metaRef.current.settings.warnOnMissingFile,
    );
    showMissingFilesNotice(shown, win()?.osName ?? 'windows');
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
      if (result && 'reason' in result) {
        reportSaveError(result.reason, metaRef.current.rootless ? 'subworkspace' : 'project');
      }
      return false;
    }
    configRef.current = {
      ...cfg,
      filePath: result.absPath,
      encoding: result.encoding,
      lineEnding: result.lineEnding,
      hasBom: cfg.hasBom ?? false,
    };
    ws.updatePanelConfig(panelId, configRef.current); // persist path into the layout blob
    fileMissingRef.current = false; // a successful save (re)created the file on disk
    publishState();
    // Save-As gave the document a new name, and the name is what decides the language (FR-002a):
    // saving `notes` as `notes.py` must highlight it as Python, there and then.
    if (isNewPath) refreshLanguage();
    return true;
  };

  // Prompt for a location (file-name pre-filled) then save there (new doc / Save As).
  const chooseThenSave = async (): Promise<boolean> => {
    const cfg = configRef.current;
    const chosen = await win()?.editor?.chooseSavePath?.({
      defaultDir: cfg.filePath ? dirname(cfg.filePath) : (metaRef.current.projectRoot ?? undefined),
      // FR-083: default the file-name field to the current name or the Panel's name
      // (read through the ref so a renamed Panel is reflected, not the mount-time name).
      defaultName: cfg.filePath ? basename(cfg.filePath) : metaRef.current.title,
    });
    if (!chosen) return false; // cancelled
    return writeTo(chosen, true);
  };

  const save = async (): Promise<boolean> => {
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
  const openFile = async (absPath: string): Promise<void> => {
    // US8 (#154): opening a DIFFERENT file IN PLACE. Save the outgoing document's scroll anchor
    // (only when the pref is on) and flag the incoming document RESET so it applies the scroll
    // policy — restore the incoming file's saved anchor (on), or reset to the top (off).
    const outgoing = configRef.current.filePath;
    if (outgoing && outgoing !== absPath) {
      const restore = metaRef.current.settings.saveDocumentScroll;
      if (restore) docScrollByPath.set(outgoing, currentScrollAnchorRef.current);
      pendingOpenScrollRef.current = { path: absPath, restore };
    }
    const loaded = await win()?.editor?.load({ ...buildMeta(), absPath });
    if (loaded && loaded.ok === true) {
      configRef.current = {
        filePath: absPath,
        encoding: loaded.encoding,
        hasBom: loaded.hasBom,
        lineEnding: loaded.lineEnding,
      };
      ws.updatePanelConfig(panelId, configRef.current);
      fileMissingRef.current = false;
      publishState();
      // The document's IDENTITY changed, and its name is what decides its language (FR-002a).
      //
      // This must happen HERE, and not only when the replacement content arrives: the authority
      // broadcasts that replacement as soon as it loads the file, so it can reach this view BEFORE
      // the line above records the new path — and language detection reading the OLD path resolves
      // the OLD language. The file would open with its content and no highlighting.
      refreshLanguage();
    } else if (loaded && loaded.ok === false) {
      // A deliberate open of a bad/missing file: warn immediately (single file).
      fileMissingRef.current = isMissingReason(loaded.reason);
      maybeWarn([{ filePath: absPath, panelName: metaRef.current.title, reason: loaded.reason }]);
      publishState();
    }
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
      isDirty: () => dirtyRef.current,
      openFile,
      revert,
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
          commandsFor({ lineEnding: currentLineEnding, indent: currentIndent }),
        ),
      ),
    });
  }, [keybindings, currentLineEnding, currentIndent]);

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

    const updateListener = EditorView.updateListener.of((update) => {
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
          lineNumbers(),
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
              commandsFor({ lineEnding: currentLineEnding, indent: currentIndent }),
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
            contextmenu: (event, target) => {
              // Right-clicking INSIDE a selection preserves it — the user is about to act on the
              // thing they right-clicked. Outside it, the caret moves to the click (FR-012a).
              placeCaretForContextMenu(target, event);
              openMenuRef.current(
                event.clientX,
                event.clientY,
                editorContentMenu({
                  view: target,
                  panelId,
                  viewId,
                  lineEnding: () =>
                    configRef.current.lineEnding ?? metaRef.current.settings.defaultLineEnding,
                }),
              );
              event.preventDefault();
              return true;
            },
          }),
          keymap.of(defaultKeymap),
          EditorView.lineWrapping,
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
          // In-panel find/replace (013): paints the match decorations. The bar drives
          // it through the controller registered below; CodeMirror's own search panel
          // is deliberately not used (its controls could not be theme-token driven).
          searchHighlightExtension,
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
    // The status strip and the language picker live OUTSIDE this view and must be able to
    // reconfigure it when the user picks a language (016).
    registerEditorView(panelId, view);
    // Register this editor's focus so keyboard move-focus (012) can route DOM focus
    // (and the caret) into it when it becomes the active panel.
    registerPanelFocus(panelId, () => viewRef.current?.focus());
    // Register this editor's search engine (013) so the shared find bar — and the
    // rebindable find/replace commands — can drive whichever panel is active.
    registerPanelSearch(
      panelId,
      createEditorSearchController(
        view,
        () => view.state.readOnly,
        // Editing while the bar is open re-runs the query, so the count the user sees keeps
        // pace with the document they are changing.
        (count) => updateCount(panelId, count),
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
      }
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
      onReadyRef.current?.(); // content adopted — the panel can drop its loading skeleton
      // When RESTORING a previously-shown editor (a project/tab switch: it was unmounted
      // and now remounts with saved view state), take keyboard focus so the restored
      // caret is live (issue #144) — nothing else routes DOM focus into a programmatic
      // remount. Gated on `savedView` so this fires ONLY on a restore: a FRESH open (e.g.
      // single-clicking a file in the tree) has no saved state, and there the tree must
      // keep focus so F2-rename still reaches it (an editor open does not move DOM focus).
      // Also gated on being the active panel so a background tab / inactive split never
      // steals focus.
      if (savedView && isActivePanelRef.current) view.focus();
    };

    void (async () => {
      const bridge = win()?.editor;
      // Already open (moved panel / mirrored view): adopt UI main's document as it stands.
      const existing = await bridge?.getContent?.(panelId);
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
        initialise(existing);
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
        const loaded = await bridge?.load({ ...buildMeta(), absPath: cfg.filePath });
        if (loaded && loaded.ok === true) {
          configRef.current = {
            ...cfg,
            encoding: loaded.encoding,
            hasBom: loaded.hasBom,
            lineEnding: loaded.lineEnding,
          };
          fileMissingRef.current = false;
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
          // The file is gone, but its last content may survive in the recovery temp
          // (FR-102): show it (dirty) rather than a blank editor, so a save writes it
          // back to the original location. Blank only when nothing was captured.
          bridge?.register({ ...buildMeta(), text: '' });
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
      offSync?.();
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      unregisterPanelFocus(panelId);
      unregisterPanelSearch(panelId);
      removePanelLanguage(panelId);
      unregisterEditorView(panelId);
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
  removeEditorState(panelId);
  unregisterEditorActions(panelId);
  // The document is gone — don't leak its saved caret (issue 144).
  clearEditorViewState(panelId);
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
