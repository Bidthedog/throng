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
  isExcluded,
  nextExpandTargets,
  parentRel,
  resolveTarget,
  toNodes,
  type DirEntry,
  type ExpandNode,
  type TargetNode,
} from '@throng/core';
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
  /** Dismiss the current error banner immediately (011, US1, FR-002). */
  clearError: () => void;
  initialOpenState: OpenMap;
  onToggle: (id: string) => void;
  onSelect: (nodes: NodeApi<TreeNodeData>[]) => void;
  onRename: (args: { id: string; name: string }) => void;
  expandStep: () => void;
  collapseAll: () => void;
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
  const { documents } = useServices();
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

  const [childrenMap, setChildrenMap] = useState<Map<string, TreeNodeData[]>>(new Map());
  const [initialOpenState, setInitialOpenState] = useState<OpenMap>({ [ROOT_ID]: true });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelPaths, setSelectedRelPaths] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardState>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deleteMode = settings.explorer.deleteMode;

  // Read directory contents, filter excludes, sort folders-first. No state writes.
  const fetchChildren = useCallback(
    async (relDir: string): Promise<TreeNodeData[] | null> => {
      const res = await window.throng?.files?.list?.(relDir);
      if (!res || 'error' in res) {
        if (res && 'error' in res) setError(res.error);
        return null;
      }
      setError(null);
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
    [globs],
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
        persisted.expanded.map(async (rel) => {
          const kids = await fetchRef.current(rel);
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
      api?.select(id);
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

  // Ensure a folder's children are loaded (lazy, on first open).
  const ensureLoaded = useCallback(
    async (rel: string): Promise<void> => {
      if (childrenMap.has(rel)) return;
      const kids = await fetchRef.current(rel);
      if (kids) setChildrenMap((p) => new Map(p).set(rel, kids));
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

    void Promise.all(targets.map((t) => ensureLoaded(t))).then(() => {
      const a = treeRef.current;
      if (!a) return;
      for (const t of targets) a.open(t);
      persist(selectedId);
    });
  }, [treeRef, selectedId, ensureLoaded, persist]);

  const collapseAll = useCallback(() => {
    const api = treeRef.current;
    if (!api) return;
    api.closeAll();
    api.open(ROOT_ID); // the root stays open
    persist(selectedId);
  }, [treeRef, selectedId, persist]);

  // --- File operations (US3). All mutations go through the sandboxed files.*
  // bridge (confinement + naming enforced in the main process); the live-sync
  // watcher then refreshes the tree. Errors surface in the pane's error banner. ---
  const report = useCallback((res: { ok: true } | { error: string } | undefined | null): void => {
    if (res && 'error' in res) setError(res.error);
    else setError(null);
  }, []);

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
      void window.throng?.files?.rename?.(rel, next).then((res) => {
        report(res);
        if (!(res && 'error' in res)) {
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
    [report, documents, projectId, reloadDirs],
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
          report(res);
          void reloadDirs(affected);
          // A move changes the file's project-relative path, so the override moves with it (016).
          for (const from of moving) carryOverride(from, dest);
        });
        setClipboard(null);
      } else {
        void window.throng?.files?.copy?.(clipboard.relPaths, dest).then((res) => {
          report(res);
          void reloadDirs([dest]);
        });
      }
    },
    [clipboard, report, reloadDirs, carryOverride],
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
      void window.throng?.files?.delete?.(items, deleteMode).then((res) => {
        report(res);
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
    [confirm, deleteMode, report, documents, projectId],
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
      if (res && 'error' in res) setError(res.error);
      else if (res && 'relPath' in res) pendingRename.current = res.relPath;
    },
    [ensureLoaded, treeRef],
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
      if (res && 'error' in res) setError(res.error);
      else if (res && 'relPath' in res) pendingRename.current = res.relPath;
    },
    [ensureLoaded, treeRef],
  );

  const reveal = useCallback(
    (relPath: string) => {
      void window.throng?.files?.reveal?.(relPath).then(report);
    },
    [report],
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
        report(res);
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
    [report, carryOverride, snapshotOpen, reloadDirs],
  );

  return {
    data,
    ready,
    error,
    clearError: () => setError(null),
    initialOpenState,
    onToggle,
    onSelect,
    onRename,
    expandStep,
    collapseAll,
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
  };
}
