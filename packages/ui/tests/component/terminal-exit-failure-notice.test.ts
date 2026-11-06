import { act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Panel, PtyExitFailure } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { clearPanelExit, getPanelExit } from '../../src/renderer/terminal/exit-store.js';
import { resetAppTerminating } from '../../src/renderer/terminal/app-terminating.js';
import { forgetTerminalCommand } from '../../src/renderer/terminal/command-store.js';

/**
 * #555 — a missed agent connect showed only "Terminal exited (code 1)".
 *
 * Layer: component — the defect is what the panel keeps of an exit when it reverts to its type form: the
 * real `TerminalPanel` in jsdom, with `useTerminal` stubbed so the exit the daemon publishes can be
 * delivered by hand. The daemon writes its reason into the terminal, and the revert throws the terminal
 * away; the exit notice is all that survives, so the reason has to be in it.
 */

const ROOT = 'C:/proj';
const PANEL = 'p-term-exit-failure';

type Exit = { code: number | null; unexpected: boolean; failure?: PtyExitFailure };
const captured = vi.hoisted(() => ({ terminal: null as null | { onExit: (e: Exit) => void } }));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: { onExit: (e: Exit) => void }) => {
    captured.terminal = opts;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

let harness: EditorHarness | undefined;

beforeEach(() => {
  captured.terminal = null;
  resetAppTerminating();
});

afterEach(() => {
  clearPanelExit(PANEL);
  forgetTerminalCommand(PANEL);
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

async function mountTerminal(): Promise<void> {
  const terminalPanel = {
    type: 'panel',
    id: PANEL,
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId: 'pwsh' },
  } as Panel;
  harness = mountEditor({
    doc: { text: 'unrelated\n', version: 1, absPath: `${ROOT}/notes.txt` },
    projectRoot: ROOT,
    registerProject: true,
    throng: { terminal: {} },
    extras: [createElement(TerminalPanel, { key: 'term', panel: terminalPanel, tabId: 't1', projectRoot: ROOT })],
  });
  const h = harness;
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  await waitFor(() => expect(captured.terminal, 'the TerminalPanel rendered').not.toBeNull());
}

describe('#555 — the exit notice says why throng ended the terminal', () => {
  it('an agent that never connected is named in the notice, with the launcher reason kept for Copy only', async () => {
    await mountTerminal();
    act(() =>
      captured.terminal!.onExit({
        code: 1,
        unexpected: true,
        failure: { kind: 'agent-never-started', detail: 'CreateProcessWithTokenW failed: 1314' },
      }),
    );

    const exit = getPanelExit(PANEL);
    expect(exit?.message, 'the code alone says nothing; the notice must say the agent never started').toMatch(
      /Terminal exited \(code 1\): the de-elevated terminal agent never started/,
    );
    expect(exit?.message, 'the raw launcher text is demoted to Copy, never rendered (029 FR-018)').not.toMatch(/1314/);
    expect(exit?.detail).toBe('CreateProcessWithTokenW failed: 1314');
  });

  it("control: a shell's own exit reads as before, with no reason and no detail", async () => {
    await mountTerminal();
    act(() => captured.terminal!.onExit({ code: 2, unexpected: true }));

    const exit = getPanelExit(PANEL);
    expect(exit?.message).toMatch(/^Terminal exited \(code 2\)( — |$)/);
    expect(exit?.detail).toBeUndefined();
  });
});
