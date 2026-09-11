/**
 * Shared fixtures for the Find in Files panel's component tests (043 US3, T057–T064f).
 *
 * Two jobs, and deliberately no more. It stubs the `fileSearch` half of the preload bridge — the
 * ONE thing a panel test cannot do without, because the panel's results arrive over a channel
 * rather than through a prop — and it builds the row and panel shapes every file here needs.
 *
 * The stub is a REAL channel, not a seam into the store: `emit` calls whatever the store subscribed
 * with, so every test in this layer exercises the same subscribe/route/drop path the running app
 * does. A `__seedResults(panelId, rows)` helper would have been shorter and would have asserted
 * nothing about the wiring that carries them.
 */
import { act, render, type RenderResult } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { vi, type Mock } from 'vitest';
import { Text } from '@codemirror/state';
import {
  postCommitSnippets,
  type FindInFilesPanelConfig,
  type Panel,
  type ResultRow,
  type SnippetView,
} from '@throng/core';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { FindInFilesPanel } from '../../../src/renderer/find-in-files/find-in-files-panel.js';
import type { FileSearchUpdateEvent } from '../../../src/renderer/find-in-files/find-in-files-store.js';

export const PANEL_ID = 'p1';
export const PROJECT_ID = 'proj-1';
export const PROJECT_ROOT = 'D:/proj';

/** A Find in Files panel as the workspace holds one. */
export function findInFilesPanel(overrides: Partial<Panel> = {}): Panel {
  return {
    type: 'panel',
    id: PANEL_ID,
    originProjectId: PROJECT_ID,
    title: 'Find in Files',
    kind: 'findInFiles',
    ...overrides,
  };
}

/** One match, with a snippet whose truncation flags the caller can override. */
export function resultRow(
  relPath: string,
  line: number,
  from: number,
  snippet: Partial<SnippetView> = {},
): ResultRow {
  return {
    relPath,
    line,
    column: 7,
    from,
    to: from + 6,
    snippet: {
      before: 'const ',
      matched: 'needle',
      after: ' = 1;',
      truncatedStart: false,
      truncatedEnd: false,
      ...snippet,
    },
  };
}

/**
 * Render anything that can contain a Find in Files panel, INSIDE the app's context-menu host.
 *
 * Not a convenience. `useContextMenu()` throws outside a `ContextMenuProvider`, so the moment the
 * panel grew its own menu (043 T075) every file in this suite that rendered it bare would have
 * failed on a hook rather than on the thing it asserts. Wrapping here rather than in eight places
 * is also what makes the menu ASSERTABLE at this tier: the provider is what renders the menu, so a
 * test that stubbed it could only ever prove that `openMenu` was called.
 *
 * The provider itself needs no fixture — `useAppSettings()` falls back to the shipped defaults
 * outside a config provider — so this stays a wrapper and not a harness.
 *
 * 043 US4 adds two more for the same reason: the panel's commit asks a question through `useConfirm`
 * (FR-057b) and reports its outcome through `useNotify` (FR-058), and both hooks throw outside their
 * provider. Wrapping here keeps the dialog and the notice ASSERTABLE — a stubbed `confirm` could
 * only ever prove that something was asked, never that the file count reached the user.
 */
export function renderWithContextMenu(element: ReactElement): RenderResult {
  return render(
    createElement(
      NotificationProvider,
      null,
      createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, element)),
    ),
  );
}

export interface RenderPanelOptions {
  panelId?: string;
  projectId?: string | null;
  projectRoot?: string | null;
  /** 043 FR-027a — the persisted query a RESTORED panel comes back holding (T104). */
  config?: FindInFilesPanelConfig;
  /**
   * 043 FR-062 — the panel's own zoom STEP, as `Panel.zoom` persists it (an integer in [−5, 5]).
   *
   * A level rather than a factor, because that is what the panel is actually handed: `zoomFactor`
   * converts, and a test that passed 1.2 would be asserting against its own conversion rather than
   * against the one the application performs.
   */
  zoom?: number;
  /** Where the panel writes its query back to. `PanelBody` passes `updatePanelConfig` here. */
  onConfigChange?: (config: FindInFilesPanelConfig) => void;
}

/** The Find in Files panel as every file in this suite mounts it. */
export function renderFindInFilesPanel(opts: RenderPanelOptions = {}): RenderResult {
  const panelId = opts.panelId ?? PANEL_ID;
  const projectId = opts.projectId === undefined ? PROJECT_ID : opts.projectId;
  return renderWithContextMenu(
    createElement(FindInFilesPanel, {
      panel: findInFilesPanel({
        id: panelId,
        originProjectId: projectId ?? undefined,
        ...(opts.config === undefined ? {} : { config: opts.config }),
        ...(opts.zoom === undefined ? {} : { zoom: opts.zoom }),
      }),
      projectRoot: opts.projectRoot === undefined ? PROJECT_ROOT : opts.projectRoot,
      projectId,
      onConfigChange: opts.onConfigChange,
    }),
  );
}

/** One file's worth of writes, as `throng:fileSearch:commit` reports them back (#378). */
interface AppliedCommit {
  relPath: string;
  edits: { from: number; to: number }[];
}

/**
 * A commit in which everything asked for landed — echoing the request's own edits as `applied`.
 *
 * A FUNCTION of the payload rather than a constant, because `applied` is the panel's record of which
 * matches it has replaced and how far they moved the rows after them (#378). A static outcome could
 * only name the edits of whichever test wrote it, and would quietly stop being true for the next.
 */
export function committedEverything(
  payload: unknown,
  where: 'changedOnDisk' | 'changedInBuffer' = 'changedOnDisk',
  /**
   * 043 FR-083b — each file's text AFTER this commit, so the answer carries the re-derived snippets
   * a real one does.
   *
   * Derived here with `postCommitSnippets`, the same function main calls, rather than with literals:
   * a fixture that spelled the snippets out by hand would be asserting against the fixture's idea of
   * truncation and word snapping instead of against the application's. Omitted, the outcome carries
   * no snippets — which is the past-the-size-bound answer, and the shape every test written before
   * this requirement still gets.
   */
  after?: Record<string, string>,
): unknown {
  const request = (payload ?? {}) as { targets?: AppliedCommit[]; replacement?: string };
  const targets = request.targets ?? [];
  const replacement = request.replacement ?? '';
  return {
    committed: true,
    outcome: {
      changedInBuffer: where === 'changedInBuffer' ? targets.map((t) => t.relPath) : [],
      changedOnDisk: where === 'changedOnDisk' ? targets.map((t) => t.relPath) : [],
      refused: [],
      failed: [],
      applied: targets.map((t) => {
        const text = after?.[t.relPath];
        if (text === undefined) return { relPath: t.relPath, edits: t.edits };
        const snippets = postCommitSnippets(
          Text.of(text.split('\n')),
          t.edits,
          replacement.length,
        );
        return {
          relPath: t.relPath,
          edits: t.edits.map((e, i) => ({ ...e, snippet: snippets[i] })),
        };
      }),
    },
  };
}

export interface FileSearchStub {
  start: Mock;
  /**
   * 043 FR-078 — this window is displaying the panel, whether or not it started the search.
   *
   * The call a synced sub-workspace view makes on mount, and the one #380 was the absence of: a
   * mirrored panel that could only subscribe by STARTING showed an empty list.
   */
  attach: Mock;
  cancel: Mock;
  /** The panel has gone — release its run in main (data-model §7), not just abandon its scan. */
  drop: Mock;
  /** 043 FR-091a — empty the panel's run for every window watching it; the panel stays. */
  clear: Mock;
  commit: Mock;
  /**
   * 043 FR-070 — the OS folder dialog, as the scope chooser reaches it.
   *
   * Stubbed HERE rather than per test file because it is the same shared `throng:pickFolder`
   * primitive the project form and the preferences start-folder control use (R27): the panel adds
   * no channel of its own, and a test that stubbed a Find-in-Files-shaped picker would be asserting
   * against a seam that does not exist. Resolves `null` by default — a cancelled dialog.
   */
  pickFolder: Mock;
  /** Push one update down the channel, inside `act` so React settles before the assertion. */
  emit: (event: FileSearchUpdateEvent) => void;
  /** How many listeners the store currently holds — one per live panel subscription. */
  listeners: () => number;
}

interface ThrongWindow {
  throng?: unknown;
}

let previous: unknown;

/** Install the `window.throng.fileSearch` bridge stub. Call from `beforeEach`. */
export function installFileSearchStub(): FileSearchStub {
  const callbacks = new Set<(event: FileSearchUpdateEvent) => void>();
  const start = vi.fn(async () => ({ started: true as const }));
  const attach = vi.fn();
  const cancel = vi.fn();
  const drop = vi.fn();
  const clear = vi.fn();
  const commit = vi.fn(async () => ({}));
  const pickFolder = vi.fn(async (): Promise<string | null> => null);

  previous = (window as unknown as ThrongWindow).throng;
  (window as unknown as ThrongWindow).throng = {
    pickFolder,
    fileSearch: {
      start,
      attach,
      cancel,
      drop,
      clear,
      commit,
      onUpdate: (cb: (event: FileSearchUpdateEvent) => void) => {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
    },
  };

  return {
    start,
    attach,
    cancel,
    drop,
    clear,
    commit,
    pickFolder,
    listeners: () => callbacks.size,
    emit: (event) => {
      act(() => {
        for (const cb of [...callbacks]) cb(event);
      });
    },
  };
}

export function removeFileSearchStub(): void {
  (window as unknown as ThrongWindow).throng = previous;
}
