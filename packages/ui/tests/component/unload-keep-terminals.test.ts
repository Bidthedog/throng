/**
 * 046 T124 — repro for the reported defect "Keep Terminals Running closes terminals"
 * (FR-086, SC-011; contracts/unload.md §6 step 6).
 *
 * The maintainer: "Even if I select … keep terminals running, the terminals seem to close." They do.
 * The orchestrator's step 6 sends `terminal.closeIdle` for the keep action
 * (`packages/ui/src/renderer/sidebar/unload-project.ts:224`), so every IDLE shell of the project — the
 * commonest terminal there is — is ended on an Unload whose label promised to keep it. Only a shell
 * running a command survived, which is why it looked like "the terminals seem to close" rather than
 * "every terminal closes".
 *
 * FR-086 (constitution v5.6.0 Principle III, stated exception): an Unload that keeps terminals running
 * keeps EVERY terminal, idle shells included, and reattaches each one on the next load. So Keep sends
 * the terminal RPC nothing at all — no `closeIdle`, no `killAll` — and End sends
 * `killAll({ projectId, exceptPanelIds })`, the spare list being the panels a sub-workspace holds
 * (FR-037).
 *
 * The orchestrator is driven directly with a fake `window.throng.terminal`, and what it SENDS is
 * asserted: the daemon side of "kept means alive" is
 * `packages/daemon/tests/integration/terminal-unload-keep.integration.test.ts`, and the process-level
 * proof is `terminal-no-orphans.e2e.ts` (T129). Dialogs are T123's (`unload-project.test.ts`); every
 * case here is one that raises none today — an idle-only project, or a busy one with the old level at
 * `none` — so each test fails on the RPC it sends, not on a prompt.
 */
import { render } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab, UnloadTerminalAction } from '@throng/core';
import { ConfirmProvider, useChoose, useConfirm } from '../../src/renderer/confirm-dialog.js';
import { DirtyCloseDialog } from '../../src/renderer/editor/dirty-close-dialog.js';
import { __resetDirtyCloseStore } from '../../src/renderer/editor/dirty-close-store.js';
import { unloadProject, type UnloadCollaborators } from '../../src/renderer/sidebar/unload-project.js';

const PROJECT_ID = 'proj-1';
const PROJECT_NAME = 'Widgets';

interface FakeSession {
  panelId: string;
  busy: boolean;
  meta?: { panelName?: string };
}
const IDLE_A: FakeSession = { panelId: 't-idle-a', busy: false, meta: { panelName: 'pwsh' } };
const IDLE_B: FakeSession = { panelId: 't-idle-b', busy: false, meta: { panelName: 'bash' } };
const BUSY: FakeSession = { panelId: 't-busy', busy: true, meta: { panelName: 'npm run dev' } };

function fakeBridge(sessions: FakeSession[]) {
  const rpc = {
    list: vi.fn((_projectId: unknown, _opts: unknown) => Promise.resolve({ sessions })),
    closeIdle: vi.fn((_params: unknown) => Promise.resolve({ closed: sessions.filter((s) => !s.busy).map((s) => s.panelId) })),
    killAll: vi.fn((_params: unknown) => Promise.resolve({ killed: sessions.map((s) => s.panelId) })),
  };
  Reflect.set(window, 'throng', {
    editor: { saveAll: () => Promise.resolve({ saved: [], skippedUnpathed: [], failed: [] }) },
    terminal: rpc,
  });
  return rpc;
}

function mountDialogs(): { choose: ReturnType<typeof useChoose>; confirm: ReturnType<typeof useConfirm> } {
  const captured: { choose?: ReturnType<typeof useChoose>; confirm?: ReturnType<typeof useConfirm> } = {};
  function Probe(): null {
    captured.choose = useChoose();
    captured.confirm = useConfirm();
    return null;
  }
  render(
    createElement(
      ConfirmProvider,
      null,
      createElement(Fragment, null, createElement(Probe), createElement(DirtyCloseDialog)),
    ),
  );
  return captured as { choose: ReturnType<typeof useChoose>; confirm: ReturnType<typeof useConfirm> };
}

/**
 * `level` is the WITHDRAWN `confirmations.unloadProject`, seeded raw (see `unload-project.test.ts`'s
 * header). `none` keeps today's code from raising its dialog for a busy terminal, so the busy case below
 * reaches step 6 and fails on what it sends, which is the defect this file is about.
 */
function collaborators(
  defaultAction: UnloadTerminalAction,
  opts: { subWorkspaces?: ReadonlyArray<{ tabs: readonly Tab[] }>; level?: string } = {},
): UnloadCollaborators {
  const { choose, confirm } = mountDialogs();
  const deps = {
    settings: {
      confirmations: { unloadProject: opts.level ?? 'none' },
      projects: { unloadTerminalAction: defaultAction },
    },
    isDirty: () => false,
    subWorkspaces: opts.subWorkspaces ?? [],
    editorPanelIds: [],
    choose,
    confirm,
    unloadProject: vi.fn(),
    disposeEditor: vi.fn(),
    reportFailure: vi.fn(),
  };
  return deps as unknown as UnloadCollaborators;
}

function subWorkspaceHolding(panelId: string): { tabs: readonly Tab[] } {
  return {
    tabs: [
      {
        id: `tab-${panelId}`,
        root: { type: 'panel', id: panelId, originProjectId: PROJECT_ID, title: panelId, kind: 'terminal' },
      } as unknown as Tab,
    ],
  };
}

afterEach(() => {
  __resetDirtyCloseStore();
  Reflect.deleteProperty(window, 'throng');
});

describe('T124 repro — Keep Terminals Running sends the terminal RPC nothing (FR-086)', () => {
  const KEEP_ROUTES: Array<[string, UnloadTerminalAction, UnloadTerminalAction | undefined]> = [
    ['"Unload Project" under keepRunning', 'keepRunning', undefined],
    ['"Unload Project and Keep Terminals Running" under endTerminals', 'endTerminals', 'keepRunning'],
  ];

  describe.each(KEEP_ROUTES)('%s', (_route, defaultAction, variant) => {
    it('with only idle shells: no closeIdle, no killAll — the idle shells are KEPT', async () => {
      const rpc = fakeBridge([IDLE_A, IDLE_B]);
      const deps = collaborators(defaultAction);

      await unloadProject(PROJECT_ID, PROJECT_NAME, variant, deps);

      expect(deps.unloadProject).toHaveBeenCalledWith(PROJECT_ID);
      // The reported defect: today this is called with { projectId, exceptPanelIds: [] }.
      expect(rpc.closeIdle, 'Keep Terminals Running closed the idle shells').not.toHaveBeenCalled();
      expect(rpc.killAll).not.toHaveBeenCalled();
      expect(deps.reportFailure).not.toHaveBeenCalled();
    });

    it('with a busy terminal beside an idle shell: still nothing sent', async () => {
      const rpc = fakeBridge([BUSY, IDLE_A]);
      const deps = collaborators(defaultAction);

      await unloadProject(PROJECT_ID, PROJECT_NAME, variant, deps);

      expect(deps.unloadProject).toHaveBeenCalledWith(PROJECT_ID);
      expect(rpc.closeIdle, 'Keep Terminals Running closed the idle shell beside the busy one').not.toHaveBeenCalled();
      expect(rpc.killAll).not.toHaveBeenCalled();
    });
  });
});

describe('End Terminals ends every terminal of the project with one killAll (FR-111, FR-037)', () => {
  const END_ROUTES: Array<[string, UnloadTerminalAction, UnloadTerminalAction | undefined]> = [
    ['"Unload Project" under endTerminals', 'endTerminals', undefined],
    ['"Unload Project and End Terminals" under keepRunning', 'keepRunning', 'endTerminals'],
  ];

  describe.each(END_ROUTES)('%s', (_route, defaultAction, variant) => {
    it('with only idle shells: killAll, never closeIdle', async () => {
      const rpc = fakeBridge([IDLE_A, IDLE_B]);
      const deps = collaborators(defaultAction);

      await unloadProject(PROJECT_ID, PROJECT_NAME, variant, deps);

      // Today an idle-only project takes FR-034c's shortcut and sends closeIdle for End as well.
      expect(rpc.killAll).toHaveBeenCalledWith({ projectId: PROJECT_ID, exceptPanelIds: [] });
      expect(rpc.closeIdle).not.toHaveBeenCalled();
    });

    it('with a busy terminal: one killAll, carrying the panels a sub-workspace holds as exceptPanelIds', async () => {
      const rpc = fakeBridge([BUSY, IDLE_A]);
      const deps = collaborators(defaultAction, { subWorkspaces: [subWorkspaceHolding(IDLE_B.panelId)] });

      await unloadProject(PROJECT_ID, PROJECT_NAME, variant, deps);

      expect(rpc.killAll).toHaveBeenCalledTimes(1);
      expect(rpc.killAll).toHaveBeenCalledWith({ projectId: PROJECT_ID, exceptPanelIds: [IDLE_B.panelId] });
      expect(rpc.closeIdle).not.toHaveBeenCalled();
    });
  });
});
