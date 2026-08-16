/**
 * use-explorer-data (004) — owns the file tree's loaded directory data and
 * drives react-arborist, which is the single source of truth for OPEN state.
 * The root's children load eagerly; subfolders load lazily on first open.
 * "Expand" opens the next collapsed level relative to the selection
 * (nextExpandTargets); "Collapse all" resets to the root. Expanded folders + the
 * selected item are read back from react-arborist and persisted PER PROJECT in
 * localStorage, then restored on reopen via `initialOpenState`. Excludes +
 * folders-first sort come from the pure core.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { NodeApi, TreeApi } from 'react-arborist';

/**
 * react-arborist 3.x no longer exports `OpenMap` from its public entry (it moved to an
 * internal state slice). Mirror the shape it still uses for `<Tree initialOpenState>` —
 * a map of node id → open — so our value stays structurally assignable to that prop.
 */
type OpenMap = { [id: string]: boolean };
import {
  deletePaths,
  descendantOpenFolders,
  emptyStack,
  immediateChildFolders,
  isExcluded,
  nextExpandTargets,
  parentRel,
  plannedMoves,
  recordFileOp,
  redoFileOp as popRedo,
  resolveTarget,
  toNodes,
  undoFileOp as popUndo,
  validateFileOp,
  type DirEntry,
  type ExpandNode,
  type FailureCause,
  type FileOpUndoEntry,
  type FileOpUndoStack,
  type NoticeSubject,
  type TargetNode,
} from '@throng/core';
import type { FilesOkOrError } from '../global.js';
import { useAppSettings } from '../config/config-store.js';
import { useConfirm } from '../confirm-dialog.js';
import { useServices } from '../composition-root.js';

/** react-arborist rejects empty-string ids, so the root (relPath "") uses this
 *  non-empty sentinel as its node id; logic keys off `relPath`, not `id`. */
export const ROOT_ID = ' root';

export interface TreeNodeData {
  id: string; // react-arborist node id: relPath, or ROOT_ID for the root
  name: string;
  kind: 'file' | 'folder';
  relPath: string;
  isSymlink: boolean;
  children?: TreeNodeData[];
}

export type ClipboardState = { mode: 'cut' | 'copy'; relPaths: string[] } | null;

export interface ExplorerApi {
  data: TreeNodeData[];
  ready: boolean;
  error: string | null;
  /**
   * What the user was trying to do when {@link error} happened, phrased to complete "…you tried to".
   *
   * The failures here arrive as raw filesystem strings — "EPERM: operation not permitted, unlink" —
   * which say what went wrong and nothing whatever about what was being attempted. The operation is
   * known at the call site and nowhere else, so it is recorded WITH the error rather than guessed at
   * by whoever displays it.
   */
  errorAction: string | null;
  /**
   * 029 FR-018 — the classification main already made for {@link error}, when it made one.
   *
   * The message is spoken by the time it gets here, so the errno is no longer recoverable from it.
   * Carrying the cause is what lets the notice keep the raw text reachable for a bug report and key
   * its suppression on the cause rather than on the wording.
   */
  errorCause: FailureCause | null;
  /**
   * WHAT THE FAILED OPERATION WAS ABOUT (030 FR-019/FR-025, T033a).
   *
   * The file or folder the user acted on, structured rather than spelled — this is the surface #195
   * was filed against, where "An error occurred when you tried to rename this item" is all a user
   * with four projects open was ever told. Recorded WITH the error for the same reason the action
   * is: only the call site knows, and by the time the message exists the answer is gone from it.
   *
   * `{ kind: 'none' }` where the operation genuinely spans a SET — a multi-item move, paste, delete
   * or an undo of one — because a subject names one thing and picking one of several would name an
   * item that may not be the one that failed.
   */
  errorSubject: NoticeSubject | null;
  /** Dismiss the current error banner immediately (011, US1, FR-002). */
  clearError: () => void;
  initialOpenState: OpenMap;
  onToggle: (id: string) => void;
  onSelect: (nodes: NodeApi<TreeNodeData>[]) => void;
  onRename: (args: { id: string; name: string }) => void;
  expandStep: () => void;
  collapseAll: () => void;
  /**
   * 033 US4 (FR-041/FR-042/FR-043) — open `relPath`'s IMMEDIATE child folders, one level, each with
   * its children loaded. A closed anchor opens itself first.
   */
  expandChildren: (relPath: string) => void;
  /**
   * 033 US4 (FR-039/FR-040) — close every expanded descendant of `relPath` at every depth, leaving
   * the anchor itself open. A folder with nothing expanded beneath it is a silent no-op.
   */
  collapseChildren: (relPath: string) => void;
  /**
   * US6 (#137): reveal a file in this tree by its root-relative path (expand ancestors + select).
   *
   * `focus` decides whether the tree also takes the keyboard. It defaults to true because the only
   * original caller is the manual "Reveal File" action — an explicit "take me there" — but the
   * automatic follow-the-editor reveal (#188) passes false, so it cannot pull the caret out of the
   * text the user is typing in (the #144 class of bug).
   */
  revealInTree: (relPath: string, opts?: { focus?: boolean }) => Promise<void>;
  // Selection + operations (US3).
  selectedRelPaths: string[];
  primarySelected: TargetNode | null;
  clipboard: ClipboardState;
  beginRename: (relPath?: string) => void;
  cut: (relPaths: string[]) => void;
  copy: (relPaths: string[]) => void;
  clearClipboard: () => void;
  paste: (target: TargetNode | null) => void;
  remove: (relPaths: string[]) => void;
  createFolder: (target: TargetNode | null) => void;
  createFile: (target: TargetNode | null) => void;
  reveal: (relPath: string) => void;
  drop: (dragRelPaths: string[], destRelDir: string, asCopy: boolean) => void;
  // 024 US3 (#85): reverse (or re-apply) the last file OPERATION — move, rename or delete.
  undoFileOp: () => void;
  redoFileOp: () => void;
  /** Whether there is anything to undo / redo, so a menu can grey its item honestly. */
  canUndoFileOp: boolean;
  canRedoFileOp: boolean;
}

const storageKey = (projectId: string): string => `throng.explorer.tree.${projectId}`;

interface Persisted {
  expanded: string[];
  selectedId: string | null;
}

function loadPersisted(projectId: string): Persisted {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (raw) {
      const o = JSON.parse(raw) as Partial<Persisted>;
      return {
        expanded: Array.isArray(o.expanded) ? o.expanded.filter((s) => typeof s === 'string') : [],
        selectedId: typeof o.selectedId === 'string' ? o.selectedId : null,
      };
    }
  } catch {
    /* corrupt/unavailable storage → empty */
  }
  return { expanded: [], selectedId: null };
}

/** True when two directory listings are identical (name/kind/symlink, in order). */
function sameEntries(a: TreeNodeData[] | undefined, b: TreeNodeData[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].name !== b[i].name || a[i].kind !== b[i].kind || a[i].isSymlink !== b[i].isSymlink) {
      return false;
    }
  }
  return true;
}

/**
 * The rendered tree as the pure core's `ExpandNode` view (033 US4, contract C5).
 *
 * react-arborist is the single source of truth for open-state, so the view is read from IT and not
 * from anything we keep alongside — which is what stops the two disagreeing (#120). A closed folder
 * carries no `children`, matching the convention `expand.ts` documents: a closed folder's listing is
 * not what is on screen, so it is not part of this view of it.
 *
 * `expandStep` builds the same shape inline. It is deliberately left alone rather than folded into
 * this helper: FR-046 / contract D9 require the toolbar's Expand and Collapse all to be UNCHANGED,
 * in code as well as in behaviour, and US4's independent-test promise rests on that.
 */
function toExpandNode(node: NodeApi<TreeNodeData>): ExpandNode {
  const isRoot = node.data.relPath === '';
  return {
    relPath: node.data.relPath,
    kind: node.data.kind,
    open: isRoot ? true : node.isOpen,
    children: isRoot || node.isOpen ? (node.children ?? []).map(toExpandNode) : undefined,
  };
}

function savePersisted(projectId: string, expanded: string[], selectedId: string | null): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify({ expanded, selectedId }));
  } catch {
    /* storage unavailable → skip */
  }
}

export function useExplorerData(
  rootFolder: string | null,
  projectId: string,
  treeRef: RefObject<TreeApi<TreeNodeData> | null>,
  rootName: string,
  hiddenPaths: string[],
): ExplorerApi {
  const settings = useAppSettings();
  const confirm = useConfirm();
  const { documents, fileOpUndo } = useServices();
  const globs = settings.explorer.excludeGlobs;
  const globsKey = globs.join(' ');

  /**
   * Carry a document's language override with the file across a move (016, FR-028e).
   *
   * `moved: false` simply means the file had no override, which is the common case — it is not a
   * failure, and neither is a store that cannot be reached. A file operation must never fail
   * because a preference could not follow it.
   */
  const carryOverride = useCallback(
    (fromRel: string, destDir: string) => {
      const leaf = fromRel.split(/[\\/]/).pop() ?? fromRel;
      const to = destDir ? `${destDir}/${leaf}` : leaf;
      void documents.movePath(projectId, fromRel, to).catch(() => {
        /* see the doc comment: nothing here is worth failing a move over */
      });
    },
    [documents, projectId],
  );

  /*
   * FILE-OPERATION UNDO (024 US3, #85).
   *
   * The stack is per PROJECT and persisted through the daemon, so undo survives a restart: a user
   * who deletes the wrong folder and closes throng before noticing can still put it back. The pure
   * engine in core decides WHAT to reverse; this decides how to apply it, because only the renderer
   * knows the project root that turns an entry's absolute paths back into the confined,
   * root-relative paths the `files.*` bridge accepts.
   *
   * Entries record ABSOLUTE paths deliberately. A relative path is meaningless the moment the
   * project root changes, and a stack that outlives a session must still name the same files.
   */
  const [stack, setStack] = useState<FileOpUndoStack>(emptyStack());
  const stackRef = useRef(stack);
  stackRef.current = stack;

  /** Absolute path for a root-relative one, in the root's own separator style. */
  const toAbs = useCallback(
    (rel: string): string => {
      const root = (rootFolder ?? '').replace(/[\\/]+$/, '');
      const sep = root.includes('\\') ? '\\' : '/';
      return rel ? `${root}${sep}${rel.split('/').join(sep)}` : root;
    },
    [rootFolder],
  );

  /** Root-relative path for an absolute one, or null when it lies outside this project. */
  const toRel = useCallback(
    (abs: string): string | null => {
      const norm = (v: string): string => v.replace(/\\/g, '/').replace(/\/+$/, '');
      const root = norm(rootFolder ?? '');
      const path = norm(abs);
      if (!root || path.toLowerCase() === root.toLowerCase()) return null;
      if (!path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
      return path.slice(root.length + 1);
    },
    [rootFolder],
  );

  /** Push an entry and persist the new stack. Recording never fails an operation that succeeded. */
  const pushUndo = useCallback(
    (entry: FileOpUndoEntry) => {
      const next = recordFileOp(stackRef.current, entry);
      stackRef.current = next;
      setStack(next);
      void fileOpUndo.save(projectId, next);
    },
    [fileOpUndo, projectId],
  );

  // Load this project's history when it opens. A project with none simply starts empty.
  useEffect(() => {
    let cancelled = false;
    void fileOpUndo.load(projectId).then((loaded) => {
      if (cancelled) return;
      stackRef.current = loaded;
      setStack(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [fileOpUndo, projectId]);

  const [childrenMap, setChildrenMap] = useState<Map<string, TreeNodeData[]>>(new Map());
  const [initialOpenState, setInitialOpenState] = useState<OpenMap>({ [ROOT_ID]: true });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelPaths, setSelectedRelPaths] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardState>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<string | null>(null);
  const [errorCause, setErrorCause] = useState<FailureCause | null>(null);
  const [errorSubject, setErrorSubject] = useState<NoticeSubject | null>(null);
  const deleteMode = settings.explorer.deleteMode;

  /** Record a failure with what was attempted, what it was about, and how main classified it. */
  const fail = useCallback(
    (message: string | null, action?: string, subject?: NoticeSubject, cause?: FailureCause) => {
      setError(message);
      setErrorAction(message === null ? null : (action ?? null));
      setErrorSubject(message === null ? null : (subject ?? null));
      setErrorCause(message === null ? null : (cause ?? null));
    },
    [],
  );
  const failRef = useRef(fail);
  failRef.current = fail;
  /**
   * `nodeSubject`, reachable from the async listing path (030 FR-025).
   *
   * Assigned below, once `kindOf` exists. `fetchChildren` is declared long before it and is only
   * ever CALLED from an effect or a handler, so the ref is always populated by then — and reading
   * it through a ref keeps `fetchChildren`'s identity independent of the loaded tree, which is what
   * stops a re-list from re-running every effect that depends on it.
   */
  const nodeSubjectRef = useRef<(relPath: string) => NoticeSubject>(() => ({ kind: 'none' }));

  // Read directory contents, filter excludes, sort folders-first. No state writes.
  const fetchChildren = useCallback(
    /**
     * `silent` marks a SPECULATIVE read — one the user did not ask for (026 / #197, FR-021).
     *
     * Restoring a project re-reads every folder localStorage remembers as open. Those paths are a
     * guess about a filesystem that may have moved on: a folder renamed or deleted outside throng
     * while the project was closed is *expected* to be gone, and telling the user their remembered
     * expansion could not be listed reports a problem they neither caused nor have. Worse, it names
     * the OLD path, so it reads as though throng has lost track of a folder they renamed on purpose.
     *
     * A read the user DID ask for — clicking a folder open — still reports, because then the
     * failure is about something they are trying to do right now (FR-022).
     */
    async (relDir: string, silent = false): Promise<TreeNodeData[] | null> => {
      const res = await window.throng?.files?.list?.(relDir);
      if (!res || 'error' in res) {
        if (res && 'error' in res) {
          if (silent) {
            // Discarded, not reported — but never invisible. An intermittent restore failure that
            // leaves no trace is how #186 survived four wrong diagnoses (FR-021, SC-013).
            console.warn(
              `[explorer] discarding unresolvable persisted path "${relDir}" for project ${projectId}: ${res.error}`,
            );
          } else {
            // FR-025 — "this folder" named nothing; the folder is now the subject, and the action
            // ends where the subject begins: "Couldn't list the contents of Src".
            failRef.current(res.error, 'list the contents of', nodeSubjectRef.current(relDir), res.cause);
          }
        }
        return null;
      }
      /*
       * A SUCCESSFUL READ CLEARS NOTHING.
       *
       * This used to clear the error, and directory reads happen constantly — the file watcher
       * reloads every loaded folder on any change, including the change the user's own failed
       * operation did not make. So a real failure ("that name already exists") was wiped off the
       * screen a few hundred milliseconds later by an unrelated background listing, and an error
       * that silently vanishes is exactly what the notification model exists to prevent. Listing a
       * folder is not the user succeeding at the thing they were refused; only the next OPERATION
       * (see `report`) is, and only a dismissal is their acknowledgement.
       */
      return toNodes(res.entries as DirEntry[], relDir)
        .filter((n) => !isExcluded(n.relPath, globs))
        .map((n) => ({
          id: n.id,
          name: n.name,
          kind: n.kind,
          relPath: n.relPath,
          isSymlink: n.isSymlink,
        }));
    },
    [globs, projectId],
  );
  const fetchRef = useRef(fetchChildren);
  fetchRef.current = fetchChildren;
  // Latest childrenMap for the live-sync reloader (avoids stale closures).
  const childrenMapRef = useRef(childrenMap);
  childrenMapRef.current = childrenMap;
  // True once the persisted selection has been restored (or there was none). Used
  // to ignore react-arborist's spurious empty onSelect on mount, which would
  // otherwise clobber the restored selection.
  const selectionDone = useRef(false);
  // Open-state to (re)apply once the target nodes exist in the tree (#120): a MOVE
  // migrates a folder's expansion to its new path by prefix, so the moved folder
  // stays open where it lands instead of being stranded at the old, path-keyed id.
  const pendingOpen = useRef<Set<string>>(new Set());
  // A relPath to select once it appears (#122): after a rename the node's id
  // changes, so the old selection no longer matches — re-select the NEW path.
  const pendingSelect = useRef<string | null>(null);

  // Restore on project (or exclude-list) change: load the root + every
  // persisted-open folder, then seed react-arborist's initial open-state.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    window.throng?.files?.setRoot?.(rootFolder ?? null);
    if (!rootFolder) {
      setChildrenMap(new Map());
      setInitialOpenState({ [ROOT_ID]: true });
      setSelectedId(null);
      setReady(true);
      return;
    }
    // Prune the document rows whose file has vanished (016, FR-028e) — the backstop for files
    // deleted OUTSIDE throng. Fire-and-forget, deliberately: FR-028e forbids this from sitting on
    // the path that opens a file, so it must not be awaited before the tree loads. The daemon
    // checks each ROW against the project folder, so this costs one round-trip and nothing else.
    void documents.pruneMissing(projectId).catch(() => {
      /* a store that cannot be pruned is not a reason to fail opening a project */
    });

    void (async () => {
      const persisted = loadPersisted(projectId);
      const map = new Map<string, TreeNodeData[]>();
      const rootKids = await fetchRef.current('');
      if (cancelled) return;
      map.set('', rootKids ?? []);
      await Promise.all(
        // `silent` — these paths are a GUESS about a filesystem that may have moved on while the
        // project was closed. An unresolvable one is discarded and logged, never raised at the user
        // (026 / #197, FR-021).
        persisted.expanded.map(async (rel) => {
          const kids = await fetchRef.current(rel, true);
          if (kids) map.set(rel, kids);
        }),
      );
      if (cancelled) return;
      const open: OpenMap = { [ROOT_ID]: true };
      for (const rel of persisted.expanded) if (map.has(rel)) open[rel] = true;
      setChildrenMap(map);
      setInitialOpenState(open);
      setSelectedId(persisted.selectedId);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [rootFolder, projectId, globsKey, documents]);

  // Project-scoped hidden paths (004), applied on top of the global excludeGlobs.
  const hiddenSet = useMemo(() => new Set(hiddenPaths), [hiddenPaths]);

  // Derive react-arborist data (single root node + nested loaded children),
  // dropping any entry the project has hidden (reactive — no re-fetch needed).
  const data = useMemo<TreeNodeData[]>(() => {
    const build = (dir: string): TreeNodeData[] =>
      (childrenMap.get(dir) ?? [])
        .filter((k) => !hiddenSet.has(k.relPath))
        .map((k) => (k.kind === 'folder' ? { ...k, children: build(k.relPath) } : { ...k }));
    return [
      { id: ROOT_ID, name: rootName, kind: 'folder', relPath: '', isSymlink: false, children: build('') },
    ];
  }, [childrenMap, rootName, hiddenSet]);

  // Snapshot the currently-open folder relPaths from react-arborist (the source
  // of truth for open-state), excluding the always-open root.
  const snapshotOpen = useCallback((): string[] => {
    const api = treeRef.current;
    if (!api) return [];
    const open: string[] = [];
    const walk = (node: NodeApi<TreeNodeData>): void => {
      for (const child of node.children ?? []) {
        if (child.data.kind === 'folder' && child.isOpen && child.data.relPath !== '') {
          open.push(child.data.relPath);
        }
        walk(child);
      }
    };
    walk(api.root);
    return open;
  }, [treeRef]);

  const persist = useCallback(
    (sel: string | null) => {
      if (projectId) savePersisted(projectId, snapshotOpen(), sel);
    },
    [projectId, snapshotOpen],
  );

  // Restore the persisted selection. The tree api + the target node may not be
  // present (or a load may transiently clear the selection) on the first ready
  // renders under load, so poll briefly: re-apply until react-arborist confirms
  // the node is selected, then stop (so it never fights later user clicks).
  useEffect(() => {
    selectionDone.current = false; // re-arm per project
  }, [projectId]);
  useEffect(() => {
    if (!ready || selectedId === null || selectionDone.current) return;
    const id = selectedId === '' ? ROOT_ID : selectedId;
    let applyTries = 0;
    const timer = setInterval(() => {
      const api = treeRef.current;
      const node = api?.get(id);
      // Keep waiting (cheaply) until the tree mounts + the node loads — don't
      // spend the retry budget on that.
      if (!node) return;
      if (node.isSelected || applyTries++ > 20) {
        selectionDone.current = true;
        clearInterval(timer);
        return;
      }
      // `{ focus: false }` — HIGHLIGHT the open file's row without moving KEYBOARD FOCUS into the tree
      // (issue 144). react-arborist's `select` otherwise dispatches a focus to the node, and its
      // row renderer `.focus()`es that row in an effect whenever the node is focused — so this
      // programmatic sync (which runs on every load, project switch and tab switch, to keep the tree
      // highlight in step with the active editor) would yank DOM focus OUT of the editor and into
      // "Files & Folders" every time, overriding the active-panel focus. Selection is a highlight; it
      // must not steal the caret.
      api?.select(id, { focus: false });
    }, 50);
    // Safety stop after ~12s so the interval can't leak.
    const stop = setTimeout(() => clearInterval(timer), 12_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [ready, selectedId, projectId, treeRef]);

  // Re-read directories and merge. With no argument every currently-loaded dir is
  // re-read (US2 watcher-driven live sync). Given explicit dirs, only those already
  // loaded are re-read (plus the always-loaded root) — used to reconcile from an
  // awaited operation result (see paste), which converges the tree even when the
  // fs-watch re-read is missed or coalesced. Folders that vanished are dropped; new
  // entries appear. react-arborist keeps open + selected state by id, so
  // expansion/selection are preserved for survivors.
  const reloadDirs = useCallback(async (dirs?: readonly string[]): Promise<Set<string>> => {
    const loaded = childrenMapRef.current;
    const keys = (dirs ?? [...loaded.keys()]).filter((k) => k === '' || loaded.has(k));
    if (keys.length === 0) return new Set();
    const results = await Promise.all(
      keys.map(async (k) => [k, await fetchRef.current(k)] as const),
    );
    // The child relPaths that EXIST after this re-read, across every dir we reloaded.
    // Returned so callers can bound a stale pending open/select target: a move/rename
    // whose node never materialised must not linger and later act on a same-named
    // node created at that exact path (Finding 2).
    const present = new Set<string>();
    for (const [, kids] of results) if (kids) for (const kid of kids) present.add(kid.relPath);
    setChildrenMap((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const [k, kids] of results) {
        if (kids) {
          if (!sameEntries(prev.get(k), kids)) {
            next.set(k, kids);
            changed = true;
          }
        } else if (k !== '' && prev.has(k)) {
          next.delete(k); // a loaded folder disappeared
          changed = true;
        }
      }
      // No real change (e.g. a spurious watch event) → keep the SAME map ref so
      // react-arborist doesn't rebuild and lose open/selection state.
      return changed ? next : prev;
    });
    return present;
  }, []);

  // 026 / #186 (FR-010a) — live sync has stopped for good. Until now the tree just froze, which is
  // indistinguishable from a project in which nothing is happening; the user keeps acting on a
  // listing that has quietly stopped being true. Reported as an ordinary dismissable error notice.
  useEffect(() => {
    if (!rootFolder) return;
    return window.throng?.files?.onWatchFailed?.(() => {
      /*
        * 030 FR-025 — the FOLDER being watched is the subject, so the action stops standing in for
        * it ("keep this folder up to date" named nothing at all).
        *
        * The MESSAGE is deliberately untouched. `editor-stranded-restart.e2e.ts:163` asserts this
        * exact sentence is ABSENT after a recovery, and an assertion of absence is silently
        * satisfied by any rewording — changing it here would turn someone else's guard into a
        * no-op without a single test going red. It restates no subject, so FR-023 is not at stake.
        */
      failRef.current(
        'Live updates have stopped for this project. Reopen it to resume watching for changes.',
        'keep watch on',
        nodeSubjectRef.current(''),
      );
    });
  }, [rootFolder]);

  // Live sync (US2): re-read every loaded directory when the watcher reports a change.
  useEffect(() => {
    if (!rootFolder) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = window.throng?.files?.onChange?.(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reloadDirs(), 80); // coalesce bursts
    });
    return () => {
      if (timer) clearTimeout(timer);
      off?.();
    };
  }, [rootFolder, reloadDirs]);

  /**
   * Ensure a folder's children are loaded (lazy, on first open).
   *
   * 033 US4 — it now HANDS BACK that listing, which is purely additive: every existing caller
   * ignores the value and behaves exactly as before (FR-046/D9 — the toolbar's Expand is one of
   * them and is untouched). `expandChildren` needs it because `data` is rebuilt by a React render
   * that has not happened yet on the tick a folder is first loaded in, so a folder opened a moment
   * ago still renders as childless — reading the listing itself is the only way to name the
   * children of a folder that was CLOSED when the user asked for this (FR-042).
   *
   * `undefined` means the listing FAILED (the folder is gone, or unreadable). That is the signal
   * `expandChildren` refuses to open on, which is what keeps FR-043/SC-009 true rather than hopeful.
   */
  const ensureLoaded = useCallback(
    async (rel: string): Promise<TreeNodeData[] | undefined> => {
      const cached = childrenMap.get(rel);
      if (cached !== undefined) return cached;
      const kids = await fetchRef.current(rel);
      if (kids) setChildrenMap((p) => new Map(p).set(rel, kids));
      return kids ?? undefined;
    },
    [childrenMap],
  );

  // #120 — reconcile the two independent "is it open?" signals so they can never
  // disagree. react-arborist decides open-ness from its own open map (keyed by id
  // = relPath), which is NOT migrated when a folder moves and is NOT pruned when a
  // folder disappears. A stale entry — left by a move, or restored from
  // localStorage — makes a folder render OPEN while its children were never
  // loaded: `build(dir)` yields `[]` for an unloaded folder, indistinguishable
  // from a genuinely empty one, so it wedges open-but-empty and never loads.
  //
  // The cure is to make "open" self-healing: whenever react-arborist reports a
  // folder open but we have not loaded its children, load them. An unloaded folder
  // thus resolves to its real contents (or provably nothing), and the chevron +
  // glyph always end up agreeing with what is actually shown.
  useEffect(() => {
    const api = treeRef.current;
    if (!api) return;
    const walk = (node: NodeApi<TreeNodeData>): void => {
      for (const child of node.children ?? []) {
        const rel = child.data.relPath;
        if (child.data.kind === 'folder' && rel !== '' && child.isOpen && !childrenMap.has(rel)) {
          void ensureLoaded(rel);
        }
        walk(child);
      }
    };
    walk(api.root);
  }, [data, childrenMap, ensureLoaded, treeRef]);

  // #120 — drain the migrated open-state a MOVE queued (see `drop`). Once the node
  // exists at its NEW path, open it; the self-healing effect above then loads its
  // children. Runs on every data change until the target has appeared.
  useEffect(() => {
    if (pendingOpen.current.size === 0) return;
    const api = treeRef.current;
    if (!api) return;
    let opened = false;
    for (const rel of [...pendingOpen.current]) {
      if (api.get(rel)) {
        pendingOpen.current.delete(rel);
        api.open(rel);
        opened = true;
      }
    }
    // Finding 5 — persist the migrated expansion the instant it applies, so a MOVE
    // survives an IMMEDIATE close/reload (not only the next user toggle/select). Do it
    // explicitly and intentionally here rather than leaning on api.open's onToggle
    // side-effect. Guarded on `opened`, so it fires once per real migration and never on
    // the no-op runs this effect makes on every unrelated data change — no localStorage
    // thrash.
    if (opened) persist(selectedId);
  }, [data, treeRef, persist, selectedId]);

  // #122 — drain a pending re-selection (see `onRename`). react-arborist re-keys
  // the renamed node, so the old selectedId no longer matches; re-select the new
  // path once it appears. Selecting never opens an editor (that only happens on a
  // row click), so the rename cannot fire an open-file intent.
  useEffect(() => {
    const rel = pendingSelect.current;
    if (rel === null) return;
    const api = treeRef.current;
    if (api?.get(rel)) {
      pendingSelect.current = null;
      // 026 — TAKE FOCUS HERE, unlike every other programmatic select in this file.
      //
      // Issue 144's `{ focus: false }` is right for the editor-sync select (see the selection
      // restore above): that one runs on every load, project switch and tab switch to keep the
      // tree's highlight in step with the active editor, and it must never yank the caret out of
      // the text the user is typing in.
      //
      // THIS drain is a different animal. It is reached only from `onRename`, which is only ever
      // reached from the tree's own inline editor — so the user is, by construction, working in
      // the tree and has just finished an action there. Suppressing focus left the pane dead to
      // the keyboard afterwards: arrows stopped moving the selection and F2 would not start
      // another rename until the tree was clicked again.
      //
      // Cancelling a rename never had this problem, which is what pins the cause here rather than
      // on the input unmounting — Escape takes neither path and keeps focus fine.
      api.select(rel);
    }
  }, [data, treeRef]);

  const onToggle = useCallback(
    (id: string) => {
      // react-arborist also fires onToggle for its INTERNAL root (e.g. during
      // closeAll), whose id is not one of our nodes. Only act on a real folder
      // node — otherwise we'd try to list a bogus path (ENOENT).
      const node = treeRef.current?.get(id);
      if (node && node.data.kind === 'folder' && node.data.relPath !== '') {
        void ensureLoaded(node.data.relPath);
      }
      // Persist the new open-state (the snapshot runs after react-arborist has
      // applied the toggle — onToggle fires post-op).
      persist(selectedId);
    },
    [ensureLoaded, persist, selectedId, treeRef],
  );

  const onSelect = useCallback(
    (nodes: NodeApi<TreeNodeData>[]) => {
      // react-arborist emits an empty onSelect on mount; ignore it until the
      // persisted selection has been restored, so it can't clobber it.
      if (nodes.length === 0 && !selectionDone.current) return;
      const sel = nodes.length > 0 ? nodes[nodes.length - 1].data.relPath : null;
      setSelectedId(sel);
      setSelectedRelPaths(nodes.map((n) => n.data.relPath));
      persist(sel);
    },
    [persist],
  );

  const expandStep = useCallback(() => {
    const api = treeRef.current;
    if (!api) return;
    // Build the open/closed view from react-arborist (the source of truth).
    const toExpand = (node: NodeApi<TreeNodeData>): ExpandNode => ({
      relPath: node.data.relPath,
      kind: node.data.kind,
      open: node.data.relPath === '' ? true : node.isOpen,
      children: node.isOpen || node.data.relPath === '' ? (node.children ?? []).map(toExpand) : undefined,
    });
    const rootNode = api.root.children?.[0];
    if (!rootNode) return;
    const rootExpand = toExpand(rootNode);

    const anchorRel =
      selectedId == null
        ? ''
        : selectedId !== '' && api.get(selectedId)?.data.kind === 'file'
          ? parentRel(selectedId)
          : selectedId;
    const targets = nextExpandTargets(rootExpand, anchorRel);
    if (targets.length === 0) return;

    void Promise.all(targets.map((t) => ensureLoaded(t)))
      .then(() => {
        const a = treeRef.current;
        if (!a) return;
        for (const t of targets) a.open(t);
        persist(selectedId);
      })
      // A `files.list` that REJECTS (the channel is gone, the handler threw) is not the failure
      // `fetchChildren` reports — that one resolves with an `error` and is already announced. This
      // one escapes as an unhandled rejection, which is invisible to the user and to the suite.
      // Nothing is expanded and nothing is claimed to have been; the console keeps the trace.
      // (See `expandChildren` for why this line touches the toolbar's path despite D9.)
      .catch((error: unknown) => console.error('[explorer] expand step failed', error));
  }, [treeRef, selectedId, ensureLoaded, persist]);

  const collapseAll = useCallback(() => {
    const api = treeRef.current;
    if (!api) return;
    api.closeAll();
    api.open(ROOT_ID); // the root stays open
    persist(selectedId);
  }, [treeRef, selectedId, persist]);

  /*
   * 033 US4 — COLLAPSE ALL CHILDREN (FR-039/FR-040, contract D1–D3).
   *
   * Which folders to close is decided by the pure core over the same `ExpandNode` view the
   * toolbar's Expand reads, deepest-first — so they close in ONE pass and no child outlives its
   * parent's collapse (C2). The anchor is excluded by construction, which is what leaves the folder
   * itself open (C1/D1), and makes the project root a case that needs no special handling: the root
   * is the tree, and it is never a descendant of itself (D3).
   *
   * Nothing expanded beneath it → an empty target list → we change nothing and error on nothing
   * (D2). The early return also keeps a no-op off localStorage.
   *
   * ══ "EXPANDED" MEANS EXPANDED AND ON SCREEN — decided, not defaulted (033 review, MINOR 5) ══
   *
   * A descendant behind a CLOSED ancestor is invisible to this action and stays that way: open `a`,
   * open `a/b`, close `a`, then Collapse All Children on `a` — `a/b` is not closed, and `persist`
   * still records it, so reopening `a` shows `b` expanded again. That is the intended behaviour, and
   * the two halves are one mechanism rather than a bug and its symptom:
   *
   *  - `toExpandNode` gives a closed folder `children: undefined`, per `expand.ts`'s convention that
   *    a closed folder's listing is not what is on screen — so the walk stops at a closed ancestor.
   *  - `snapshotOpen` records `isOpen` regardless of ancestry, which is exactly what makes reopening
   *    a folder restore the shape it had (026 / #197). Pruning it would delete the tree's memory as a
   *    side effect of a collapse the user aimed at something they could see.
   *
   * FR-039 is written for a folder the user can see and act on — it requires the anchor to be left
   * "itself open", which only means anything for an anchor that WAS open. Collapsing an ancestor has
   * already achieved everything the user could observe; re-deciding the hidden state beneath it would
   * be this action reaching past what it was pointed at. Recorded in contracts §B.2 (D1).
   */
  const collapseChildren = useCallback(
    (relPath: string): void => {
      const api = treeRef.current;
      const rootNode = api?.root.children?.[0];
      if (!api || !rootNode) return;
      const targets = descendantOpenFolders(toExpandNode(rootNode), relPath);
      if (targets.length === 0) return;
      for (const target of targets) api.close(target);
      // D8 — persist exactly as a manual collapse does: same key, same shape, so the result
      // survives a project switch and a reload (FR-045).
      persist(selectedId);
    },
    [treeRef, persist, selectedId],
  );

  /*
   * 033 US4 — EXPAND ALL CHILDREN (FR-041 to FR-043, contract D4–D7, D10).
   *
   * ONE LEVEL, and every folder it opens has its children loaded first — the `ensureLoaded` →
   * `open` → `persist` path a chevron click and `expandStep` already take, which is the whole of
   * FR-043 and SC-009. The failure it must not reproduce is #120: a folder marked open whose
   * children were never loaded renders as an empty folder that never fills, because `build(dir)`
   * cannot tell "not loaded" from "genuinely empty".
   *
   * So a folder is opened ONLY once its own listing has come back. A listing that fails — the
   * folder was deleted between the right-click and the click — leaves that folder closed rather
   * than open-and-lying, and `fetchChildren` has already reported the failure.
   */
  const expandChildren = useCallback(
    (relPath: string): void => {
      /*
       * The `.catch` is not decoration (033 review, MINOR 6).
       *
       * `fetchChildren` reports the failure it can SEE: `files.list` resolving with an `error`. A
       * REJECTED invoke — the channel torn down mid-expand, the handler throwing — takes a different
       * route out: `ensureLoaded` rejects, `Promise.all` rejects, and this `void`-ed async function
       * rejects with nobody listening. That is an unhandled rejection: no opens, no notice, no trace,
       * and a test that would pass through it.
       *
       * It logs rather than raising a notice, deliberately. The renderer has no message for "the IPC
       * channel threw" that is not a raw error string on screen, and the app's failure model forbids
       * that; what the user sees instead is a tree that did not expand, which is the truth. The
       * anchor stays open — D5 opened it on a listing that DID arrive.
       *
       * `expandStep` above carries the same guard for the same reason. Adding it there touches the
       * toolbar's code, which contract D9 puts off limits; the exemption is recorded in
       * `contracts/explorer-actions.md` rather than taken quietly, because a fix applied to the new
       * copy of a shared shape and not the old one leaves the defect where it started.
       */
      void (async () => {
        if (!treeRef.current) return;
        // D5/FR-042 — a CLOSED anchor opens itself first, and its listing is what names the
        // children to open. Loaded before the open, for the same reason every other folder is.
        const anchorKids = await ensureLoaded(relPath);
        const api = treeRef.current;
        if (!api || anchorKids === undefined) return;
        // The root is always open and is keyed by ROOT_ID, not by its (empty) relPath.
        if (relPath !== '') api.open(relPath);

        /*
         * The immediate child folders, decided by the pure core (C4) over the listing just
         * guaranteed above rather than over the rendered rows: `data` is rebuilt by a React render
         * that has not happened yet on this tick, so a folder opened a moment ago still renders as
         * childless and would expand into nothing at all.
         *
         * D7 — the project's hidden paths are applied here because they are applied to `data` and
         * not to the listing; the global exclude globs were already applied by `fetchChildren`. An
         * excluded folder is not in the tree, so it is not something to expand into.
         */
        const anchorView: ExpandNode = {
          relPath,
          kind: 'folder',
          open: true,
          children: anchorKids.map((kid) => ({
            relPath: kid.relPath,
            kind: kid.kind,
            open: false,
          })),
        };
        const targets = immediateChildFolders(anchorView, relPath).filter((r) => !hiddenSet.has(r));
        if (targets.length === 0) return;

        // D10 — the loads are issued TOGETHER and the opens applied in ONE pass, exactly as
        // `expandStep` does, so a folder with hundreds of children does not appear to hang.
        // Each target reports whether its own listing arrived; only those are opened (D6).
        const loaded = await Promise.all(
          targets.map(async (target) => ((await ensureLoaded(target)) === undefined ? null : target)),
        );
        const a = treeRef.current;
        if (!a) return;
        for (const target of loaded) if (target !== null) a.open(target);
        persist(selectedId);
      })().catch((error: unknown) => console.error('[explorer] expand all children failed', error));
    },
    [treeRef, ensureLoaded, hiddenSet, persist, selectedId],
  );

  // US6 (#137) — reveal a file IN THIS TREE: lazily load and open each ancestor (shallow → deep so
  // each level's children exist before the next opens), then select and scroll to the file.
  const revealInTree = useCallback(
    async (relPath: string, opts?: { focus?: boolean }): Promise<void> => {
      if (!treeRef.current || !relPath) return;
      const ancestors: string[] = [];
      for (let p = parentRel(relPath); p !== ''; p = parentRel(p)) ancestors.unshift(p);
      for (const dir of ancestors) {
        await ensureLoaded(dir);
        treeRef.current?.open(dir);
      }
      const parent = parentRel(relPath);
      if (parent) await ensureLoaded(parent);
      const a = treeRef.current;
      if (!a || !a.get(relPath)) return;
      a.select(relPath, { focus: opts?.focus ?? true });
      a.scrollTo(relPath);
      persist(relPath);
    },
    [treeRef, ensureLoaded, persist],
  );

  // --- File operations (US3). All mutations go through the sandboxed files.*
  // bridge (confinement + naming enforced in the main process); the live-sync
  // watcher then refreshes the tree. Errors surface in the pane's error banner. ---
  const report = useCallback(
    (res: FilesOkOrError | undefined | null, action: string, subject: NoticeSubject): void => {
      if (res && 'error' in res) fail(res.error, action, subject, res.cause);
      else fail(null);
    },
    [fail],
  );

  const kindOf = useCallback(
    (relPath: string): 'file' | 'folder' | null => {
      if (relPath === '') return 'folder';
      for (const arr of childrenMap.values()) {
        const hit = arr.find((e) => e.relPath === relPath);
        if (hit) return hit.kind;
      }
      return null;
    },
    [childrenMap],
  );
  /**
   * A tree path as a NOTICE SUBJECT (030 FR-025).
   *
   * File or folder is answered by the tree's own listing, because that is what the user is looking
   * at; a path the tree has not loaded is reported as a folder, which is the harmless direction —
   * only the word "file"/"folder" would be wrong, never the NAME, and the name is the answer #195
   * is asking for.
   *
   * The containing folder rides along as `dir` (FR-025: include the path where the name alone would
   * be ambiguous), and the empty path is the project's ROOT folder, named by its own last segment
   * rather than by the project — 029 FR-017 is about the folder, and they can differ.
   */
  const nodeSubject = useCallback(
    (relPath: string): NoticeSubject => {
      const segments = (p: string): string[] => p.split(/[\\/]/).filter(Boolean);
      if (relPath === '') {
        const root = rootFolder ? segments(rootFolder).pop() : undefined;
        return { kind: 'folder', name: root ?? rootName };
      }
      const parts = segments(relPath);
      const name = parts[parts.length - 1] ?? relPath;
      const dir = parts.length > 1 ? parts[parts.length - 2] : undefined;
      return { kind: kindOf(relPath) === 'file' ? 'file' : 'folder', name, dir };
    },
    [kindOf, rootFolder, rootName],
  );
  nodeSubjectRef.current = nodeSubject;

  const primarySelected = useMemo<TargetNode | null>(() => {
    if (selectedId === null) return null;
    const kind = kindOf(selectedId);
    // A selection that no longer exists (e.g. just deleted externally) falls back
    // to the root so the next operation still has a valid target.
    return kind === null ? null : { relPath: selectedId, kind };
  }, [selectedId, kindOf]);

  const beginRename = useCallback(
    (relPath?: string) => {
      const rel = relPath ?? selectedId;
      if (rel == null || rel === '') return; // the root cannot be renamed
      treeRef.current?.edit(rel);
    },
    [selectedId, treeRef],
  );

  const onRename = useCallback(
    ({ id, name }: { id: string; name: string }) => {
      const rel = id === ROOT_ID ? '' : id;
      const next = name.trim();
      if (rel === '' || next.length === 0) return;
      // Confirming an unchanged name is a no-op — never an "already exists" error
      // (FR-070). The old leaf name is the last path segment of the rel path.
      const current = rel.split(/[\\/]/).pop() ?? rel;
      if (next === current) return;
      const parentDir = parentRel(rel); // '' at the root, else the containing dir
      const newRel = parentDir ? `${parentDir}/${next}` : next;
      // 026 / #197 — MIGRATE THE OPEN STATE, exactly as a move already does.
      //
      // `drop` migrates every open descendant by prefix into `pendingOpen` and re-persists the
      // instant it applies (#120 "Finding 5"). A rename had no equivalent, and it is the same
      // fact — a folder's path changed — so the same migration is owed. Without it the renamed
      // folder is simply no longer open, and #122's re-selection below then drains through
      // `onSelect → persist`, re-snapshotting the open state and writing the stale entry OUT of
      // localStorage before it can ever be restored. The user loses the expansion and is told
      // nothing.
      //
      // Captured BEFORE the await: the rename re-keys the node, so reading open state afterwards
      // would read a tree the old ids no longer match.
      for (const open of snapshotOpen()) {
        if (open === rel || open.startsWith(`${rel}/`)) {
          pendingOpen.current.add(newRel + open.slice(rel.length));
        }
      }
      void window.throng?.files?.rename?.(rel, next).then((res) => {
        report(res, 'rename', nodeSubject(rel));
        if (!(res && 'error' in res)) {
          // 024 US3: a successful rename is undoable. Recorded with ABSOLUTE paths so the entry
          // still names the same file after a restart.
          pushUndo({ kind: 'rename', from: toAbs(rel), to: toAbs(newRel), at: Date.now() });
          // #122 — the rename changed the node's id, so the old selection no longer
          // matches. Keep the renamed file SELECTED at its new path (never opening
          // an editor). Reconcile the parent dir from the awaited result so the new
          // node materialises deterministically for the pending-select drain.
          pendingSelect.current = newRel;
          const parentLoaded = parentDir === '' || childrenMapRef.current.has(parentDir);
          void reloadDirs([parentDir]).then((present) => {
            // Finding 2 — if the renamed node never appears (e.g. it is immediately
            // deleted, or an external rename moved it again), drop the pending
            // re-selection so a later node created at that same path isn't spuriously
            // selected. Only prune when we actually re-read its parent (else absence
            // isn't proven), and only if a newer op hasn't already superseded it.
            if (parentLoaded && pendingSelect.current === newRel && !present.has(newRel)) {
              pendingSelect.current = null;
            }
          });
        }
        // The document's language override follows the FILE, not its name (016, FR-028e).
        // Without this, renaming a file silently discards the user's explicit choice about it.
        void documents.movePath(projectId, rel, newRel).catch(() => {
          /* no override to carry is the common case, and a failure must not break the rename */
        });
      });
    },
    [report, nodeSubject, documents, projectId, reloadDirs, pushUndo, toAbs, snapshotOpen],
  );

  const cut = useCallback((relPaths: string[]) => {
    const items = relPaths.filter((r) => r !== '');
    if (items.length > 0) setClipboard({ mode: 'cut', relPaths: items });
  }, []);

  const copy = useCallback((relPaths: string[]) => {
    const items = relPaths.filter((r) => r !== '');
    if (items.length > 0) setClipboard({ mode: 'copy', relPaths: items });
  }, []);

  const clearClipboard = useCallback(() => setClipboard(null), []);

  const paste = useCallback(
    (target: TargetNode | null) => {
      if (!clipboard) return;
      const dest = resolveTarget(target);
      // Reconcile the moved-from parents (and the destination) from the awaited
      // result: the move/copy promise resolving guarantees the on-disk change is done,
      // so this drops any stale moved-from row deterministically even when the
      // debounced fs-watch re-read is missed or coalesced (as on a slow CI filesystem).
      if (clipboard.mode === 'cut') {
        const affected = [...new Set([...clipboard.relPaths.map(parentRel), dest])];
        const moving = clipboard.relPaths;
        void window.throng?.files?.move?.(moving, dest).then((res) => {
          // A SET, so no single subject (FR-027). `moving` may hold one item or twenty, and the
          // failure may be about any of them; US3's affected list is what names several.
          report(res, 'move these items', { kind: 'none' });
          if (!(res && 'error' in res)) {
            pushUndo({
              kind: 'move',
              items: moving.map((from) => {
                const leaf = from.split('/').pop() ?? from;
                return { from: toAbs(from), to: toAbs(dest ? `${dest}/${leaf}` : leaf) };
              }),
              at: Date.now(),
            });
          }
          void reloadDirs(affected);
          // A move changes the file's project-relative path, so the override moves with it (016).
          for (const from of moving) carryOverride(from, dest);
        });
        setClipboard(null);
      } else {
        void window.throng?.files?.copy?.(clipboard.relPaths, dest).then((res) => {
          report(res, 'paste these items', { kind: 'none' });
          void reloadDirs([dest]);
        });
      }
    },
    [clipboard, report, reloadDirs, carryOverride, pushUndo, toAbs],
  );

  const remove = useCallback(
    async (relPaths: string[]) => {
      const items = relPaths.filter((r) => r !== '');
      if (items.length === 0) return;
      const what = items.length === 1 ? 'this item' : `these ${items.length} items`;
      const ok = await confirm({
        title: 'Delete',
        message:
          deleteMode === 'permanent'
            ? `Permanently delete ${what}? This cannot be undone.`
            : `Delete ${what}? It will be moved to the Recycle Bin.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      // 026 / #186 (FR-009) — DELETE IS THE ONE MUTATION THAT RECONCILED NOTHING. `onRename`,
      // `drop` and paste all re-read from their awaited result precisely so the tree converges
      // "even if the debounced fs-watch is missed or coalesced"; delete relied wholly on the
      // watcher. A working watcher hid that, and any watcher gap turned a delete that DID happen
      // into one that looked like it had not.
      //
      // Removed optimistically so the node goes at once, and — FR-009a — put back if the delete
      // fails. A failure is not rare on Windows: a file open in another program refuses with EPERM
      // (#196). Leaving an optimistic removal standing for an item still on disk would be the same
      // class of untruth this feature exists to remove, just in the other direction.
      const parents = [...new Set(items.map(parentRel))];
      const beforeDelete = childrenMapRef.current;
      setChildrenMap((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const [dir, kids] of prev) {
          const kept = kids.filter((k) => !items.some((rel) => k.relPath === rel));
          if (kept.length !== kids.length) {
            next.set(dir, kept);
            changed = true;
          }
        }
        // Drop any loaded directory that lived inside something just deleted.
        for (const dir of prev.keys()) {
          if (items.some((rel) => dir === rel || dir.startsWith(`${rel}/`))) {
            next.delete(dir);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      void window.throng?.files?.delete?.(items, deleteMode).then((res) => {
        // One item is a subject; several are a set. The wording follows the same split, which is
        // what removes the "this item" stand-in without pretending a batch has one subject.
        report(
          res,
          items.length === 1 ? 'delete' : 'delete these items',
          items.length === 1 ? nodeSubject(items[0]!) : { kind: 'none' },
        );
        if (res && 'error' in res) {
          // It is still on disk. Restore exactly what was on screen, then reconcile the parents
          // from the filesystem so a PARTIAL batch failure converges on the truth rather than on
          // our optimistic guess.
          setChildrenMap(beforeDelete);
          void reloadDirs(parents);
          return;
        }
        void reloadDirs(parents);
        // Only a RECYCLED delete is undoable — a permanent one has nothing to restore from, and
        // recording it would offer the user an undo that could not possibly work (FR-007).
        if (!(res && 'error' in res) && deleteMode === 'recycle') {
          pushUndo({
            kind: 'delete',
            items: items.map((rel) => ({ originalPath: toAbs(rel) })),
            at: Date.now(),
          });
        }
        // Remove the override with the file (016, FR-028e). Pruning is only an opportunistic
        // backstop for files deleted OUTSIDE throng — relying on it here would let a file
        // re-created at the same path silently inherit the deleted file's language.
        for (const rel of items) {
          void documents.setState(projectId, rel, null).catch(() => {
            /* a file with no override is the common case */
          });
        }
      });
    },
    [confirm, deleteMode, report, nodeSubject, documents, projectId, pushUndo, toAbs, reloadDirs],
  );

  // After creating a folder, enter inline rename on it once it appears (FR-033).
  const pendingRename = useRef<string | null>(null);
  useEffect(() => {
    const rel = pendingRename.current;
    if (rel && treeRef.current?.get(rel)) {
      pendingRename.current = null;
      treeRef.current.edit(rel);
    }
  }, [data, treeRef]);

  const createFolder = useCallback(
    async (target: TargetNode | null) => {
      const dest = resolveTarget(target);
      // Expand the destination folder (loading it if needed) so the new folder
      // is visible and can immediately enter inline rename (FR-033).
      if (dest !== '') {
        await ensureLoaded(dest);
        treeRef.current?.open(dest);
      }
      const res = await window.throng?.files?.newFolder?.(dest);
      // The DESTINATION is the subject: the new folder has no name yet, and the thing that refused
      // the create is the folder it was to go in.
      if (res && 'error' in res) fail(res.error, 'create a new folder in', nodeSubject(dest), res.cause);
      else if (res && 'relPath' in res) pendingRename.current = res.relPath;
    },
    [ensureLoaded, treeRef, fail, nodeSubject],
  );

  // New File (FR-096): create under the selected folder (a file → its parent),
  // then enter inline rename — mirrors createFolder.
  const createFile = useCallback(
    async (target: TargetNode | null) => {
      const dest = resolveTarget(target);
      if (dest !== '') {
        await ensureLoaded(dest);
        treeRef.current?.open(dest);
      }
      const res = await window.throng?.files?.newFile?.(dest);
      if (res && 'error' in res) fail(res.error, 'create a new file in', nodeSubject(dest), res.cause);
      else if (res && 'relPath' in res) pendingRename.current = res.relPath;
    },
    [ensureLoaded, treeRef, fail, nodeSubject],
  );

  const reveal = useCallback(
    (relPath: string) => {
      void window.throng?.files
        ?.reveal?.(relPath)
        .then((res) => report(res, 'reveal', nodeSubject(relPath)));
    },
    [report, nodeSubject],
  );

  // Drag-and-drop result (FR-019): plain drag moves; Ctrl+drag copies. Targets
  // are confined to the root in the main process; the watcher refreshes.
  const drop = useCallback(
    (dragRelPaths: string[], destRelDir: string, asCopy: boolean) => {
      const items = dragRelPaths.filter((r) => r !== '');
      if (items.length === 0) return;
      // #120 — snapshot open folders BEFORE a MOVE so expansion can follow the
      // folder to its new path. Open-state is keyed by relPath, so a move would
      // otherwise strand it (the folder lands closed) and leave a stale entry at
      // the old id. A COPY leaves the original in place, so nothing migrates.
      const openBefore = asCopy ? [] : snapshotOpen();
      const op = asCopy ? window.throng?.files?.copy : window.throng?.files?.move;
      void op?.(items, destRelDir).then(async (res) => {
        report(res, asCopy ? 'copy these items' : 'move these items', { kind: 'none' });
        // A COPY is not undoable by this stack: nothing was lost, and "undo" would mean deleting a
        // file the user can simply delete themselves. A MOVE is.
        if (!asCopy && !(res && 'error' in res)) {
          pushUndo({
            kind: 'move',
            items: items.map((from) => {
              const leaf = from.split('/').pop() ?? from;
              return { from: toAbs(from), to: toAbs(destRelDir ? `${destRelDir}/${leaf}` : leaf) };
            }),
            at: Date.now(),
          });
        }
        if (!asCopy) {
          // Whether we can PROVE a moved node's absence after the reload: only if the
          // destination is loaded (else reloadDirs skips it and can't tell us).
          const destLoaded = destRelDir === '' || childrenMapRef.current.has(destRelDir);
          const movedBases: string[] = [];
          for (const from of items) {
            const leaf = from.split(/[\\/]/).pop() ?? from;
            const newBase = destRelDir ? `${destRelDir}/${leaf}` : leaf;
            movedBases.push(newBase);
            // The moved folder itself, and every open descendant, migrate by prefix.
            for (const open of openBefore) {
              if (open === from || open.startsWith(`${from}/`)) {
                pendingOpen.current.add(newBase + open.slice(from.length));
              }
            }
            // A MOVE carries the override with the file; a COPY deliberately does not — the copy
            // is a new document, and inheriting a language the user chose for a different file
            // would be a guess, not a decision.
            carryOverride(from, destRelDir);
          }
          // Reconcile the moved-from parents + destination from the awaited result,
          // so the tree converges even if the debounced fs-watch is coalesced
          // (mirrors paste). This is also what materialises the moved node at its
          // new path for the pending-open drain to find.
          const affected = [...new Set([...items.map(parentRel), destRelDir])];
          const present = await reloadDirs(affected);
          // Finding 2 — if a moved node never materialised at its destination (deleted
          // or externally renamed mid-move), drop the open-state we just queued for it.
          // Left in place it would linger for the whole session and spuriously open a
          // DIFFERENT folder later created at that exact path.
          if (destLoaded) {
            for (const newBase of movedBases) {
              if (!present.has(newBase)) {
                for (const t of [...pendingOpen.current]) {
                  if (t === newBase || t.startsWith(`${newBase}/`)) pendingOpen.current.delete(t);
                }
              }
            }
          }
        }
      });
    },
    [report, carryOverride, snapshotOpen, reloadDirs, pushUndo, toAbs],
  );

  /**
   * Apply one entry in one direction (FR-006/007/008).
   *
   * Validated FIRST against the world as it is now: the world moves on between an operation and its
   * undo — the file was renamed again by hand, something else now occupies the name, the item was
   * emptied from the Recycle Bin — and replaying blindly would either fail obscurely or overwrite
   * something the user never agreed to lose. A refusal is REPORTED, never silent (FR-008): a user
   * who pressed undo and saw nothing at all would reasonably conclude undo is broken.
   */
  const applyEntry = useCallback(
    async (entry: FileOpUndoEntry, direction: 'undo' | 'redo'): Promise<boolean> => {
      const action = direction === 'undo' ? 'undo that file operation' : 'redo that file operation';
      /*
       * Existence is asked of the CONFINED bridge — not of the loaded tree.
       *
       * The obvious shortcut is to consult `childrenMap`, since the tree has already listed the
       * folders it is showing. It is wrong: a folder the user never expanded has no listing, so
       * every file inside it reads as MISSING, and an undo that moves a file back out of an
       * unexpanded folder refuses itself with "it is no longer there" — about a file that is
       * plainly there. What the tree happens to have loaded is a rendering detail; the world is
       * the world.
       *
       * `validate` wants a SYNC predicate, so the paths it will ask about are resolved first —
       * they are known from the entry — and it is handed the answers.
       */
      const candidates = new Set<string>(
        entry.kind === 'delete'
          ? deletePaths(entry)
          : plannedMoves(entry, direction).flatMap((m) => [m.from, m.to]),
      );
      const known = new Map<string, boolean>();
      await Promise.all(
        [...candidates].map(async (abs) => {
          const rel = toRel(abs);
          known.set(abs, rel === null ? false : ((await window.throng?.files?.exists?.(rel)) ?? false));
        }),
      );
      const exists = (abs: string): boolean => known.get(abs) ?? false;
      const check = validateFileOp(entry, direction, exists);
      if (!check.ok) {
        // NO SUBJECT: an undo entry can carry many moves, and the refusal may be about any of them.
        fail(check.reason, action, { kind: 'none' });
        return false;
      }

      if (entry.kind === 'delete') {
        // Undo restores from the Recycle Bin; redo trashes again. A permanent delete cannot be
        // undone at all, and `validate` has already said so by the time we get here.
        const rels = deletePaths(entry).map(toRel).filter((r): r is string => r !== null);
        if (rels.length === 0) return false;
        const res =
          direction === 'undo'
            ? await Promise.all(rels.map((rel) => window.throng?.files?.restore?.(rel, entry.at)))
            : [await window.throng?.files?.delete?.(rels, deleteMode)];
        const failed = res.find((r) => r && 'error' in r);
        if (failed && 'error' in failed) {
          fail(failed.error, action, { kind: 'none' }, failed.cause);
          return false;
        }
        await reloadDirs([...new Set(rels.map(parentRel))]);
        return true;
      }

      // A move and a rename are the same shape once planned: take `from` to `to`. Which BRIDGE call
      // that is depends only on whether the parent changed — renaming in place, or moving across.
      for (const move of plannedMoves(entry, direction)) {
        const fromRel = toRel(move.from);
        const toRelPath = toRel(move.to);
        if (fromRel === null || toRelPath === null) {
          fail('That file is no longer inside this project.', action, { kind: 'none' });
          return false;
        }
        const sameParent = parentRel(fromRel) === parentRel(toRelPath);
        const leaf = toRelPath.split('/').pop() ?? toRelPath;
        const res = sameParent
          ? await window.throng?.files?.rename?.(fromRel, leaf)
          : await window.throng?.files?.move?.([fromRel], parentRel(toRelPath));
        if (res && 'error' in res) {
          fail(res.error, action, { kind: 'none' }, res.cause);
          return false;
        }
        carryOverride(fromRel, parentRel(toRelPath));
        await reloadDirs([...new Set([parentRel(fromRel), parentRel(toRelPath)])]);
      }
      return true;
    },
    [toRel, fail, deleteMode, reloadDirs, carryOverride],
  );

  const undoFileOp = useCallback(() => {
    const popped = popUndo(stackRef.current);
    if (!popped) return; // nothing to undo is not a failure, and says so by being silent
    void applyEntry(popped.entry, 'undo').then((ok) => {
      if (!ok) return; // a refused entry STAYS on the undo stack — the user may fix the world and retry
      stackRef.current = popped.stack;
      setStack(popped.stack);
      void fileOpUndo.save(projectId, popped.stack);
    });
  }, [applyEntry, fileOpUndo, projectId]);

  const redoFileOp = useCallback(() => {
    const popped = popRedo(stackRef.current);
    if (!popped) return;
    void applyEntry(popped.entry, 'redo').then((ok) => {
      if (!ok) return;
      stackRef.current = popped.stack;
      setStack(popped.stack);
      void fileOpUndo.save(projectId, popped.stack);
    });
  }, [applyEntry, fileOpUndo, projectId]);

  return {
    data,
    ready,
    error,
    errorAction,
    errorCause,
    errorSubject,
    clearError: () => fail(null),
    initialOpenState,
    onToggle,
    onSelect,
    onRename,
    expandStep,
    collapseAll,
    expandChildren,
    collapseChildren,
    revealInTree,
    selectedRelPaths,
    primarySelected,
    clipboard,
    beginRename,
    cut,
    copy,
    clearClipboard,
    paste,
    remove,
    createFolder,
    createFile,
    reveal,
    drop,
    undoFileOp,
    redoFileOp,
    canUndoFileOp: stack.undo.length > 0,
    canRedoFileOp: stack.redo.length > 0,
  };
}
