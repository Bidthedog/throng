/**
 * The ONE pair of callbacks `FilesService.setOnMoveStarted` / `setOnMoved` hold (contracts/preview-ipc.md
 * §3, *One callback per setter*; contracts/navigation-history.md §3 *Path changes*).
 *
 * Each setter keeps a single callback, so every consumer of an in-app move is called from here, in order:
 *
 * 1. `beginMove` — the coordinator, then the previews: a folder watch must not read the file's absence as a
 *    delete (019 FR-004, 044 FR-013c).
 * 2. `markMoved` — the coordinator first, so a parented preview has followed its document through
 *    `repointed` before `PreviewService.moved` looks at the standalone runs.
 * 3. `rewritePaths` over every navigation history, once (never from `markMoved`), then `throng:files:moved`
 *    to every window, which rewrites `config.history` and a preview's `config.filePath` for the panels its
 *    layout holds.
 *
 * Extracted from `main.ts` so the integration suite can drive the real order.
 *
 * ## A preview held back by a collision (FR-012; review of batch B, I-1)
 *
 * A move onto a path another preview already shows leaves the moved preview on its OLD path — standalone
 * (`PreviewService.moved`), or sent back there by `repointed` when its document moved. Main's run is only
 * one of three records of where that preview is: its navigation history and every window's
 * `config.filePath` / `config.history` are the others, and the layout is what a relaunch restores from.
 * So the held-back panels are excluded from `rewritePaths`, and — because every window rewrites the
 * layouts it holds from `throng:files:moved`, which names moves and not panels — their path and history are
 * re-announced AFTER it (`pathChanged`, `history:changed`), which puts each window's copy back. Messages
 * from main reach a window in the order sent.
 */
import type { MovePair } from './files-service.js';

export interface InAppMoveDeps {
  coordinator: { beginMove(absPaths: readonly string[]): void; markMoved(moves: readonly MovePair[]): void };
  previews: {
    beginMove(absPaths: readonly string[]): void;
    /** Returns the preview panels a collision kept on their old path. */
    moved(moves: readonly MovePair[]): readonly string[];
    /** Broadcast `pathChanged` with the path the panel's run shows now. */
    announcePath(panelId: string): void;
  };
  history: {
    rewritePaths(moves: readonly MovePair[], except?: readonly string[]): void;
    /** Broadcast `history:changed` with the panel's record as it stands. */
    announce(panelId: string): void;
  };
  /** `throng:files:moved { moves }` to every window. */
  broadcastFilesMoved(moves: readonly MovePair[]): void;
}

export interface InAppMoveCallbacks {
  started(absPaths: readonly string[]): void;
  moved(moves: readonly MovePair[]): void;
}

export function createInAppMoveCallbacks(deps: InAppMoveDeps): InAppMoveCallbacks {
  return {
    started: (absPaths) => {
      deps.coordinator.beginMove(absPaths);
      deps.previews.beginMove(absPaths);
    },
    moved: (moves) => {
      deps.coordinator.markMoved(moves);
      const heldBack = deps.previews.moved(moves);
      deps.history.rewritePaths(moves, heldBack);
      deps.broadcastFilesMoved(moves);
      for (const panelId of heldBack) {
        deps.previews.announcePath(panelId);
        deps.history.announce(panelId);
      }
    },
  };
}
