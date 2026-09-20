import { waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { reportTerminalCwd } from '../../src/renderer/terminal/cwd-store.js';

/**
 * 045 T188, behavioural — FR-142 – FR-144 (link-resolution.md P14; data-model §14.4): what a RENDERED
 * terminal panel hands its link provider as the base directory for a relative path.
 *
 * T188's unit test (`unit/terminal-link-base-directory.test.ts`) names the seam T189 will add and
 * fails on its absence — which says the function is missing, not what the user sees. This file shows
 * what the user sees, through the real `TerminalPanel` with only `useTerminal` stubbed (it would mount
 * xterm and attach a shell, neither of which is the subject). It is `link-position-open.test.ts`'s
 * harness: the panel is rendered beside an editor, and what the panel passes `useTerminal` is captured.
 *
 * ══ THE DEFECT ══
 *
 * A shell that cannot report its directory — a WSL flavour always, PowerShell and Git Bash with
 * `terminals.shellIntegration` off — leaves the cwd store holding the LAUNCH directory: the process
 * directory the daemon observed, which a Linux `cd` or PowerShell's `Set-Location` never moves. The
 * panel hands that to the link provider as the live directory, so after `cd sub` a relative path is
 * resolved against the folder the user left — the wrong file, or no link at all. FR-144: such a
 * terminal has NO base directory, and the project root is tried alone (R5).
 *
 * The controls — `cmd`, and PowerShell with integration on — report their directory honestly and
 * must keep it.
 */

const ROOT = 'C:/proj';
const LAUNCH_DIR = 'C:/proj';

/** What the rendered TerminalPanel handed `useTerminal`. */
const captured = vi.hoisted(() => ({ terminal: null as null | { linkBaseDirectory?: () => string | undefined } }));

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: (opts: { linkBaseDirectory?: () => string | undefined }) => {
    captured.terminal = opts;
  },
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

/** A user-defined WSL flavour, as a user would add one (025 FR-011; WSL is not a built-in). */
const WSL_FLAVOUR = {
  id: 'wsl-ubuntu',
  label: 'Ubuntu (WSL)',
  file: 'C:\\Windows\\System32\\wsl.exe',
  args: ['-d', 'Ubuntu'],
  defaultShellArguments: '',
};

let harness: EditorHarness | undefined;
let panelSeq = 0;

beforeEach(() => {
  captured.terminal = null;
});

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

/**
 * Render a terminal panel of `flavourId` beside an editor, with the cwd store holding the directory
 * the daemon observed at launch. Returns the base directory the panel's link provider would use.
 */
async function baseDirectoryFor(flavourId: string, shellIntegration: boolean): Promise<string | undefined> {
  panelSeq += 1;
  const panelId = `p-term-${panelSeq}`;
  const terminalPanel = {
    type: 'panel',
    id: panelId,
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId },
  } as Panel;
  harness = mountEditor({
    doc: { text: 'unrelated\n', version: 1, absPath: `${ROOT}/notes.txt` },
    projectRoot: ROOT,
    registerProject: true,
    settings: { terminals: { shellIntegration, flavours: [WSL_FLAVOUR] } },
    throng: { terminal: {} },
    extras: [createElement(TerminalPanel, { key: 'term', panel: terminalPanel, tabId: 't1', projectRoot: ROOT })],
  });
  const h = harness;
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  await waitFor(() => expect(captured.terminal?.linkBaseDirectory, 'the TerminalPanel rendered').toBeDefined());
  expect(h.settings().terminals.shellIntegration, 'the setting reached the tree').toBe(shellIntegration);

  // The daemon observed the shell's process directory at launch. For the shells below that report
  // nothing, it is all the store will ever hold — the user's `cd sub` never reaches it.
  reportTerminalCwd(panelId, LAUNCH_DIR);
  return captured.terminal!.linkBaseDirectory!();
}

describe('T188 / FR-144 — a shell that cannot report its directory gets NO base directory', () => {
  it('a WSL flavour: never the launch directory, whatever the store holds', async () => {
    expect(await baseDirectoryFor('wsl-ubuntu', true), 'a Linux `cd` is invisible to Windows').toBeUndefined();
  });

  it('PowerShell 7 with terminals.shellIntegration OFF: Set-Location never moved the process directory', async () => {
    expect(await baseDirectoryFor('pwsh', false)).toBeUndefined();
  });

  it('Windows PowerShell with integration OFF', async () => {
    expect(await baseDirectoryFor('windows-powershell', false)).toBeUndefined();
  });

  it('Git Bash with integration OFF', async () => {
    expect(await baseDirectoryFor('git-bash', false)).toBeUndefined();
  });
});

describe('T188 / FR-142 – FR-143 — controls: a shell that reports its directory keeps it', () => {
  it('cmd — the daemon observes its real process directory', async () => {
    expect(await baseDirectoryFor('cmd', false)).toBe(LAUNCH_DIR);
  });

  it('PowerShell 7 with integration ON — OSC 9;9 reports every Set-Location', async () => {
    expect(await baseDirectoryFor('pwsh', true)).toBe(LAUNCH_DIR);
  });
});
