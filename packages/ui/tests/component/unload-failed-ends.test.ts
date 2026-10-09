/**
 * 051 FR-002 / FR-005 — an End Terminals Unload whose ends did not all complete says so in the ONE
 * notice the Unload already raises ("one condition, one notice"), naming how many are still running
 * and that they reattach — because a failed end leaves an ordinary running terminal.
 *
 * Layer: component — the orchestrator runs in jsdom over a mocked bridge; no daemon is needed to
 * decide what the notice says about a `killAll` result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unloadProject, type UnloadCollaborators } from '../../src/renderer/sidebar/unload-project.js';

const PROJECT_ID = 'proj-1';
const PROJECT_NAME = 'Widgets';

function bridge(killAll: (params: unknown) => Promise<unknown>): void {
  Reflect.set(window, 'throng', {
    editor: { saveAll: () => Promise.resolve({ saved: [], skippedUnpathed: [], failed: [] }) },
    terminal: {
      list: () => Promise.resolve({ sessions: [] }),
      closeIdle: () => Promise.resolve({ closed: [] }),
      killAll,
    },
  });
}

function collaborators(): UnloadCollaborators {
  return {
    settings: { projects: { unloadTerminalAction: 'endTerminals' } },
    isDirty: () => false,
    subWorkspaces: [],
    editorPanelIds: [],
    unloadProject: vi.fn(),
    disposeEditor: vi.fn(),
    reportFailure: vi.fn(),
  } as unknown as UnloadCollaborators;
}

afterEach(() => Reflect.deleteProperty(window, 'throng'));

describe('051 — Unload reports ends that did not complete, once', () => {
  it('two failed ends produce one notice naming them, saying they still run and reattach', async () => {
    bridge(() =>
      Promise.resolve({
        killed: ['a', 'b', 'c'],
        failed: [
          { panelId: 'a', reason: 'did not end within 5 seconds' },
          { panelId: 'b', reason: 'did not end within 5 seconds' },
        ],
      }),
    );
    const deps = collaborators();
    await unloadProject(PROJECT_ID, PROJECT_NAME, undefined, deps);
    expect(deps.reportFailure).toHaveBeenCalledTimes(1);
    const message = String((deps.reportFailure as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(message).toContain(
      `2 of its terminals could not be ended; they are still running and reattach when you open ${PROJECT_NAME} again`,
    );
  });

  it('one failed end reads in the singular', async () => {
    bridge(() => Promise.resolve({ killed: ['a'], failed: [{ panelId: 'a', reason: 'access denied' }] }));
    const deps = collaborators();
    await unloadProject(PROJECT_ID, PROJECT_NAME, undefined, deps);
    const message = String((deps.reportFailure as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(message).toContain('1 of its terminals could not be ended; it is still running and reattaches');
  });

  it('every end completing raises no notice', async () => {
    bridge(() => Promise.resolve({ killed: ['a'], failed: [] }));
    const deps = collaborators();
    await unloadProject(PROJECT_ID, PROJECT_NAME, undefined, deps);
    expect(deps.reportFailure).not.toHaveBeenCalled();
  });
});
