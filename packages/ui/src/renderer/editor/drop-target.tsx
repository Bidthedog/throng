import { useCallback, useEffect, useState, type DragEvent, type ReactElement, type ReactNode } from 'react';

import { useNotify } from '../common/notification.js';
import './drop-target.css';

/**
 * Dropping a file in from the operating system (018 / US9, FR-057 … FR-066a).
 *
 * THE SEAM IS THE DESIGN. Electron 43 removed the non-standard `File.path`, so the only way to learn an
 * OS file's path is `webUtils.getPathForFile`, which lives in the preload. That one adapter is the ONLY
 * part of this feature an end-to-end test cannot drive: a File synthesised in a renderer is not an OS
 * file, and the extractor correctly returns '' for it. So the adapter is one line, everything downstream
 * of it is a pure PATH-TAKING function, and the tests drive it at the path — through the same custom
 * event the explorer already uses to ask for a file to be opened (`throng:open-file`). No test here
 * pretends to exercise the extraction, and this comment is why.
 *
 * The DECISION is not made here. The renderer says "this path was dropped on me"; main resolves the
 * symlinks and applies the confinement rule (`resolveDrop`), because a renderer-side check is a
 * suggestion, not a boundary — and because read scope must equal write scope, or a file opens into an
 * editor that will later refuse to save it (SC-012).
 */

/** Drives the drop handler with real paths — the test seam, and the explorer's own idiom. */
export const OS_DROP_EVENT = 'throng:os-drop';

export interface OsDropDetail {
  panelId: string;
  paths: readonly string[];
}

/** The ownership facts main needs to judge a dropped path. */
export interface DropContext {
  panelId: string;
  tabId: string | null;
  projectRoot: string | null;
  rootless: boolean;
  ownerProjectId?: string;
  allProjectRoots: readonly string[];
}

/** The path of a dragged-in File, or '' when it is not an OS file (a renderer-made one never is). */
function osPathOf(file: File): string {
  return window.throng?.editor?.getPathForFile?.(file) ?? '';
}

export function useDropHandler(
  ctx: DropContext,
  onOpen: (absPath: string) => void,
): (paths: readonly string[]) => Promise<void> {
  const { notify } = useNotify();
  const key = JSON.stringify(ctx);

  return useCallback(
    async (paths: readonly string[]) => {
      const c = JSON.parse(key) as DropContext;
      // NEVER a silent no-op (FR-061). A drop that is refused and says nothing is indistinguishable
      // from a drop that missed, and the user simply tries again, harder. Each refusal gets its OWN
      // notice: a drop of five files that rejects two must explain BOTH, so the id carries the path.
      // (De-duplication is by test id, so a shared id would show only the last refusal.)
      const refuse = (absPath: string, message: string): void => {
        notify({ severity: 'error', message, testId: `os-drop-error-${absPath}` });
      };

      for (const absPath of paths) {
        // Each path is judged, and refused, ON ITS OWN (FR-065). A folder among five files rejects the
        // folder — it does not throw away the other four, which the user plainly meant to open.
        let decision;
        try {
          decision = await window.throng?.editor?.resolveDrop?.({
            panelId: c.panelId,
            ownerKind: c.rootless ? 'subworkspace' : 'project',
            ownerProjectId: c.ownerProjectId,
            ownerRoot: c.projectRoot,
            allProjectRoots: [...c.allProjectRoots],
            tabId: c.tabId,
            absPath,
          });
        } catch {
          // The bridge itself failed. Still a failure, still not silent.
          refuse(absPath, `${absPath} could not be opened.`);
          continue;
        }
        if (!decision) {
          refuse(absPath, `${absPath} could not be opened.`);
          continue;
        }
        if (decision.ok) onOpen(decision.absPath);
        else refuse(absPath, decision.error);
      }
    },
    [key, onOpen, notify],
  );
}

/**
 * Wraps a panel body so an OS file dropped on it opens.
 *
 * Mounted on the EDITOR panel (the file replaces its document) and on the UNTYPED panel (the panel
 * becomes an editor showing the file) — one target, two `onOpen`s, rather than two implementations of
 * the same drop.
 */
export function PanelDropTarget({
  ctx,
  onOpen,
  children,
}: {
  ctx: DropContext;
  onOpen: (absPath: string) => void;
  children: ReactNode;
}): ReactElement {
  const handle = useDropHandler(ctx, onOpen);
  const { notify } = useNotify();
  const [over, setOver] = useState(false);
  const panelId = ctx.panelId;

  // The test seam, and the route the explorer already uses to ask for a file to be opened.
  useEffect(() => {
    const listener = (e: Event): void => {
      const detail = (e as CustomEvent<OsDropDetail>).detail;
      if (!detail || detail.panelId !== panelId) return;
      setOver(false);
      void handle(detail.paths);
    };
    window.addEventListener(OS_DROP_EVENT, listener);
    return () => window.removeEventListener(OS_DROP_EVENT, listener);
  }, [panelId, handle]);

  const isFileDrag = (e: DragEvent): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return (
    <div
      className={`drop-target${over ? ' drop-target--over' : ''}`}
      data-testid={`drop-target-${panelId}`}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        // Claim the drag, and say what will happen to the file: it is COPIED here, not MOVED (FR-063).
        // The browser's default is `move`, which promises the user their file is about to be taken out
        // of the folder it lives in.
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        // THE ONE LINE END-TO-END CANNOT REACH — and the only one.
        const files = Array.from(e.dataTransfer.files);
        const paths = files.map(osPathOf).filter((p) => p.length > 0);
        // A drag whose items yield NO path is not an OS file drag we can serve — a virtual folder, a
        // mail attachment, an item that exists only inside the source application. Dropping it and
        // having nothing whatsoever happen is the same silent no-op by a different door.
        if (files.length > 0 && paths.length === 0) {
          notify({
            severity: 'error',
            message: 'That item has no file on disk, so it cannot be opened.',
            testId: 'os-drop-error-no-path',
          });
          return;
        }
        void handle(paths);
      }}
    >
      {children}
    </div>
  );
}
