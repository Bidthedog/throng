import { act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TERMINAL_TITLE_TEMPLATE, panelDisplayTitle, type Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { clearPanelExit } from '../../src/renderer/terminal/exit-store.js';
import { setTerminalTitleContext } from '../../src/renderer/terminal/title-context.js';
import { panelTitleSources } from '../../src/renderer/workspace/use-panel-display-names.js';

/**
 * 053 edge case — a stopped terminal names no running command.
 *
 * Layer: component — the name comes from what the renderer last observed, and only the real
 * `TerminalPanel` ending in jsdom (with `useTerminal` stubbed so the exit is delivered by hand) shows
 * whether the panel's last command outlives its terminal.
 *
 * The user ran `ping localhost -t`, then the terminal ended (Ctrl+C then `exit`, a project unload, a
 * crash). Nothing runs in the panel any more, so its name must not still say `ping localhost -t`.
 */

const ROOT = 'C:/proj';
const PANEL = 'p-term-stopped';

const captured = vi.hoisted(() => ({
  terminal: null as null | { onExit: (e: { code: number | null; unexpected: boolean }) => void },
  publish: null as null | ((e: { panelId: string; command: string | null; arch?: string | null }) => void),
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

const panel = {
  type: 'panel',
  id: PANEL,
  originProjectId: 'proj-editor',
  title: 'Terminal',
  kind: 'terminal',
  config: { flavourId: 'bash', flavourLabel: 'Git Bash' },
} as Panel;

beforeEach(() => {
  captured.terminal = null;
  setTerminalTitleContext({
    template: DEFAULT_TERMINAL_TITLE_TEMPLATE,
    limits: { command: 40, path: 40 },
    projects: new Map(),
    subWorkspaceName: null,
    elevated: false,
  });
});

afterEach(() => {
  clearPanelExit(PANEL);
  setTerminalTitleContext(null);
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

const name = (): string => panelDisplayTitle(panel, panelTitleSources(panel));

describe('053 — a stopped terminal', () => {
  it('names no running command once its terminal has ended', async () => {
    harness = mountEditor({
      doc: { text: 'unrelated\n', version: 1, absPath: `${ROOT}/notes.txt` },
      projectRoot: ROOT,
      registerProject: true,
      throng: {
        terminal: {
          onCommand: (cb: (e: { panelId: string; command: string | null }) => void) => {
            captured.publish = cb;
            return () => {};
          },
        },
      },
      extras: [createElement(TerminalPanel, { key: 'term', panel, tabId: 't1', projectRoot: ROOT })],
    });
    await waitFor(() => expect(captured.terminal, 'the TerminalPanel rendered').not.toBeNull());
    await waitFor(() => expect(captured.publish, 'the command bridge is listening').not.toBeNull());

    act(() => captured.publish!({ panelId: PANEL, command: 'ping localhost -t', arch: 'x64' }));
    expect(name()).toBe('ping localhost -t | Git Bash');

    act(() => captured.terminal!.onExit({ code: 0, unexpected: false }));

    expect(name()).toBe('Git Bash');
  });
});
