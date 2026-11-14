import { act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { forgetTerminalCommand, peekTerminalCommand, reportTerminalCommand } from '../../src/renderer/terminal/command-store.js';

/**
 * 068 FR-040, FR-045 — a Claude Code terminal is remembered as the command that resumes its session.
 *
 * Layer: component — what is persisted, and what the next launch starts with, is decided by the real
 * `TerminalPanel` reading the command store; `useTerminal` is stubbed so an exit and a launch can be
 * observed by hand. The daemon side (which command it publishes) is proven in terminal-command-poll.test.ts.
 */

const ROOT = 'C:/proj';
const PANEL = 'p-term-resume';
const PLAIN = 'claude --model opus';
const RESUME = 'claude --model opus --resume 11111111-2222-3333-4444-555555555555';

const captured = vi.hoisted(() => ({
  terminal: null as null | {
    startupCommand: string;
    onExit: (e: { code: number | null; unexpected: boolean }) => void;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: { startupCommand: string; onExit: (e: { code: number | null; unexpected: boolean }) => void }) => {
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
});

afterEach(() => {
  forgetTerminalCommand(PANEL);
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

async function mount(config: Record<string, unknown>, terminalMemory?: Record<string, unknown>): Promise<void> {
  const panel = {
    type: 'panel',
    id: PANEL,
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId: 'pwsh', ...config },
    ...(terminalMemory ? { terminalMemory } : {}),
  } as unknown as Panel;
  harness = mountEditor({
    panelId: PANEL,
    doc: { text: 'unrelated\n', version: 1, absPath: `${ROOT}/notes.txt` },
    projectRoot: ROOT,
    registerProject: true,
    throng: { terminal: {} },
    extras: [createElement(TerminalPanel, { key: 'term', panel, tabId: 't1', projectRoot: ROOT })],
  });
  const h = harness;
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  await waitFor(() => expect(captured.terminal, 'the TerminalPanel rendered').not.toBeNull());
}

describe('068 US5 — command memory keeps the resume command for Claude Code', () => {
  it('persists memoryCommand as observedCommand while the title keeps the plain command (FR-041)', async () => {
    await mount({ rememberCommand: true });

    act(() => reportTerminalCommand(PANEL, PLAIN, undefined, RESUME));

    await waitFor(() => expect(harness!.savedPanelMemory()?.observedCommand).toBe(RESUME), { timeout: 5000 });
    expect(peekTerminalCommand(PANEL)).toBe(PLAIN);
  });

  it('an end promotes the resume command to the startup command', async () => {
    await mount({ rememberCommand: true, startupCommand: '' });
    act(() => reportTerminalCommand(PANEL, PLAIN, undefined, RESUME));
    await waitFor(() => expect(harness!.savedPanelMemory()?.observedCommand).toBe(RESUME), { timeout: 5000 });

    act(() => captured.terminal!.onExit({ code: 0, unexpected: false }));

    await waitFor(() => expect(harness!.savedPanelMemory()?.startupCommand).toBe(RESUME), { timeout: 5000 });
  });

  it('a session switch under the same command persists the new resume command', async () => {
    await mount({ rememberCommand: true });
    act(() => reportTerminalCommand(PANEL, PLAIN, undefined, RESUME));
    await waitFor(() => expect(harness!.savedPanelMemory()?.observedCommand).toBe(RESUME), { timeout: 5000 });
    const next = RESUME.replace('11111111', '99999999');

    act(() => reportTerminalCommand(PANEL, PLAIN, undefined, next));

    await waitFor(() => expect(harness!.savedPanelMemory()?.observedCommand).toBe(next), { timeout: 5000 });
  });

  it('with memory off nothing is saved and nothing resumes (FR-040)', async () => {
    await mount({ rememberCommand: false, startupCommand: '' });
    act(() => reportTerminalCommand(PANEL, PLAIN, undefined, RESUME));
    act(() => captured.terminal!.onExit({ code: 0, unexpected: false }));

    await waitFor(() => expect(harness!.savedPanelMemory()?.startupCommand ?? '').toBe(''));
    expect(harness!.savedPanelMemory()?.observedCommand).toBeUndefined();
  });

  it('stranded recovery after a crash starts the next terminal with the resume command (FR-045)', async () => {
    await mount({ rememberCommand: true, startupCommand: '' }, { observedCommand: RESUME });

    expect(captured.terminal!.startupCommand).toBe(RESUME);
  });
});
