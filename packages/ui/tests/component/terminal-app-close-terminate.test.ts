import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { AppClosePrompt } from '../../src/renderer/app-close-prompt.js';
import { clearPanelExit, getPanelExit } from '../../src/renderer/terminal/exit-store.js';
import { resetAppTerminating } from '../../src/renderer/terminal/app-terminating.js';
import { forgetTerminalCommand, reportTerminalCommand } from '../../src/renderer/terminal/command-store.js';

/**
 * 051 manual test — closing throng with Terminate all raised "Terminal exited (code 1)" on every terminal,
 * and the panels came back on the next launch as empty type pickers.
 *
 * Layer: component — the defect is the panel's reaction to an exit that arrives after the user chose
 * Terminate all in the close prompt; the real `TerminalPanel` and `AppClosePrompt` in jsdom show it, with
 * `useTerminal` stubbed so the exit can be delivered by hand.
 *
 * Since 051 the close waits for every end to settle (FR-015a), so each terminal's exit — code 1, from
 * taskkill — now reaches a window that is still alive. The panel treats it as an ordinary end: a notice,
 * and a revert to the type picker that the close then persists. 005 US3 says a terminal ended by closing
 * throng is re-created fresh when the project reopens.
 */

const ROOT = 'C:/proj';
const PANEL = 'p-term-close';

const captured = vi.hoisted(() => ({
  terminal: null as null | { onExit: (e: { code: number | null; unexpected: boolean }) => void },
}));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: { onExit: (e: { code: number | null; unexpected: boolean }) => void }) => {
    captured.terminal = opts;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

let harness: EditorHarness | undefined;
let showPrompt: ((info: { count: number; terminals: unknown[] }) => void) | null = null;
let announceTerminating: (() => void) | null = null;
let appCloseChoice: ReturnType<typeof vi.fn>;

beforeEach(() => {
  captured.terminal = null;
  showPrompt = null;
  announceTerminating = null;
  appCloseChoice = vi.fn();
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

/** A window holding one terminal panel — with the close prompt (the main window) or without (a sub-workspace). */
async function mountWindow(withPrompt: boolean, config: Record<string, unknown> = {}): Promise<void> {
  const terminalPanel = {
    type: 'panel',
    id: PANEL,
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId: 'pwsh', ...config },
  } as Panel;
  harness = mountEditor({
    // With a config, the layout's own panel carries the terminal's id, so what the terminal writes to its memory
    // reaches the layout the store saves.
    ...(Object.keys(config).length > 0 ? { panelId: PANEL } : {}),
    doc: { text: 'unrelated\n', version: 1, absPath: `${ROOT}/notes.txt` },
    projectRoot: ROOT,
    registerProject: true,
    throng: {
      terminal: {},
      onAppCloseBegin: () => () => {},
      onAppCloseClosing: () => () => {},
      onAppClosePrompt: (cb: (info: { count: number; terminals: unknown[] }) => void) => {
        showPrompt = cb;
        return () => {};
      },
      onAppCloseTerminating: (cb: () => void) => {
        announceTerminating = cb;
        return () => {};
      },
      appCloseChoice,
    },
    extras: [
      createElement(TerminalPanel, { key: 'term', panel: terminalPanel, tabId: 't1', projectRoot: ROOT }),
      ...(withPrompt ? [createElement(AppClosePrompt, { key: 'close' })] : []),
    ],
  });
  const h = harness;
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  await waitFor(() => expect(captured.terminal, 'the TerminalPanel rendered').not.toBeNull());
}

describe('Terminate all on close', () => {
  it('a terminal it ends raises no exit notice', async () => {
    await mountWindow(true);
    await waitFor(() => expect(showPrompt, 'the close prompt is listening').not.toBeNull());

    // The user closes throng and chooses Terminate all.
    act(() => showPrompt!({ count: 1, terminals: [] }));
    fireEvent.click(await screen.findByTestId('app-close-terminate'));
    await waitFor(() => expect(appCloseChoice).toHaveBeenCalledWith('terminate'));

    // Main ends every terminal; this one's exit arrives while the window is still open.
    act(() => captured.terminal!.onExit({ code: 1, unexpected: false }));

    expect(getPanelExit(PANEL)).toBeUndefined();
  });

  it('a window with no close prompt (a sub-workspace) learns it from main, and raises no notice either', async () => {
    await mountWindow(false);
    await waitFor(() => expect(announceTerminating, 'the window is listening for Terminate all').not.toBeNull());

    act(() => announceTerminating!());
    act(() => captured.terminal!.onExit({ code: 1, unexpected: false }));

    expect(getPanelExit(PANEL)).toBeUndefined();
  });

  /*
   * MT-11 step 9 — with command memory on and a program running, Terminate all sometimes lost the remembered
   * command: the close killed the program before its shell, the once-a-second observation saw "nothing running"
   * in between, and that was persisted. The next launch read it as the user having stopped the command (051
   * FR-046) and started a bare prompt. Measured 2 of 5 through the app.
   */
  it('an observation of "nothing running" while Terminate all ends the terminals is not saved over the running command', async () => {
    await mountWindow(false, { rememberCommand: true });
    await waitFor(() => expect(announceTerminating, 'the window is listening for Terminate all').not.toBeNull());

    act(() => reportTerminalCommand(PANEL, 'node titler.js'));
    await waitFor(() => expect(harness!.savedPanelMemory()?.observedCommand).toBe('node titler.js'), { timeout: 5000 });

    // Terminate all: main announces it, then ends the program first — the observation sees its shell alone.
    act(() => announceTerminating!());
    act(() => reportTerminalCommand(PANEL, null));
    // Give the debounced layout save every chance to write it, then read what was saved.
    await new Promise((r) => setTimeout(r, 1500)); // sleep-justified: asserting a write did NOT happen; the debounce is 400 ms
    expect(harness!.savedPanelMemory()?.observedCommand, 'the close saved "nothing running" over the running command').toBe(
      'node titler.js',
    );
  });

  it('control: outside a close, the same "nothing running" observation IS saved (FR-046 needs it)', async () => {
    await mountWindow(false, { rememberCommand: true });
    act(() => reportTerminalCommand(PANEL, 'node titler.js'));
    await waitFor(() => expect(harness!.savedPanelMemory()?.observedCommand).toBe('node titler.js'), { timeout: 5000 });
    act(() => reportTerminalCommand(PANEL, null));
    await waitFor(() => expect(harness!.savedPanelMemory()?.observedCommand).toBeNull(), { timeout: 5000 });
  });

  it('control: outside a close, the same exit still raises its notice', async () => {
    await mountWindow(false);
    act(() => captured.terminal!.onExit({ code: 1, unexpected: false }));
    expect(getPanelExit(PANEL)?.message).toMatch(/Terminal exited \(code 1\)/);
  });
});
