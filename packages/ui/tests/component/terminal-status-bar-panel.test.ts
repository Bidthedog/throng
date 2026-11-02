import { waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '@throng/core';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';

/**
 * 024 US1 / FR-001 (#152, moved down from status-bar-visibility.e2e.ts) — a terminal panel shows a status
 * bar naming its shell flavour by default, and `terminals.showStatusBar` off removes it.
 *
 * Layer: component — the bar's presence and label are `TerminalPanel` passing `config.flavourLabel` and the
 * setting to `TerminalStatusBar`; the real panel in jsdom with `useTerminal` stubbed shows both. That the
 * setting ships on is core/tests/unit/settings-metadata-040.test.ts.
 */

const ROOT = 'C:/proj';
const PANEL_ID = 'p-term-tsb';

vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: () => {},
}));

vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

let harness: EditorHarness | undefined;

afterEach(() => {
  harness?.unmount();
  harness = undefined;
  Reflect.deleteProperty(window, 'throng');
  document.body.replaceChildren();
});

async function mountPanel(settings?: Record<string, unknown>): Promise<EditorHarness> {
  const panel = {
    type: 'panel',
    id: PANEL_ID,
    originProjectId: 'proj-editor',
    title: 'Terminal',
    kind: 'terminal',
    config: { flavourId: 'cmd', flavourLabel: 'Command Prompt' },
  } as unknown as Panel;
  const h = mountEditor({
    doc: { text: 'unrelated\n', version: 1, absPath: `${ROOT}/notes.txt` },
    projectRoot: ROOT,
    registerProject: true,
    settings,
    throng: { terminal: {} },
    extras: [createElement(TerminalPanel, { key: 'term', panel, tabId: 't1', projectRoot: ROOT })],
  });
  harness = h;
  await waitFor(() => expect(h.settingsLoaded(), 'the settings landed').toBe(true));
  return h;
}

const bar = (): HTMLElement | null => document.querySelector(`[data-testid="terminal-status-bar-${PANEL_ID}"]`);

describe('024 US1 — the terminal status bar', () => {
  it('shows the shell flavour label by default', async () => {
    await mountPanel();
    await waitFor(() => expect(bar(), 'the bar is present with no setting written').not.toBeNull());
    expect(bar()!.textContent).toContain('Command Prompt');
  });

  it('control: terminals.showStatusBar off removes it', async () => {
    await mountPanel({ terminals: { showStatusBar: false } });
    await waitFor(() => expect(document.querySelector(`[data-testid="terminal-${PANEL_ID}"]`)).not.toBeNull());
    expect(bar()).toBeNull();
  });
});
