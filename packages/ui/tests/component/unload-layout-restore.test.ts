/**
 * 046 US4 (T064) — Unload touches NOTHING in the saved layout (contracts/unload.md §5, §2 "The next
 * load"; FR-033, FR-034, SC-005, US4 scenarios 5 and 7).
 *
 * Drives the REAL `unloadProject` orchestrator (`packages/ui/src/renderer/sidebar/unload-project.ts`,
 * T073 — NOT YET CREATED, so every test below is red on the import) over `mount-workspace.ts`'s real
 * `WorkspaceProvider`, so "deletes nothing from the saved layout" is read off the SAME `saves` spy
 * every other `mountWorkspace`-based test reads `workspace.save` payloads from — not a re-derived
 * assertion about the orchestrator's internals.
 *
 * ══ WHAT "FLUSHES PENDING LAYOUT SAVES" MEANS, PINNED HERE ══
 *
 * `packages/ui/src/renderer/state/layout-saves.ts` already exists and is exactly this primitive:
 * `settleLayoutSaves()` fires every ARMED debounce and awaits every IN-FLIGHT `workspace.save` — the
 * same drain the app's shutdown path uses (019 FR-010). The orchestrator is expected to call it
 * (module-level, no hook, so a plain function can) once the project's own `unloadProject(id)`
 * collaborator has run and before it touches any terminal — nothing here mandates exactly where
 * relative to disposeEditor, only that it happens, which is what "renameTab schedules an edit, then
 * unloadProject flushes it" below actually proves.
 *
 * ══ WHAT THE [DERIVED] REATTACH CLAIM IS SCOPED TO HERE ══
 *
 * The MECHANISM ("mounts through the existing `attach {explicit:false}` path") is unchanged,
 * pre-existing behaviour — `contracts/unload.md` §2 says so explicitly ("Each one mounts through the
 * EXISTING attach path") — and process-level proof that a spared session actually reattaches (and an
 * ended one gets a new shell) is `terminal-no-orphans.e2e.ts` (T065), which needs a real conhost this
 * layer cannot see. What THIS file can and must prove is the precondition that mechanism depends on:
 * neither variant removes the terminal Panel from the layout, so there is something left for
 * `attach {explicit:false}` to mount into on the next load.
 */
import { act } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { DirtyCloseDialog } from '../../src/renderer/editor/dirty-close-dialog.js';
import { __resetDirtyCloseStore } from '../../src/renderer/editor/dirty-close-store.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';
// NOT YET CREATED (T073) — the RED this whole file is for.
import { unloadProject, type UnloadCollaborators } from '../../src/renderer/sidebar/unload-project.js';

const PROJECT_ID = 'proj';
const PROJECT_NAME = 'Widgets';

function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT_ID, { tab: 't1', panel: 'e1' });
  const e1: Panel = { type: 'panel', id: 'e1', originProjectId: PROJECT_ID, title: 'Ed', kind: 'editor', config: { filePath: 'D:/proj/a.ts' } };
  const term1: Panel = { type: 'panel', id: 'term1', originProjectId: PROJECT_ID, title: 'Shell', kind: 'terminal' };
  l.tabs[0].root = { type: 'split', orientation: 'row', children: [e1, term1], sizes: [0.5, 0.5] };
  return l;
}

/** Torn down in `afterEach` — `registerLayoutFlusher` is a MODULE-LEVEL singleton set, and an
 *  un-unmounted provider from a previous test would leave its flusher registered into this one. */
let mounted: MountedWorkspace | undefined;

async function mount(): Promise<{ m: MountedWorkspace }> {
  const m = await mountWorkspace(layout(), {
    extras: [
      createElement(
        ConfirmProvider,
        { key: 'confirm' },
        createElement(Fragment, null, createElement(DirtyCloseDialog)),
      ),
    ],
    throng: {
      editor: { saveAll: () => Promise.resolve(true) },
      terminal: {
        // 046 FR-086/FR-111 — Keep sends the terminal service nothing, End sends killAll; no dialog.
        list: () => Promise.resolve({ sessions: [] }),
        killAll: () => Promise.resolve({ killed: 0 }),
      },
    },
  });
  mounted = m;
  return { m };
}

function collaborators(m: MountedWorkspace, overrides: Partial<UnloadCollaborators> = {}): UnloadCollaborators {
  const editorPanelIds = (m.ws().layout?.tabs.flatMap((t) => collectPanels(t.root) as Panel[]) ?? [])
    .filter((p) => p.kind === 'editor')
    .map((p) => p.id);
  return {
    settings: {
      projects: { unloadTerminalAction: 'keepRunning' },
    },
    isDirty: () => false,
    subWorkspaces: [],
    editorPanelIds,
    unloadProject: vi.fn(),
    disposeEditor: vi.fn(),
    reportFailure: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  __resetDirtyCloseStore();
  mounted?.unmount();
  mounted = undefined;
});

describe('unloading flushes a pending layout save, and deletes nothing from it (FR-033, contracts/unload.md §5)', () => {
  it('a rename armed just before Unload reaches workspace.save BEFORE unload resolves, with every panel still in it', async () => {
    const { m } = await mount();
    // Arms the 400ms debounce (workspace-store.tsx) — NOT awaited, so it is still ARMED, not in
    // flight, when unloadProject runs. That is the half `settleLayoutSaves` must FIRE rather than
    // simply await.
    act(() => m.ws().renameTab('t1', 'Renamed'));
    expect(m.saves).not.toHaveBeenCalled(); // armed, not yet sent — the precondition this test needs

    await unloadProject(PROJECT_ID, PROJECT_NAME, undefined, collaborators(m));

    expect(m.saves).toHaveBeenCalled();
    const sent = m.saves.mock.calls.at(-1)?.[0] as { layout: WorkspaceLayout } | undefined;
    const panelIds = (sent?.layout.tabs.flatMap((t) => collectPanels(t.root) as Panel[]) ?? []).map((p) => p.id);
    expect(panelIds.sort()).toEqual(['e1', 'term1']); // both panels — nothing was deleted
    expect(sent?.layout.tabs).toHaveLength(1); // the tab itself is untouched too
  });

  it('with NOTHING armed, Unload still resolves — flushing is a no-op, not a requirement', async () => {
    const { m } = await mount();

    await expect(unloadProject(PROJECT_ID, PROJECT_NAME, undefined, collaborators(m))).resolves.toBeUndefined();
  });
});

describe('[derived] neither Unload variant removes the terminal Panel — the reattach precondition (contracts/unload.md §2)', () => {
  it('Keep running leaves the terminal Panel in the layout for the next attach {explicit:false}', async () => {
    const { m } = await mount();

    await unloadProject(PROJECT_ID, PROJECT_NAME, 'keepRunning', collaborators(m));

    const ids = (m.ws().layout?.tabs.flatMap((t) => collectPanels(t.root) as Panel[]) ?? []).map((p) => p.id);
    expect(ids).toContain('term1');
  });

  it('End terminals ALSO leaves the terminal Panel — the next mount gets a new shell, not a missing panel', async () => {
    const { m } = await mount();

    await unloadProject(PROJECT_ID, PROJECT_NAME, 'endTerminals', collaborators(m));

    const ids = (m.ws().layout?.tabs.flatMap((t) => collectPanels(t.root) as Panel[]) ?? []).map((p) => p.id);
    expect(ids).toContain('term1');
  });
});
