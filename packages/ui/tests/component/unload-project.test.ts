/**
 * 046 US4 — the Unload orchestrator (`packages/ui/src/renderer/sidebar/unload-project.ts`), over a
 * MOCKED bridge. Originally T059; rewritten for the iterate-round-1 checkpoint by T123
 * (contracts/unload.md §6; FR-081, FR-086, FR-111, SC-015).
 *
 * ══ THE REPORTED DEFECT (T123) ══
 *
 * The maintainer, after choosing "Unload Project and Keep Terminals Running" / "…End Terminals" from
 * the project menu: "I still get a confirmation prompt" — and "I would not expect a prompt to appear
 * for any options", because each row states its outcome before the click. FR-111 makes that the rule:
 * no project-menu Unload row shows a confirmation of any kind, whatever the preference and whatever
 * the terminals are doing. The unsaved-editor prompt (FR-035) is not an unload confirmation and stays,
 * first. SC-015: 100% of attempts, whatever the terminals are doing.
 *
 * So the repro drives every row the menu can draw (FR-081's table), with a BUSY terminal, with the old
 * confirmation level seeded at its most insistent (`double`), and over the REAL `ConfirmProvider` — so
 * if the orchestrator raises a dialog, a real one renders and the test sees it.
 *
 * ══ WHY `confirmations.unloadProject` IS SEEDED AS A RAW KEY ══
 *
 * T127 withdraws the setting from `AppSettings`, and T128 drops it from `UnloadCollaborators`. The
 * fixture is built as a plain object and cast, so it compiles on both sides of that change: before, the
 * value is the one the orchestrator reads; after, it is an unmodelled leftover in a development
 * `settings.json`, and it must change nothing.
 *
 * ══ SUPERSEDED HERE ══
 *
 * T059's describes for FR-034c's `busyCount === 0` rule, the `none` / `single` / `double` levels, the
 * three-button dialog's naming and focus (M10, R8) and the wry second confirmation are removed: FR-085
 * and FR-111 supersede every one of them. The unsaved guard (FR-035), the release order (step 4 before
 * step 6), the FR-037 exclusion and the one-notice failure rules stand, re-expressed for the two
 * actions that remain: Keep sends the terminal RPC nothing, End sends `killAll` (contracts/unload.md
 * §6 step 6). What Keep must NOT send is `unload-keep-terminals.test.ts`'s (T124).
 *
 * ══ WHAT THIS FILE DOES NOT COVER ══
 *
 * `planUnload` (`unload-plan.test.ts`), the daemon (`terminal-unload-*.integration.test.ts`), the menu
 * rows themselves (`projects-panel-menu.test.ts`, T126) and the process tree
 * (`terminal-no-orphans.e2e.ts`, T129).
 */
import { act, render, screen } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tab, UnloadTerminalAction } from '@throng/core';
import { ConfirmProvider, useChoose, useConfirm } from '../../src/renderer/confirm-dialog.js';
import { DirtyCloseDialog } from '../../src/renderer/editor/dirty-close-dialog.js';
import { __resetDirtyCloseStore } from '../../src/renderer/editor/dirty-close-store.js';
import { unloadProject, type UnloadCollaborators } from '../../src/renderer/sidebar/unload-project.js';

const PROJECT_ID = 'proj-1';
const PROJECT_NAME = 'Widgets';

function ownedEditorPanel(id: string, originProjectId: string): Tab {
  return {
    id: `tab-${id}`,
    root: { type: 'panel', id, originProjectId, title: id, kind: 'editor' },
  } as unknown as Tab;
}

interface Harness {
  choose: ReturnType<typeof useChoose>;
  confirm: ReturnType<typeof useConfirm>;
}

/** Mounts the REAL confirmation stack, so every dialog this orchestrator raises is a real one. */
function mount(): Harness {
  const captured: Partial<Harness> = {};
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
  return captured as Harness;
}

/** The real shape `window.throng.editor.saveAll` resolves (`global.d.ts` `EditorSaveAllResult`). */
interface FakeSaveAllResult {
  saved: string[];
  skippedUnpathed: string[];
  failed: { panelId: string; reason: string }[];
}
const SAVE_ALL_OK: FakeSaveAllResult = { saved: [], skippedUnpathed: [], failed: [] };

interface FakeSession {
  panelId: string;
  busy: boolean;
  meta?: { panelName?: string };
}
const BUSY: FakeSession = { panelId: 't-busy', busy: true, meta: { panelName: 'npm run dev' } };
const IDLE: FakeSession = { panelId: 't-idle', busy: false, meta: { panelName: 'pwsh' } };

function fakeBridge(opts: {
  saveAll?: (params: unknown) => Promise<FakeSaveAllResult>;
  sessions?: FakeSession[];
  list?: () => Promise<{ sessions: FakeSession[] }>;
  closeIdle?: (params: unknown) => Promise<{ closed: string[] }>;
  killAll?: (params: unknown) => Promise<{ killed: string[] }>;
} = {}): void {
  const sessions = opts.sessions ?? [];
  Reflect.set(window, 'throng', {
    editor: { saveAll: opts.saveAll ?? (() => Promise.resolve(SAVE_ALL_OK)) },
    terminal: {
      list: opts.list ?? (() => Promise.resolve({ sessions })),
      closeIdle: opts.closeIdle ?? (() => Promise.resolve({ closed: [] })),
      killAll: opts.killAll ?? (() => Promise.resolve({ killed: [] })),
    },
  });
}

interface DepsOptions {
  defaultAction?: UnloadTerminalAction;
  isDirty?: (id: string) => boolean;
  subWorkspaces?: ReadonlyArray<{ tabs: readonly Tab[] }>;
  editorPanelIds?: readonly string[];
  unloadProject?: (id: string) => void;
  disposeEditor?: (panelId: string) => void;
  reportFailure?: (message: string, projectName: string) => void;
}

function collaborators(opts: DepsOptions = {}): UnloadCollaborators {
  const { choose, confirm } = mount();
  const deps = {
    settings: {
      // Withdrawn by FR-111 (T127) — seeded RAW, at the old level's most insistent value, so a
      // leftover in a development settings.json is shown to change nothing. See the header.
      confirmations: { unloadProject: 'double' },
      projects: { unloadTerminalAction: opts.defaultAction ?? 'keepRunning' },
    },
    isDirty: opts.isDirty ?? (() => false),
    subWorkspaces: opts.subWorkspaces ?? [],
    editorPanelIds: opts.editorPanelIds ?? [],
    // Still handed over while the orchestrator accepts them: if it raised a dialog, the REAL one would
    // render, which is exactly what these tests look for.
    choose,
    confirm,
    unloadProject: opts.unloadProject ?? vi.fn(),
    disposeEditor: opts.disposeEditor ?? vi.fn(),
    reportFailure: opts.reportFailure ?? vi.fn(),
  };
  return deps as unknown as UnloadCollaborators;
}

/**
 * Run an Unload and report what it did FIRST: settle, or raise a confirmation dialog. A dialog never
 * resolves on its own, so awaiting the run directly would hang on the very defect this file reproduces.
 */
async function settleOrDialog(run: Promise<void>): Promise<'settled' | 'dialog'> {
  return Promise.race([
    run.then(() => 'settled' as const),
    screen.findByTestId('confirm-dialog', undefined, { timeout: 3000 }).then(() => 'dialog' as const),
  ]);
}

afterEach(() => {
  __resetDirtyCloseStore();
  Reflect.deleteProperty(window, 'throng');
});

/**
 * FR-081's table: the two rows the menu draws under each preference, and what each one does. The
 * plain row passes no variant; the opposite-action row passes its own.
 */
const ROWS: ReadonlyArray<{
  row: string;
  defaultAction: UnloadTerminalAction;
  variant: UnloadTerminalAction | undefined;
  action: UnloadTerminalAction;
}> = [
  { row: 'Unload Project', defaultAction: 'keepRunning', variant: undefined, action: 'keepRunning' },
  { row: 'Unload Project and End Terminals', defaultAction: 'keepRunning', variant: 'endTerminals', action: 'endTerminals' },
  { row: 'Unload Project', defaultAction: 'endTerminals', variant: undefined, action: 'endTerminals' },
  { row: 'Unload Project and Keep Terminals Running', defaultAction: 'endTerminals', variant: 'keepRunning', action: 'keepRunning' },
];

const TERMINALS: ReadonlyArray<{ what: string; sessions: FakeSession[] }> = [
  { what: 'a busy terminal', sessions: [BUSY, IDLE] },
  { what: 'only idle shells', sessions: [IDLE] },
];

describe('T123 repro — no Unload row shows a confirmation prompt (FR-111, SC-015)', () => {
  for (const { row, defaultAction, variant, action } of ROWS) {
    for (const { what, sessions } of TERMINALS) {
      it(`"${row}" (preference ${defaultAction}) with ${what}: no dialog, and ${action} applies`, async () => {
        const killAll = vi.fn((_params: unknown) => Promise.resolve({ killed: [] as string[] }));
        fakeBridge({ sessions, killAll });
        const deps = collaborators({ defaultAction });

        const first = await settleOrDialog(unloadProject(PROJECT_ID, PROJECT_NAME, variant, deps));

        // The reported defect: today the three-button "Unload Widgets?" dialog opens here.
        expect(first, `"${row}" raised a confirmation dialog`).toBe('settled');
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();

        // …and the row's own action is carried out.
        expect(deps.unloadProject).toHaveBeenCalledWith(PROJECT_ID);
        if (action === 'endTerminals') {
          expect(killAll).toHaveBeenCalledWith({ projectId: PROJECT_ID, exceptPanelIds: [] });
        } else {
          expect(killAll).not.toHaveBeenCalled();
        }
      });
    }
  }
});

describe('the unsaved-editor prompt still comes first, and is the only prompt (FR-035, FR-111)', () => {
  const DIRTY_ROWS: Array<[string, UnloadTerminalAction | undefined]> = [
    ['Unload Project and End Terminals', 'endTerminals'],
    ['Unload Project', undefined],
  ];
  it.each(DIRTY_ROWS)('"%s" with a dirty editor and a busy terminal: the dirty prompt, then no other dialog', async (_row, variant) => {
    const killAll = vi.fn((_params: unknown) => Promise.resolve({ killed: [] as string[] }));
    fakeBridge({ sessions: [BUSY], killAll });
    const deps = collaborators({ defaultAction: 'keepRunning', isDirty: () => true });

    const run = unloadProject(PROJECT_ID, PROJECT_NAME, variant, deps);

    await screen.findByTestId('dirty-close-dialog');
    // Nothing has been released, and no terminal dialog sits alongside the dirty prompt.
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(deps.unloadProject).not.toHaveBeenCalled();

    await act(async () => {
      (await screen.findByTestId('dirty-close-discard')).click();
    });

    expect(await settleOrDialog(run), 'a confirmation followed the unsaved-editor prompt').toBe('settled');
    expect(deps.unloadProject).toHaveBeenCalledWith(PROJECT_ID);
    if (variant === 'endTerminals') expect(killAll).toHaveBeenCalled();
    else expect(killAll).not.toHaveBeenCalled();
  });

  it('cancel at the dirty prompt leaves the project loaded and unchanged', async () => {
    const killAll = vi.fn((_params: unknown) => Promise.resolve({ killed: [] as string[] }));
    fakeBridge({ killAll });
    const deps = collaborators({ isDirty: () => true });

    const run = unloadProject(PROJECT_ID, PROJECT_NAME, 'endTerminals', deps);
    await screen.findByTestId('dirty-close-dialog');
    await act(async () => {
      (await screen.findByTestId('dirty-close-cancel')).click();
    });
    await run;

    expect(deps.unloadProject).not.toHaveBeenCalled();
    expect(killAll).not.toHaveBeenCalled();
  });

  it('save runs editor.saveAll, scoped to THIS project, and continues into the release', async () => {
    const saveAll = vi.fn((_params: unknown) => Promise.resolve(SAVE_ALL_OK));
    fakeBridge({ saveAll });
    const deps = collaborators({ isDirty: () => true });

    const run = unloadProject(PROJECT_ID, PROJECT_NAME, undefined, deps);
    await screen.findByTestId('dirty-close-dialog');
    await act(async () => {
      (await screen.findByTestId('dirty-close-save')).click();
    });
    await run;

    // Branch review I2 — 'project', never 'all'.
    expect(saveAll).toHaveBeenCalledWith({ scope: 'project', activeProjectId: PROJECT_ID });
    expect(deps.unloadProject).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('a FAILED save stops the flow — the project stays loaded, with one clear notice (C1)', async () => {
    fakeBridge({
      saveAll: () => Promise.resolve({ saved: [], skippedUnpathed: [], failed: [{ panelId: 'e1', reason: 'io' }] }),
    });
    const deps = collaborators({ isDirty: () => true });

    const run = unloadProject(PROJECT_ID, PROJECT_NAME, undefined, deps);
    await screen.findByTestId('dirty-close-dialog');
    await act(async () => {
      (await screen.findByTestId('dirty-close-save')).click();
    });
    await run;

    expect(deps.unloadProject).not.toHaveBeenCalled();
    expect(deps.reportFailure).toHaveBeenCalledTimes(1);
    const message = String((deps.reportFailure as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(message).toMatch(/nothing was unloaded/i);
  });

  it('a SKIPPED-UNPATHED save stops the flow the same way (C1)', async () => {
    fakeBridge({
      saveAll: () => Promise.resolve({ saved: [], skippedUnpathed: ['e1'], failed: [] }),
    });
    const deps = collaborators({ isDirty: () => true });

    const run = unloadProject(PROJECT_ID, PROJECT_NAME, undefined, deps);
    await screen.findByTestId('dirty-close-dialog');
    await act(async () => {
      (await screen.findByTestId('dirty-close-save')).click();
    });
    await run;

    expect(deps.unloadProject).not.toHaveBeenCalled();
    expect(deps.reportFailure).toHaveBeenCalledTimes(1);
  });
});

describe('the release order and its FR-037 exclusion (contracts/unload.md §6)', () => {
  it('unloadProject(id) runs before killAll — step 4 before step 6', async () => {
    const order: string[] = [];
    fakeBridge({
      killAll: () => {
        order.push('killAll');
        return Promise.resolve({ killed: [] });
      },
    });
    const deps = collaborators({
      unloadProject: vi.fn((id: string) => {
        order.push(`unloadProject:${id}`);
      }),
    });

    await unloadProject(PROJECT_ID, PROJECT_NAME, 'endTerminals', deps);

    expect(order).toEqual([`unloadProject:${PROJECT_ID}`, 'killAll']);
  });

  it('End Terminals passes a panel spared by a sub-workspace as exceptPanelIds, and never disposes it (FR-037)', async () => {
    const killAll = vi.fn((_params: unknown) => Promise.resolve({ killed: [] as string[] }));
    fakeBridge({ killAll });
    const disposeEditor = vi.fn();
    const deps = collaborators({
      subWorkspaces: [{ tabs: [ownedEditorPanel('spared-panel', PROJECT_ID)] }],
      editorPanelIds: ['spared-panel', 'plain-panel'],
      disposeEditor,
    });

    await unloadProject(PROJECT_ID, PROJECT_NAME, 'endTerminals', deps);

    expect(killAll).toHaveBeenCalledWith({ projectId: PROJECT_ID, exceptPanelIds: ['spared-panel'] });
    expect(disposeEditor).toHaveBeenCalledWith('plain-panel');
    expect(disposeEditor).not.toHaveBeenCalledWith('spared-panel');
  });

  it('Keep Terminals Running still disposes the editors a sub-workspace does not hold (FR-037)', async () => {
    fakeBridge();
    const disposeEditor = vi.fn();
    const deps = collaborators({
      subWorkspaces: [{ tabs: [ownedEditorPanel('spared-panel', PROJECT_ID)] }],
      editorPanelIds: ['spared-panel', 'plain-panel'],
      disposeEditor,
    });

    await unloadProject(PROJECT_ID, PROJECT_NAME, 'keepRunning', deps);

    expect(disposeEditor).toHaveBeenCalledWith('plain-panel');
    expect(disposeEditor).not.toHaveBeenCalledWith('spared-panel');
  });

  it('a step-5 (editor disposal) failure reports, and STILL runs step 6 — nothing throws', async () => {
    const killAll = vi.fn((_params: unknown) => Promise.resolve({ killed: [] as string[] }));
    fakeBridge({ killAll });
    const disposeEditor = vi.fn(() => {
      throw new Error('document still dirty');
    });
    const deps = collaborators({ editorPanelIds: ['e1'], disposeEditor });

    await unloadProject(PROJECT_ID, PROJECT_NAME, 'endTerminals', deps);

    expect(deps.reportFailure).toHaveBeenCalledWith(expect.stringContaining('document still dirty'), PROJECT_NAME);
    expect(killAll).toHaveBeenCalled();
  });
});

describe('a failure reaches the user as ONE clear notice (branch review #1)', () => {
  const invokeError = (channel: string, inner: string) =>
    new Error(`Error invoking remote method '${channel}': ${inner}`);
  const RAW = /invoking remote method|RpcTimeoutError|RPC "|terminal\.(list|closeIdle|killAll)|throng:terminal/;
  const onlyMessage = (deps: UnloadCollaborators): string => {
    const report = deps.reportFailure as ReturnType<typeof vi.fn>;
    expect(report).toHaveBeenCalledTimes(1);
    return String(report.mock.calls[0]![0]);
  };

  it('a timed-out killAll, AFTER the project was released, says the project is unloaded and what may still run', async () => {
    fakeBridge({
      killAll: () =>
        Promise.reject(invokeError('throng:terminal:killAll', 'RpcTimeoutError: RPC "terminal.killAll" timed out')),
    });
    const deps = collaborators();

    await unloadProject(PROJECT_ID, PROJECT_NAME, 'endTerminals', deps);

    const message = onlyMessage(deps);
    expect(message).not.toMatch(RAW);
    expect(message).toMatch(/unloaded/i);
    expect(message).toMatch(/still be running/i);
  });

  it('a killAll failure keeps its reason but loses the wrapping', async () => {
    fakeBridge({
      sessions: [BUSY],
      killAll: () => Promise.reject(invokeError('throng:terminal:killAll', 'Error: pipe gone')),
    });
    const deps = collaborators({ defaultAction: 'endTerminals' });

    await unloadProject(PROJECT_ID, PROJECT_NAME, undefined, deps);

    const message = onlyMessage(deps);
    expect(message).toContain('pipe gone');
    expect(message).not.toMatch(RAW);
  });

  it('a disposal failure AND a release failure are one notice carrying both reasons, not two', async () => {
    fakeBridge({ killAll: () => Promise.reject(invokeError('throng:terminal:killAll', 'Error: pipe gone')) });
    const deps = collaborators({
      editorPanelIds: ['e1'],
      disposeEditor: vi.fn(() => {
        throw new Error('document still dirty');
      }),
    });

    await unloadProject(PROJECT_ID, PROJECT_NAME, 'endTerminals', deps);

    const message = onlyMessage(deps);
    expect(message).toContain('document still dirty');
    expect(message).toContain('pipe gone');
  });
});
