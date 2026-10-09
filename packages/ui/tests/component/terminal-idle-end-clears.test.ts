import { waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';

/**
 * 051 FR-046 (supersedes 025 FR-017) — a terminal that ended with nothing running starts with nothing.
 *
 * Layer: component — what decides the command a reopened terminal launches with is `TerminalPanel` reading
 * its persisted memory; the real panel in jsdom with `useTerminal` stubbed shows the launch it asks for.
 *
 * The user ran `ping -t localhost` (captured as the startup command), stopped it with Ctrl+C, and unloaded
 * the project. The last observation persisted was "nothing running" — and reloading ran the ping again.
 */

const ROOT = 'C:/proj';

const captured = vi.hoisted(() => ({ terminal: null as null | { startupCommand: string } }));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: { startupCommand: string }) => {
    captured.terminal = opts;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

let harness: EditorHarness | undefined;
let seq = 0;

beforeEach(() => {
  captured.terminal = null;
});

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

async function launchedWith(observedCommand: string | null): Promise<string> {
  seq += 1;
  const panel = {
    type: 'panel',
    id: `p-term-idle-${seq}`,
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId: 'pwsh', startupCommand: 'ping -t localhost', rememberCommand: true },
    terminalMemory: { observedCommand },
  } as unknown as Panel;
  harness = mountEditor({
    doc: { text: 'unrelated\n', version: 1, absPath: `${ROOT}/notes.txt` },
    projectRoot: ROOT,
    registerProject: true,
    throng: { terminal: {} },
    extras: [createElement(TerminalPanel, { key: 'term', panel, tabId: 't1', projectRoot: ROOT })],
  });
  await waitFor(() => expect(captured.terminal, 'the TerminalPanel rendered').not.toBeNull());
  return captured.terminal!.startupCommand;
}

describe('051 FR-046 — reopening a terminal whose last observation was "nothing running"', () => {
  it('launches with no startup command: the stopped ping does not run again', async () => {
    expect(await launchedWith(null)).toBe('');
  });

  it('control: a command still running at the last observation is relaunched (025 FR-019)', async () => {
    expect(await launchedWith('ping -t localhost')).toBe('ping -t localhost');
  });
});
