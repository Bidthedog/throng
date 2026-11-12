/**
 * A folder arriving from outside throng (067 US3: `throng <path>`, the file manager's item).
 *
 * Main resolves the path, queues the request and delivers it once this window has said `ready()`.
 * Each request is classified against the project list by core's `decideOpenFolder` (FR-026, FR-027)
 * and then acted on through the paths the Projects panel already uses, so nothing here is a second
 * way to add or open a project:
 *
 * - `add`: `createProject`, the existing add-project path and its validation, named after the folder
 *   and given a colour from the shared palette no project holds. A refusal by that path is its own
 *   notice, raised by the projects store.
 * - `select`: `switchProject`, or with `projects.openFromOutside: 'load'` only `loadProject` (FR-035).
 * - `refuse-contains` / `refuse-invalid`: ONE notice, nothing added.
 *
 * A request that arrives while a modal is open waits for it to close, and several waiting requests
 * keep their arrival order: stealing the window out from under a dialog the user is answering would
 * be worse than the delay.
 */
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { decideOpenFolder, logCaught, SUBWORKSPACE_PALETTE, type OpenFolderPathKind } from '@throng/core';
import { useAppSettings, useConfigLoaded } from '../config/config-store.js';
import { useNotify } from '../common/notification.js';
import { useProjects } from '../state/projects-store.js';

interface FolderRequest {
  absPath: string;
  kind: OpenFolderPathKind;
}

const leaf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const parentLeaf = (p: string): string | undefined => {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : undefined;
};

/** Whether a modal dialog is up: every modal in the renderer says `aria-modal`. */
const modalOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null;

export function OpenFolderListener(): ReactElement | null {
  const { projects, loading, createProject, switchProject, loadProject } = useProjects();
  const { notify } = useNotify();
  const mode = useAppSettings().projects.openFromOutside;
  // The preference arrives with the config document; acting before it lands would use the shipped default.
  const configLoaded = useConfigLoaded();
  const ready = !loading && configLoaded;

  // The CURRENT values, read when a queued request is finally acted on rather than when it arrived.
  const live = useRef({ projects, loading: !ready, createProject, switchProject, loadProject, notify, mode });
  live.current = { projects, loading: !ready, createProject, switchProject, loadProject, notify, mode };

  const queue = useRef<FolderRequest[]>([]);
  const busy = useRef(false);

  const act = useCallback(async (req: FolderRequest): Promise<void> => {
    const l = live.current;
    const decision = decideOpenFolder(req.absPath, req.kind, l.projects);
    switch (decision.kind) {
      case 'select':
        if (l.mode === 'load') l.loadProject(decision.projectId);
        else await l.switchProject(decision.projectId);
        return;
      case 'add': {
        const used = new Set(l.projects.map((p) => p.colour.toLowerCase()));
        const free = SUBWORKSPACE_PALETTE.filter((c) => !used.has(c.toLowerCase()));
        const pool = free.length > 0 ? free : SUBWORKSPACE_PALETTE;
        const colour = pool[Math.floor(Math.random() * pool.length)] ?? SUBWORKSPACE_PALETTE[0]!;
        await l.createProject(
          { name: leaf(req.absPath), colour, rootFolder: req.absPath },
          { activate: l.mode !== 'load' },
        );
        return;
      }
      case 'refuse-contains':
        l.notify({
          severity: 'warning',
          subject: { kind: 'project', name: decision.projectName },
          action: 'add a folder containing',
          message: 'Nothing was added.',
          testId: 'open-folder-refused',
          instanceKey: req.absPath,
        });
        return;
      case 'refuse-invalid':
        l.notify({
          severity: 'warning',
          subject: { kind: 'file', name: leaf(req.absPath), dir: parentLeaf(req.absPath) },
          action: 'open',
          message:
            decision.reason === 'file'
              ? 'It is a file, not a folder, so nothing was added.'
              : 'It could not be found, so nothing was added.',
          testId: 'open-folder-refused',
          instanceKey: req.absPath,
        });
        return;
    }
  }, []);

  const pump = useCallback(async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length > 0) {
        if (live.current.loading || modalOpen()) return;
        const req = queue.current.shift()!;
        try {
          await act(req);
        } catch (error) {
          logCaught('open-folder-listener: act on a folder request', error);
        }
      }
    } finally {
      busy.current = false;
    }
  }, [act]);

  // The queue drains again when the project list finishes loading…
  useEffect(() => {
    if (ready) void pump();
  }, [ready, pump]);

  // …and when the last modal closes.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (queue.current.length > 0 && !modalOpen()) void pump();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pump]);

  useEffect(() => {
    const off = window.throng?.openFolder?.onRequest((req) => {
      queue.current.push({ absPath: req.absPath, kind: req.kind });
      void pump();
    });
    return off;
  }, [pump]);

  // Main holds requests until the renderer can act on them: the subscription is made, the list is in and the config has loaded.
  const announced = useRef(false);
  useEffect(() => {
    if (!ready || announced.current) return;
    announced.current = true;
    window.throng?.openFolder?.ready();
  }, [ready]);

  return null;
}
