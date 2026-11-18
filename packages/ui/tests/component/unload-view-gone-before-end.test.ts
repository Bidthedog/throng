/**
 * 051 FR-004, acceptance scenario 3; 046 FR-032/FR-036 — Unload with End Terminals must have taken the project's
 * views down BEFORE it asks the daemon to end their terminals.
 *
 * ══ THE REPORTED DEFECT ══
 *
 * On the hosted macOS runner, `terminal-lifecycle-051.e2e.ts` MT-01 (4/4 runs) and `terminal-no-orphans.e2e.ts`
 * "Unload Project and End Terminals … reloads with a new shell" (1/2) failed the same way: straight after Unload
 * with End Terminals the user was told "Terminal exited (code —)" about a terminal throng itself had just ended,
 * and the panel reverted to "Blank Panel" — so the next load of the project gave it no fresh shell (FR-004).
 *
 * The orchestrator releases the project (step 4) and then calls `killAll` (step 6), believing the release has
 * already unmounted every view. It has not: the release is a React state update, committed on a LATER task, and
 * a view's exit subscription is torn down later still, in its passive-effect cleanup. A daemon that answers fast
 * enough (macOS ends a shell at once) publishes the exit to a view that is still subscribed, and the view takes
 * it as its own shell dying.
 *
 * Layer: component. The ordering is the orchestrator's, against a real React root; the kill fires its exit
 * synchronously, as the fastest possible daemon would, so the race is shown on every run rather than by timing.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement, useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { unloadProject, type UnloadCollaborators } from '../../src/renderer/sidebar/unload-project.js';

const PROJECT_ID = 'proj-a';

/** The daemon's exit channel: every subscribed view hears every exit, as `bridge.onExit` does. */
const exitListeners = new Set<(panelId: string) => void>();

/** A terminal view of `panelId`: subscribed while mounted, and reverting its panel on an exit it hears. */
function TerminalView({ panelId, onRevert }: { panelId: string; onRevert: (panelId: string) => void }): null {
  useEffect(() => {
    const listener = (id: string): void => {
      if (id === panelId) onRevert(id);
    };
    exitListeners.add(listener);
    return () => {
      exitListeners.delete(listener);
    };
  }, [panelId, onRevert]);
  return null;
}

afterEach(() => {
  exitListeners.clear();
  Reflect.deleteProperty(window, 'throng');
});

describe('Unload with End Terminals ends nothing a view is still showing (051 FR-004, 046 FR-036)', () => {
  it('no view of the project hears the exit of a terminal the Unload ended', async () => {
    const reverted: string[] = [];
    const onRevert = (id: string): void => {
      reverted.push(id);
    };
    let release: ((id: string) => void) | undefined;
    function Workspace(): ReturnType<typeof createElement> {
      const [openedId, setOpenedId] = useState<string | null>(PROJECT_ID);
      release = (id) => setOpenedId((cur) => (cur === id ? null : cur));
      return createElement(
        'div',
        { 'data-testid': 'workspace', 'data-project': openedId ?? '' },
        openedId === PROJECT_ID
          ? [
              createElement(TerminalView, { key: 't1', panelId: 't1', onRevert }),
              createElement(TerminalView, { key: 't2', panelId: 't2', onRevert }),
            ]
          : null,
      );
    }
    render(createElement(Workspace));
    expect(exitListeners.size).toBe(2);

    // The fastest daemon: each terminal's exit is published before `killAll` has even answered.
    Reflect.set(window, 'throng', {
      terminal: {
        killAll: () => {
          for (const listener of [...exitListeners]) {
            listener('t1');
            listener('t2');
          }
          return Promise.resolve({ killed: ['t1', 't2'], failed: [] });
        },
      },
    });
    const deps = {
      settings: { projects: { unloadTerminalAction: 'keepRunning' } },
      isDirty: () => false,
      subWorkspaces: [],
      editorPanelIds: [],
      unloadProject: (id: string) => release!(id),
      disposeEditor: () => undefined,
      reportFailure: () => undefined,
    } as unknown as UnloadCollaborators;

    await act(async () => {
      await unloadProject(PROJECT_ID, 'Alpha', 'endTerminals', deps);
    });

    expect(screen.getByTestId('workspace').getAttribute('data-project')).toBe('');
    expect(reverted, 'a view of the unloaded project took the end throng asked for as its shell dying').toEqual([]);
  });
});
